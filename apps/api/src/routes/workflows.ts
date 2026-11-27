import { Hono, type Context } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { employees, formSubmissions, forms, memberships, roles, tenants, user, type Database } from "@hrms/db";
import { checkFormAnswers, formDecisionSchema, fmtAnswer, formSchema, inAudience, nextApprover, SUBMISSION_STATUS, type FormField, type FormStep } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { toCsv } from "../lib/csv";
import { getFile, putFile, safeName } from "../lib/storage";
import { sendNotification } from "../services/notifications";
import { imageType } from "./photos";

type Form = typeof forms.$inferSelect;
type Submission = typeof formSubmissions.$inferSelect;
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const MAX_FILE = 10 * 1024 * 1024;

const out = (f: Form) => ({ id: f.id, title: f.title, description: f.description, fields: f.fields, steps: f.steps, audience: f.audience, status: f.status, publishedAt: f.publishedAt, updatedAt: f.updatedAt });

async function nextCode(db: Database, tenantId: string) {
  const [r] = await db.select({ n: sql<number>`coalesce(max(substring(${formSubmissions.code} from 4)::int), 1000)::int` }).from(formSubmissions).where(eq(formSubmissions.tenantId, tenantId));
  return `RQ-${(r?.n ?? 1000) + 1}`;
}

async function companyName(c: Context<AppEnv>) {
  const [t] = await c.get("db").select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
  return t?.name ?? "Saralix";
}

async function mail(c: Context<AppEnv>, key: "forms_to_approve" | "form_decision", to: string[], subject: string, paragraphs: string[], path: string) {
  if (!to.length) return;
  const { html, text } = layout({ company: await companyName(c), heading: subject, paragraphs, cta: { label: "Open it", url: `${c.env.APP_URL}${path}` } });
  for (const addr of [...new Set(to)]) await sendNotification(c, key, { to: addr, subject, html, text }).catch((e) => console.error("forms email failed", e));
}

/** Everyone who can approve HR steps: admins and HR admins. */
async function hrEmails(c: Context<AppEnv>) {
  const rows = await c.get("db").select({ email: user.email }).from(memberships).innerJoin(user, eq(user.id, memberships.userId)).innerJoin(roles, eq(roles.id, memberships.roleId)).where(and(eq(memberships.tenantId, tid(c)), eq(memberships.status, "active"), inArray(roles.key, ["super_admin", "hr_admin"])));
  return rows.map((r) => r.email);
}

/** Move a request to its next step (or approve it when none is left), and tell whoever acts next. */
async function advance(c: Context<AppEnv>, s: Submission, from: number) {
  const db = c.get("db");
  const [emp] = await db.select({ id: employees.id, name: employees.fullName, managerId: employees.managerId, email: employees.workEmail, first: employees.firstName }).from(employees).where(eq(employees.id, s.employeeId));
  const next = nextApprover(s.steps as FormStep[], from, { employeeId: s.employeeId, managerId: emp?.managerId ?? null });
  if (!next) {
    await db.update(formSubmissions).set({ status: "approved", stepIndex: s.steps.length, approverId: null, stepKind: null, decidedAt: new Date(), updatedAt: new Date() }).where(eq(formSubmissions.id, s.id));
    if (from > 0 && emp?.email) await mail(c, "form_decision", [emp.email], `${s.title} approved`, [`Hi ${emp.first},`, `Your request ${s.code} (${s.title}) has been approved.`], `/me/forms/${s.id}`);
    return "approved" as const;
  }
  await db.update(formSubmissions).set({ stepIndex: next.index, approverId: next.employeeId, stepKind: next.kind, updatedAt: new Date() }).where(eq(formSubmissions.id, s.id));
  const line = `${emp?.name ?? "Someone"} sent ${s.code}: ${s.title}. It's waiting for you to approve or reject.`;
  if (next.kind === "hr") await mail(c, "forms_to_approve", await hrEmails(c), `${s.title} from ${emp?.name ?? "an employee"}`, [line], `/forms/requests/${s.id}`);
  else {
    const [a] = await db.select({ email: employees.workEmail, first: employees.firstName }).from(employees).where(eq(employees.id, next.employeeId!));
    if (a?.email) await mail(c, "forms_to_approve", [a.email], `${s.title} from ${emp?.name ?? "an employee"}`, [`Hi ${a.first},`, line], `/me/forms/${s.id}`);
  }
  return "pending" as const;
}

