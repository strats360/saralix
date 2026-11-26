import { Hono, type Context } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { companyKyc, kycDocuments, memberships, platformStaff, roles, tenants, user } from "@hrms/db";
import { ENTITY_TYPE_LABEL, KYC_DOC_KINDS, KYC_DOC_LABEL, kycDecisionSchema, kycDetailsSchema, kycGaps, requiredDocs, type EntityType, type KycDetails, type KycDocKind, type KycStatus } from "@hrms/shared";
import type { AppEnv } from "../env";
import { mailerFor, requirePerm, requirePlatform } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { deleteFile, getFile, putFile, safeName } from "../lib/storage";
import { imageType } from "./photos";

const MAX_FILE = 10 * 1024 * 1024;
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;

async function load(db: AppEnv["Variables"]["db"], tenantId: string) {
  const [t] = await db.select({ id: tenants.id, name: tenants.name, code: tenants.code, kycStatus: tenants.kycStatus, createdAt: tenants.createdAt, contactEmail: tenants.contactEmail }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw notFound("Company");
  const [k] = await db.select().from(companyKyc).where(eq(companyKyc.tenantId, tenantId));
  const docs = await db.select().from(kycDocuments).where(eq(kycDocuments.tenantId, tenantId)).orderBy(kycDocuments.uploadedAt);
  const details = (k?.details ?? {}) as Partial<KycDetails>;
  return {
    tenant: t,
    status: t.kycStatus as KycStatus,
    details,
    documents: docs.map(({ fileKey: _k, ...d }) => d),
    required: details.entityType ? requiredDocs(details.entityType as EntityType, !!details.gstin) : [],
    gaps: kycGaps(details, docs.map((d) => d.kind as KycDocKind)),
    submittedAt: k?.submittedAt ?? null,
    reviewedAt: k?.reviewedAt ?? null,
    reviewNote: k?.reviewNote ?? null,
    history: k?.history ?? [],
  };
}

/** The company can change its KYC while it's a draft or has been sent back. */
const editable = (s: string) => s === "draft" || s === "needs_info";

/** Company owners and admins who can see settings: who hears about decisions. */
async function companyAdmins(db: AppEnv["Variables"]["db"], tenantId: string) {
  const rows = await db.select({ email: user.email, name: user.name, perms: roles.permissions }).from(memberships).innerJoin(user, eq(user.id, memberships.userId)).innerJoin(roles, eq(roles.id, memberships.roleId)).where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active")));
  return rows.filter((r) => (r.perms as Record<string, string[]>)?.settings?.includes("edit"));
}

/* ---------------- the company ---------------- */

export const kycRoutes = new Hono<AppEnv>();
kycRoutes.use("*", requirePerm("settings", "edit"));

kycRoutes.get("/", async (c) => {
  const k = await load(c.get("db"), tid(c));
  const { tenant: _t, ...rest } = k;
  return c.json(rest);
});

kycRoutes.put("/", async (c) => {
  const db = c.get("db");
  const [t] = await db.select({ kycStatus: tenants.kycStatus }).from(tenants).where(eq(tenants.id, tid(c)));
  if (!editable(t!.kycStatus)) throw badRequest(t!.kycStatus === "submitted" ? "It's being checked. You can change it if we send it back." : "Your KYC is already decided");
  // drafts save whatever's there; the full check happens when it's sent
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = kycDetailsSchema.safeParse(body);
  const details = parsed.success ? parsed.data : Object.fromEntries(Object.entries(body).filter(([k, val]) => typeof val === "string" || val === null).map(([k, val]) => [k, typeof val === "string" ? val.slice(0, 500) : val]));
  await db.insert(companyKyc).values({ tenantId: tid(c), details }).onConflictDoUpdate({ target: companyKyc.tenantId, set: { details, updatedAt: new Date() } });
  return c.json({ ok: true, valid: parsed.success, errors: parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? "form"), i.message])) });
});

kycRoutes.post("/documents", async (c) => {
  const db = c.get("db");
  const [t] = await db.select({ kycStatus: tenants.kycStatus }).from(tenants).where(eq(tenants.id, tid(c)));
  if (!editable(t!.kycStatus)) throw badRequest("Documents can't change now");
  const form = await c.req.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "");
  if (!(KYC_DOC_KINDS as readonly string[]).includes(kind)) throw badRequest("Pick what the document is");
  if (!(file instanceof File) || !file.size) throw badRequest("Attach a file");
  if (file.size > MAX_FILE) throw badRequest("Files must be 10 MB or smaller");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? "application/pdf" : imageType(bytes);
  if (!type) throw badRequest("Upload a PDF, JPG or PNG");
  const key = `tenants/${tid(c)}/kyc/${crypto.randomUUID()}`;
  await putFile(c.env, key, bytes.buffer as ArrayBuffer, type);
  // one file per kind, except "other"
  if (kind !== "other") {
    const old = await db.delete(kycDocuments).where(and(eq(kycDocuments.tenantId, tid(c)), eq(kycDocuments.kind, kind))).returning();
    for (const o of old) await deleteFile(c.env, o.fileKey).catch(() => {});
  }
  const [d] = await db.insert(kycDocuments).values({ tenantId: tid(c), kind, fileKey: key, fileName: safeName(file.name || `${kind}.pdf`), mimeType: type, sizeBytes: file.size, uploadedBy: c.get("session")!.userId }).returning();
  await audit(c, { action: "kyc.document", entity: "tenant", entityId: tid(c), summary: `Uploaded the ${KYC_DOC_LABEL[kind as KycDocKind].toLowerCase()} for KYC` });
  return c.json({ id: d!.id }, 201);
});

kycRoutes.delete("/documents/:id", async (c) => {
  const db = c.get("db");
  const [t] = await db.select({ kycStatus: tenants.kycStatus }).from(tenants).where(eq(tenants.id, tid(c)));
  if (!editable(t!.kycStatus)) throw badRequest("Documents can't change now");
  const [d] = await db.delete(kycDocuments).where(and(eq(kycDocuments.id, c.req.param("id")), eq(kycDocuments.tenantId, tid(c)))).returning();
  if (!d) throw notFound("Document");
  await deleteFile(c.env, d.fileKey).catch(() => {});
  return c.json({ ok: true });
});

kycRoutes.get("/documents/:id", async (c) => {
  const [d] = await c.get("db").select().from(kycDocuments).where(and(eq(kycDocuments.id, c.req.param("id")), eq(kycDocuments.tenantId, tid(c))));
  if (!d) throw notFound("Document");
  const f = await getFile(c.env, d.fileKey);
  if (!f) throw notFound("Document");
  return c.body(f.body as ArrayBuffer, 200, { "Content-Type": d.mimeType, "Content-Disposition": `inline; filename="${d.fileName}"`, "Cache-Control": "private, no-store" });
});

kycRoutes.post("/submit", async (c) => {
  const db = c.get("db");
  const k = await load(db, tid(c));
  if (!editable(k.status)) throw badRequest(k.status === "submitted" ? "It's already with us" : "Your KYC is already decided");
  const parsed = kycDetailsSchema.safeParse(k.details);
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Check the business details");
  if (k.gaps.length) throw badRequest(`${k.gaps[0]} first`);
  const s = c.get("session")!;
  const now = new Date();
  await db.update(companyKyc).set({ details: parsed.data, submittedAt: now, submittedBy: s.userId, history: [...k.history, { at: now.toISOString(), by: s.name, action: k.status === "needs_info" ? "resubmitted" : "submitted" }], updatedAt: now }).where(eq(companyKyc.tenantId, tid(c)));
  // the legal details become the company profile too, so payslips and invoices match
  await db.update(tenants).set({ kycStatus: "submitted", legalName: parsed.data.legalName, pan: parsed.data.pan, gstin: parsed.data.gstin, llpinCin: parsed.data.regNo, registeredAddress: `${parsed.data.address}, ${parsed.data.pincode}`, state: parsed.data.state }).where(eq(tenants.id, tid(c)));
  await audit(c, { action: "kyc.submit", entity: "tenant", entityId: tid(c), summary: `Sent KYC for ${parsed.data.legalName} (${ENTITY_TYPE_LABEL[parsed.data.entityType]})` });
  // tell the platform team there's one to check
  const staff = await db.select({ email: user.email }).from(platformStaff).innerJoin(user, eq(user.id, platformStaff.userId)).where(and(eq(platformStaff.status, "active"), inArray(platformStaff.role, ["super_admin", "support"])));
  const mailer = mailerFor(c.env);
  for (const p of staff) {
    const { html, text } = layout({ company: "Saralix", heading: "A company sent its KYC", paragraphs: [`${k.tenant.name} (${k.tenant.code}) sent its KYC for checking.`, `${parsed.data.legalName}, ${ENTITY_TYPE_LABEL[parsed.data.entityType]}, PAN ${parsed.data.pan}.`], cta: { label: "Review it", url: `${c.env.APP_URL}/platform/kyc/${tid(c)}` } });
    await mailer.send({ to: p.email, subject: `KYC to review: ${k.tenant.name}`, html, text }).catch((e) => console.error("kyc staff email failed", e));
  }
  return c.json({ ok: true });
});

/* ---------------- the platform team ---------------- */

export const platformKycRoutes = new Hono<AppEnv>();
platformKycRoutes.use("*", requirePlatform("super_admin", "support"));