async function decide(c: Context<AppEnv>, s: Submission, decision: "approve" | "reject", note: string) {
  if (s.status !== "pending") throw conflict("This request has already been decided");
  const session = c.get("session")!;
  const history = [...s.history, { step: s.stepIndex, kind: s.stepKind ?? "", by: session.userId, byName: session.name, decision, note, at: new Date().toISOString() }];
  const db = c.get("db");
  if (decision === "reject") {
    await db.update(formSubmissions).set({ status: "rejected", history, approverId: null, decidedAt: new Date(), updatedAt: new Date() }).where(eq(formSubmissions.id, s.id));
    const [emp] = await db.select({ email: employees.workEmail, first: employees.firstName }).from(employees).where(eq(employees.id, s.employeeId));
    if (emp?.email) await mail(c, "form_decision", [emp.email], `${s.title} rejected`, [`Hi ${emp.first},`, `${session.name} rejected your request ${s.code} (${s.title}).`, `Their reason: ${note}`], `/me/forms/${s.id}`);
  } else {
    await db.update(formSubmissions).set({ history, updatedAt: new Date() }).where(eq(formSubmissions.id, s.id));
    await advance(c, { ...s, history }, s.stepIndex + 1);
  }
  await audit(c, { action: `form.${decision}`, entity: "form_submission", entityId: s.id, summary: `${s.code} ${s.title}${note ? `: ${note}` : ""}` });
  const [row] = await db.select().from(formSubmissions).where(eq(formSubmissions.id, s.id));
  return row!;
}

/** Names for the people on a list of requests, and who has to act. */
async function shape(db: Database, rows: Submission[]) {
  const ids = [...new Set(rows.flatMap((r) => [r.employeeId, ...(r.approverId ? [r.approverId] : [])]))];
  const people = ids.length ? new Map((await db.select({ id: employees.id, name: employees.fullName, code: employees.employeeCode }).from(employees).where(inArray(employees.id, ids))).map((e) => [e.id, e])) : new Map<string, { id: string; name: string; code: string }>();
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    formId: r.formId,
    title: r.title,
    status: r.status,
    stepIndex: r.stepIndex,
    steps: r.steps.length,
    stepKind: r.stepKind,
    employee: people.get(r.employeeId) ?? null,
    approver: r.stepKind === "hr" ? { id: null, name: "HR" } : r.approverId ? { id: r.approverId, name: people.get(r.approverId)?.name ?? "" } : null,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
  }));
}

async function detail(db: Database, s: Submission) {
  const [base] = await shape(db, [s]);
  return { ...base!, fields: s.fields, answers: s.answers, files: Object.fromEntries(Object.entries(s.files).map(([k, f]) => [k, { name: f.name, size: f.size }])), history: s.history, stepList: s.steps };
}

async function sendFile(c: Context<AppEnv>, s: Submission, fieldId: string) {
  const f = s.files[fieldId];
  if (!f) throw notFound("File");
  const obj = await getFile(c.env, f.key);
  if (!obj) throw notFound("File");
  return c.body(obj.body as ArrayBuffer, 200, { "Content-Type": f.type, "Content-Disposition": `inline; filename="${f.name}"`, "Cache-Control": "private, no-store" });
}

/* ---------------- HR ---------------- */

export const formRoutes = new Hono<AppEnv>();
formRoutes.use("*", requirePerm("employees", "edit"));

async function loadForm(c: Context<AppEnv>, id: string) {
  const [f] = await c.get("db").select().from(forms).where(and(eq(forms.id, id), eq(forms.tenantId, tid(c))));
  if (!f) throw notFound("Form");
  return f;
}
async function loadSub(c: Context<AppEnv>, id: string) {
  const [s] = await c.get("db").select().from(formSubmissions).where(and(eq(formSubmissions.id, id), eq(formSubmissions.tenantId, tid(c))));
  if (!s) throw notFound("Request");
  return s;
}

formRoutes.get("/", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(forms).where(eq(forms.tenantId, tid(c))).orderBy(desc(forms.updatedAt));
  const counts = await db.select({ formId: formSubmissions.formId, total: sql<number>`count(*)::int`, pending: sql<number>`count(*) filter (where ${formSubmissions.status} = 'pending')::int` }).from(formSubmissions).where(eq(formSubmissions.tenantId, tid(c))).groupBy(formSubmissions.formId);
  const by = new Map(counts.map((r) => [r.formId, r]));
  return c.json(rows.map((f) => ({ ...out(f), total: by.get(f.id)?.total ?? 0, pending: by.get(f.id)?.pending ?? 0 })));
});

const fields = (b: ReturnType<typeof formSchema.parse>) => ({ title: b.title, description: b.description, fields: b.fields, steps: b.steps, audience: { departmentIds: b.departmentIds, branchIds: b.branchIds } });

async function checkPeople(c: Context<AppEnv>, steps: FormStep[]) {
  const ids = steps.filter((s) => s.kind === "person").map((s) => s.employeeId!);
  if (!ids.length) return;
  const found = await c.get("db").select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, tid(c)), inArray(employees.id, ids)));
  if (found.length !== new Set(ids).size) throw badRequest("Pick an approver from your company");
}

formRoutes.post("/", v("json", formSchema), async (c) => {
  const b = c.req.valid("json");
  await checkPeople(c, b.steps);
  const [row] = await c.get("db").insert(forms).values({ ...fields(b), tenantId: tid(c), createdBy: c.get("session")!.userId }).returning();
  await audit(c, { action: "form.create", entity: "form", entityId: row!.id, summary: row!.title });
  return c.json(out(row!), 201);
});

/** Requests across forms: HR's queue (?queue=1), or by form and status. */
formRoutes.get("/requests", async (c) => {
  const status = c.req.query("status");
  const formId = c.req.query("formId");
  const rows = await c
    .get("db")
    .select()
    .from(formSubmissions)
    .where(and(eq(formSubmissions.tenantId, tid(c)), c.req.query("queue") ? and(eq(formSubmissions.status, "pending"), eq(formSubmissions.stepKind, "hr")) : undefined, status && (SUBMISSION_STATUS as readonly string[]).includes(status) ? eq(formSubmissions.status, status) : undefined, formId ? eq(formSubmissions.formId, formId) : undefined))
    .orderBy(desc(formSubmissions.createdAt))
    .limit(500);
  return c.json(await shape(c.get("db"), rows));
});

formRoutes.get("/requests/:sid", async (c) => c.json(await detail(c.get("db"), await loadSub(c, c.req.param("sid")))));
formRoutes.get("/requests/:sid/files/:fieldId", async (c) => sendFile(c, await loadSub(c, c.req.param("sid")), c.req.param("fieldId")));
formRoutes.post("/requests/:sid/decision", v("json", formDecisionSchema), async (c) => {
  const s = await loadSub(c, c.req.param("sid"));
  if (s.stepKind !== "hr") throw forbidden("This step is for someone else to approve");
  const b = c.req.valid("json");
  return c.json(await detail(c.get("db"), await decide(c, s, b.decision, b.note)));
});

formRoutes.get("/:id", async (c) => c.json(out(await loadForm(c, c.req.param("id")))));

formRoutes.put("/:id", v("json", formSchema), async (c) => {
  const x = await loadForm(c, c.req.param("id"));
  if (x.status === "archived") throw conflict("Archived forms can't be changed");
  const b = c.req.valid("json");
  await checkPeople(c, b.steps);
  const [row] = await c.get("db").update(forms).set({ ...fields(b), updatedAt: new Date() }).where(eq(forms.id, x.id)).returning();
  return c.json(out(row!));
});

formRoutes.post("/:id/publish", async (c) => {
  const x = await loadForm(c, c.req.param("id"));
  if (x.status === "published") return c.json(out(x));
  const [row] = await c.get("db").update(forms).set({ status: "published", publishedAt: x.publishedAt ?? new Date(), updatedAt: new Date() }).where(eq(forms.id, x.id)).returning();
  await audit(c, { action: "form.publish", entity: "form", entityId: x.id, summary: x.title });
  return c.json(out(row!));
});