platformKycRoutes.get("/", async (c) => {
  const db = c.get("db");
  const status = c.req.query("status");
  const rows = await db
    .select({ tenantId: tenants.id, name: tenants.name, code: tenants.code, status: tenants.kycStatus, createdAt: tenants.createdAt, submittedAt: companyKyc.submittedAt, reviewedAt: companyKyc.reviewedAt, details: companyKyc.details })
    .from(tenants)
    .leftJoin(companyKyc, eq(companyKyc.tenantId, tenants.id))
    .where(status ? eq(tenants.kycStatus, status) : inArray(tenants.kycStatus, ["draft", "submitted", "needs_info", "rejected"]))
    .orderBy(desc(companyKyc.submittedAt), desc(tenants.createdAt))
    .limit(300);
  return c.json(rows.map(({ details, ...r }) => ({ ...r, legalName: (details as Partial<KycDetails> | null)?.legalName ?? null, entityType: (details as Partial<KycDetails> | null)?.entityType ?? null })));
});

platformKycRoutes.get("/:tenantId", async (c) => {
  const k = await load(c.get("db"), c.req.param("tenantId"));
  const admins = await companyAdmins(c.get("db"), k.tenant.id);
  return c.json({ ...k, admins: admins.map((a) => ({ name: a.name, email: a.email })) });
});

platformKycRoutes.get("/:tenantId/documents/:id", async (c) => {
  const [d] = await c.get("db").select().from(kycDocuments).where(and(eq(kycDocuments.id, c.req.param("id")), eq(kycDocuments.tenantId, c.req.param("tenantId"))));
  if (!d) throw notFound("Document");
  const f = await getFile(c.env, d.fileKey);
  if (!f) throw notFound("Document");
  return c.body(f.body as ArrayBuffer, 200, { "Content-Type": d.mimeType, "Content-Disposition": `inline; filename="${d.fileName}"`, "Cache-Control": "private, no-store" });
});

platformKycRoutes.post("/:tenantId/decision", v("json", kycDecisionSchema), async (c) => {
  const db = c.get("db");
  const k = await load(db, c.req.param("tenantId"));
  const { decision, note } = c.req.valid("json");
  if (k.status !== "submitted" && !(decision === "approve" && k.status !== "approved")) throw badRequest("Only a KYC that's been sent can be decided");
  const s = c.get("session")!;
  const now = new Date();
  const status: KycStatus = decision === "approve" ? "approved" : decision === "needs_info" ? "needs_info" : "rejected";
  await db.insert(companyKyc).values({ tenantId: k.tenant.id, details: k.details }).onConflictDoNothing();
  await db.update(companyKyc).set({ reviewedAt: now, reviewedBy: s.userId, reviewerName: s.name, reviewNote: note || null, history: [...k.history, { at: now.toISOString(), by: s.name, action: status, ...(note ? { note } : {}) }], updatedAt: now }).where(eq(companyKyc.tenantId, k.tenant.id));
  await db.update(tenants).set({ kycStatus: status }).where(eq(tenants.id, k.tenant.id));
  await audit(c, { tenantId: k.tenant.id, action: `kyc.${status}`, entity: "tenant", entityId: k.tenant.id, summary: `KYC ${status === "approved" ? "approved" : status === "needs_info" ? "sent back for more information" : "rejected"}${note ? `: ${note}` : ""}` });
  const mailer = mailerFor(c.env);
  const copy = {
    approved: { subject: `${k.tenant.name} is verified`, heading: "Your company is verified", lines: ["We've checked your KYC and everything is in order. You can now add employees, run payroll and use all of Saralix."], cta: "Open Saralix" },
    needs_info: { subject: `We need a bit more for ${k.tenant.name}'s KYC`, heading: "We need a little more information", lines: ["We've looked at your KYC and need something more before we can verify your company:", note, "Make the change and send it again. We'll check it within one working day."], cta: "Update my KYC" },
    rejected: { subject: `${k.tenant.name}'s KYC wasn't approved`, heading: "We couldn't verify your company", lines: ["We've looked at your KYC and can't approve it:", note, "If you think this is a mistake, reply to this email or raise a support ticket."], cta: "Open Saralix" },
  }[status as "approved" | "needs_info" | "rejected"];
  for (const a of await companyAdmins(db, k.tenant.id)) {
    const { html, text } = layout({ company: "Saralix", heading: copy.heading, paragraphs: [`Hi ${a.name.split(" ")[0]},`, ...copy.lines.filter(Boolean)], cta: { label: copy.cta, url: `${c.env.APP_URL}/${status === "needs_info" ? "kyc" : ""}` } });
    await mailer.send({ to: a.email, subject: copy.subject, html, text }).catch((e) => console.error("kyc decision email failed", e));
  }
  return c.json({ ok: true, status });
});