formRoutes.post("/:id/archive", async (c) => {
  const x = await loadForm(c, c.req.param("id"));
  const [row] = await c.get("db").update(forms).set({ status: "archived", updatedAt: new Date() }).where(eq(forms.id, x.id)).returning();
  await audit(c, { action: "form.archive", entity: "form", entityId: x.id, summary: x.title });
  return c.json(out(row!));
});

formRoutes.delete("/:id", async (c) => {
  const x = await loadForm(c, c.req.param("id"));
  const [any] = await c.get("db").select({ id: formSubmissions.id }).from(formSubmissions).where(eq(formSubmissions.formId, x.id)).limit(1);
  if (any) throw conflict("People have used this form. Archive it instead, so their requests stay.");
  await c.get("db").delete(forms).where(eq(forms.id, x.id));
  await audit(c, { action: "form.delete", entity: "form", entityId: x.id, summary: x.title });
  return c.json({ ok: true });
});

formRoutes.get("/:id/export", async (c) => {
  const x = await loadForm(c, c.req.param("id"));
  const db = c.get("db");
  const rows = await db.select().from(formSubmissions).where(eq(formSubmissions.formId, x.id)).orderBy(desc(formSubmissions.createdAt));
  const shaped = await shape(db, rows);
  const cols = x.fields as FormField[];
  const header = ["Request", "Employee", "Employee code", "Sent on", "Status", ...cols.map((f) => f.label)];
  const data = rows.map((r, i) => [r.code, shaped[i]!.employee?.name ?? "", shaped[i]!.employee?.code ?? "", r.createdAt.toISOString().slice(0, 10), r.status, ...cols.map((f) => (f.type === "file" ? r.files[f.id]?.name ?? "" : fmtAnswer(f as FormField, r.answers[f.id])))]);
  const name = safeName(x.title).replace(/\.[a-z]+$/i, "") || "requests";
  return c.body(toCsv(header, data), 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` });
});

/* ---------------- employees ---------------- */

export const essFormRoutes = new Hono<AppEnv>();
essFormRoutes.use("*", requireEmployee);
const me = (c: Context<AppEnv>) => c.get("tenant").employeeId!;

async function myForms(c: Context<AppEnv>) {
  const db = c.get("db");
  const [emp] = await db.select({ departmentId: employees.departmentId, branchId: employees.branchId }).from(employees).where(eq(employees.id, me(c)));
  const rows = await db.select().from(forms).where(and(eq(forms.tenantId, tid(c)), eq(forms.status, "published"))).orderBy(forms.title);
  return rows.filter((f) => emp && inAudience(f.audience, emp));
}

/** A request I may see: mine, waiting for me, or one I decided. */
async function visible(c: Context<AppEnv>, id: string) {
  const [s] = await c.get("db").select().from(formSubmissions).where(and(eq(formSubmissions.id, id), eq(formSubmissions.tenantId, tid(c))));
  if (!s) throw notFound("Request");
  const uid = c.get("session")!.userId;
  if (s.employeeId !== me(c) && s.approverId !== me(c) && !s.history.some((h) => h.by === uid)) throw notFound("Request");
  return s;
}

essFormRoutes.get("/", async (c) => {
  const db = c.get("db");
  const available = await myForms(c);
  const mine = await db.select().from(formSubmissions).where(and(eq(formSubmissions.tenantId, tid(c)), eq(formSubmissions.employeeId, me(c)))).orderBy(desc(formSubmissions.createdAt)).limit(200);
  const [waiting] = await db.select({ n: sql<number>`count(*)::int` }).from(formSubmissions).where(and(eq(formSubmissions.tenantId, tid(c)), eq(formSubmissions.approverId, me(c)), eq(formSubmissions.status, "pending")));
  return c.json({ forms: available.map((f) => ({ id: f.id, title: f.title, description: f.description, steps: f.steps.length })), mine: await shape(db, mine), toApprove: waiting?.n ?? 0 });
});

essFormRoutes.get("/approvals", async (c) => {
  const db = c.get("db");
  const uid = c.get("session")!.userId;
  const waiting = await db.select().from(formSubmissions).where(and(eq(formSubmissions.tenantId, tid(c)), eq(formSubmissions.approverId, me(c)), eq(formSubmissions.status, "pending"))).orderBy(formSubmissions.createdAt);
  const done = await db.select().from(formSubmissions).where(and(eq(formSubmissions.tenantId, tid(c)), sql`${formSubmissions.history} @> ${JSON.stringify([{ by: uid }])}::jsonb`)).orderBy(desc(formSubmissions.updatedAt)).limit(50);
  return c.json({ waiting: await shape(db, waiting), decided: await shape(db, done) });
});

essFormRoutes.get("/form/:id", async (c) => {
  const f = (await myForms(c)).find((x) => x.id === c.req.param("id"));
  if (!f) throw notFound("Form");
  return c.json({ id: f.id, title: f.title, description: f.description, fields: f.fields, steps: f.steps.map((s) => s.kind) });
});

/** Send a filled in form: multipart with `answers` (JSON) and a `file:<fieldId>` part per file field. */
essFormRoutes.post("/form/:id", async (c) => {
  const f = (await myForms(c)).find((x) => x.id === c.req.param("id"));
  if (!f) throw notFound("Form");
  const body = await c.req.formData();
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(String(body.get("answers") ?? "{}"));
  } catch {
    throw badRequest("Answers aren't readable");
  }
  const fileFields = (f.fields as FormField[]).filter((x) => x.type === "file");
  const uploads: { fieldId: string; file: File; bytes: Uint8Array; type: string }[] = [];
  for (const ff of fileFields) {
    const file = body.get(`file:${ff.id}`);
    if (!(file instanceof File) || !file.size) continue;
    if (file.size > MAX_FILE) throw badRequest(`${ff.label}: files must be 10 MB or smaller`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? "application/pdf" : imageType(bytes);
    if (!type) throw badRequest(`${ff.label}: attach a PDF or an image`);
    uploads.push({ fieldId: ff.id, file, bytes, type });
  }
  const r = checkFormAnswers(f.fields as FormField[], raw, new Set(uploads.map((u) => u.fieldId)));
  if (!r.ok) throw badRequest("Check the highlighted fields", { fields: r.errors });
  const db = c.get("db");
  const files: Submission["files"] = {};
  for (const u of uploads) {
    const key = `tenants/${tid(c)}/forms/${f.id}/${crypto.randomUUID()}`;
    await putFile(c.env, key, u.bytes.buffer as ArrayBuffer, u.type);
    files[u.fieldId] = { key, name: safeName(u.file.name || "file"), type: u.type, size: u.file.size };
  }
  const [s] = await db.insert(formSubmissions).values({ tenantId: tid(c), formId: f.id, code: await nextCode(db, tid(c)), employeeId: me(c), title: f.title, fields: f.fields, steps: f.steps, answers: r.answers, files }).returning();
  const status = await advance(c, s!, 0);
  await audit(c, { action: "form.submit", entity: "form_submission", entityId: s!.id, summary: `${s!.code} ${f.title}` });
  return c.json({ id: s!.id, code: s!.code, status }, 201);
});

essFormRoutes.get("/requests/:sid", async (c) => c.json({ ...(await detail(c.get("db"), await visible(c, c.req.param("sid")))), mine: (await visible(c, c.req.param("sid"))).employeeId === me(c) }));
essFormRoutes.get("/requests/:sid/files/:fieldId", async (c) => sendFile(c, await visible(c, c.req.param("sid")), c.req.param("fieldId")));

essFormRoutes.post("/requests/:sid/decision", v("json", formDecisionSchema), async (c) => {
  const s = await visible(c, c.req.param("sid"));
  if (s.status !== "pending" || s.approverId !== me(c)) throw forbidden("This request isn't waiting for you");
  const b = c.req.valid("json");
  return c.json(await detail(c.get("db"), await decide(c, s, b.decision, b.note)));
});

essFormRoutes.post("/requests/:sid/withdraw", async (c) => {
  const s = await visible(c, c.req.param("sid"));
  if (s.employeeId !== me(c)) throw forbidden();
  if (s.status !== "pending") throw conflict("Only a request that's still waiting can be withdrawn");
  await c.get("db").update(formSubmissions).set({ status: "withdrawn", approverId: null, decidedAt: new Date(), updatedAt: new Date() }).where(eq(formSubmissions.id, s.id));
  await audit(c, { action: "form.withdraw", entity: "form_submission", entityId: s.id, summary: `${s.code} ${s.title}` });
  return c.json({ ok: true });
});
