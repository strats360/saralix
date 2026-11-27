import { Hono, type Context } from "hono";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { attendanceDevices, attendancePunches, branches, createDb, employees, faceTemplates, kioskEvents, tenants, type Database } from "@hrms/db";
import { consistentSamples, faceEnrollSchema, KIOSK_REPEAT_SECONDS, KIOSK_UNDO_SECONDS, kioskPairSchema, kioskPunchSchema, matchFace, randomToken, sha256Hex } from "@hrms/shared";
import type { AppEnv, Env } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { ApiError, badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { deleteFile, getFile, putFile } from "../lib/storage";
import { featuresFor } from "../services/flags";
import { ingestPunches, recomputeDays } from "../services/attendance-import";

type Device = typeof attendanceDevices.$inferSelect;
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const ACTIVE = ["onboarding", "probation", "active", "notice"];
const PAIR_MINUTES = 30;
/** Kiosk photos are kept this long, then removed. */
export const KIOSK_PHOTO_DAYS = 90;

/** An 8 character pairing code, without letters that look like digits. */
function pairCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => abc[b % abc.length]).join("");
}

async function newKey(deviceId: string) {
  const secret = randomToken(24);
  return { key: `dev_${deviceId}.${secret}`, keyHash: await sha256Hex(secret), keyHint: secret.slice(-4) };
}

const view = (d: Device, branch?: string | null) => ({ id: d.id, name: d.name, branchId: d.branchId, branch: branch ?? null, active: d.active, paired: !d.pairCodeHash || !!d.lastSeenAt, pairExpiresAt: d.pairCodeHash ? d.pairExpiresAt : null, lastSeenAt: d.lastSeenAt, lastPunchAt: d.lastPunchAt, punchCount: d.punchCount, createdAt: d.createdAt });

async function saveSamples(db: Database, tenantId: string, employeeId: string, samples: number[][], via: "self" | "hr", by: string) {
  if (!consistentSamples(samples)) throw badRequest("The photos don't look like the same person. Make sure only one face is in view and try again.");
  await db
    .insert(faceTemplates)
    .values({ tenantId, employeeId, samples, consentAt: new Date(), enrolledVia: via, enrolledBy: by })
    .onConflictDoUpdate({ target: faceTemplates.employeeId, set: { samples, consentAt: new Date(), enrolledVia: via, enrolledBy: by, updatedAt: new Date() } });
}

/* ---------------- HR ---------------- */

export const faceKioskRoutes = new Hono<AppEnv>();
faceKioskRoutes.use("*", requirePerm("attendance", "configure"));

faceKioskRoutes.get("/kiosks", async (c) => {
  const rows = await c.get("db").select({ d: attendanceDevices, branch: branches.name }).from(attendanceDevices).leftJoin(branches, eq(branches.id, attendanceDevices.branchId)).where(and(eq(attendanceDevices.tenantId, tid(c)), eq(attendanceDevices.kind, "kiosk"))).orderBy(desc(attendanceDevices.createdAt));
  return c.json(rows.map((r) => view(r.d, r.branch)));
});

const kioskSchema = z.object({ name: z.string().trim().min(2, "Name the kiosk").max(80), branchId: z.string().nullable().default(null) });

/** Returns a one-time pairing code to type on the tablet or phone. */
faceKioskRoutes.post("/kiosks", v("json", kioskSchema), async (c) => {
  const b = c.req.valid("json");
  const id = crypto.randomUUID();
  const k = await newKey(id);
  const code = pairCode();
  const [d] = await c.get("db").insert(attendanceDevices).values({ id, tenantId: tid(c), kind: "kiosk", name: b.name, branchId: b.branchId, keyHash: k.keyHash, keyHint: k.keyHint, pairCodeHash: await sha256Hex(code), pairExpiresAt: new Date(Date.now() + PAIR_MINUTES * 60_000), createdBy: c.get("session")!.userId }).returning();
  await audit(c, { action: "kiosk.add", entity: "attendance_device", entityId: id, summary: `Added face kiosk ${b.name}` });
  return c.json({ ...view(d!), code }, 201);
});

/** A new pairing code. The kiosk paired before stops working once the new one is used. */
faceKioskRoutes.post("/kiosks/:id/pair", async (c) => {
  const db = c.get("db");
  const [d] = await db.select().from(attendanceDevices).where(and(eq(attendanceDevices.id, c.req.param("id")), eq(attendanceDevices.tenantId, tid(c)), eq(attendanceDevices.kind, "kiosk")));
  if (!d) throw notFound("Kiosk");
  const code = pairCode();
  const [row] = await db.update(attendanceDevices).set({ pairCodeHash: await sha256Hex(code), pairExpiresAt: new Date(Date.now() + PAIR_MINUTES * 60_000) }).where(eq(attendanceDevices.id, d.id)).returning();
  await audit(c, { action: "kiosk.pair_code", entity: "attendance_device", entityId: d.id, summary: `New pairing code for face kiosk ${d.name}` });
  return c.json({ ...view(row!), code });
});

faceKioskRoutes.patch("/kiosks/:id", v("json", z.object({ active: z.boolean().optional(), name: z.string().trim().min(2).max(80).optional() })), async (c) => {
  const b = c.req.valid("json");
  const [row] = await c.get("db").update(attendanceDevices).set(b).where(and(eq(attendanceDevices.id, c.req.param("id")), eq(attendanceDevices.tenantId, tid(c)), eq(attendanceDevices.kind, "kiosk"))).returning();
  if (!row) throw notFound("Kiosk");
  await audit(c, { action: "kiosk.update", entity: "attendance_device", entityId: row.id, summary: `${b.active === false ? "Turned off" : b.active ? "Turned on" : "Renamed"} face kiosk ${row.name}` });
  return c.json(view(row));
});

/** Everyone who can punch, and whether their face is enrolled. */
faceKioskRoutes.get("/people", async (c) => {
  const rows = await c
    .get("db")
    .select({ id: employees.id, name: employees.fullName, code: employees.employeeCode, enrolledAt: faceTemplates.updatedAt, via: faceTemplates.enrolledVia })
    .from(employees)
    .leftJoin(faceTemplates, eq(faceTemplates.employeeId, employees.id))
    .where(and(eq(employees.tenantId, tid(c)), inArray(employees.status, ACTIVE)))
    .orderBy(employees.fullName);
  return c.json(rows);
});

/** HR enrols someone on this device, with the person there and agreeing. */
faceKioskRoutes.post("/people/:employeeId", v("json", faceEnrollSchema), async (c) => {
  const [e] = await c.get("db").select({ id: employees.id, name: employees.fullName }).from(employees).where(and(eq(employees.id, c.req.param("employeeId")), eq(employees.tenantId, tid(c))));
  if (!e) throw notFound("Employee");
  await saveSamples(c.get("db"), tid(c), e.id, c.req.valid("json").descriptors, "hr", c.get("session")!.userId);
  await audit(c, { action: "face.enroll", entity: "employee", entityId: e.id, summary: `Enrolled ${e.name}'s face for the kiosk, with their consent` });
  return c.json({ ok: true });
});

faceKioskRoutes.delete("/people/:employeeId", async (c) => {
  const rows = await c.get("db").delete(faceTemplates).where(and(eq(faceTemplates.employeeId, c.req.param("employeeId")), eq(faceTemplates.tenantId, tid(c)))).returning({ id: faceTemplates.id });
  if (!rows.length) throw notFound("Enrolled face");
  await audit(c, { action: "face.remove", entity: "employee", entityId: c.req.param("employeeId"), summary: "Removed an enrolled face" });
  return c.json({ ok: true });
});

/** What the kiosks saw lately, newest first. */
faceKioskRoutes.get("/events", async (c) => {
  const result = c.req.query("result");
  const rows = await c
    .get("db")
    .select({ id: kioskEvents.id, result: kioskEvents.result, distance: kioskEvents.distance, hasPhoto: sql<boolean>`${kioskEvents.photoKey} is not null`, createdAt: kioskEvents.createdAt, kiosk: attendanceDevices.name, employee: employees.fullName, code: employees.employeeCode })
    .from(kioskEvents)
    .innerJoin(attendanceDevices, eq(attendanceDevices.id, kioskEvents.deviceId))
    .leftJoin(employees, eq(employees.id, kioskEvents.employeeId))
    .where(and(eq(kioskEvents.tenantId, tid(c)), result ? eq(kioskEvents.result, result) : undefined))
    .orderBy(desc(kioskEvents.createdAt))
    .limit(300);
  return c.json(rows);
});

faceKioskRoutes.get("/events/:id/photo", async (c) => {
  const [e] = await c.get("db").select({ key: kioskEvents.photoKey }).from(kioskEvents).where(and(eq(kioskEvents.id, c.req.param("id")), eq(kioskEvents.tenantId, tid(c))));
  if (!e?.key) throw notFound("Photo");
  const f = await getFile(c.env, e.key);
  if (!f) throw notFound("Photo");
  return c.body(f.body as ArrayBuffer, 200, { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" });
});

/* ---------------- employees ---------------- */

export const essFaceRoutes = new Hono<AppEnv>();
essFaceRoutes.use("*", requireEmployee);

essFaceRoutes.get("/", async (c) => {
  const [t] = await c.get("db").select({ at: faceTemplates.updatedAt, via: faceTemplates.enrolledVia }).from(faceTemplates).where(eq(faceTemplates.employeeId, c.get("tenant").employeeId!));
  return c.json({ enrolled: !!t, enrolledAt: t?.at ?? null, via: t?.via ?? null });
});

essFaceRoutes.post("/", v("json", faceEnrollSchema), async (c) => {
  const eid = c.get("tenant").employeeId!;
  await saveSamples(c.get("db"), tid(c), eid, c.req.valid("json").descriptors, "self", c.get("session")!.userId);
  await audit(c, { action: "face.enroll", entity: "employee", entityId: eid, summary: "Enrolled their face for the kiosk, with consent" });
  return c.json({ ok: true });
});

essFaceRoutes.delete("/", async (c) => {
  const eid = c.get("tenant").employeeId!;
  await c.get("db").delete(faceTemplates).where(eq(faceTemplates.employeeId, eid));
  await audit(c, { action: "face.remove", entity: "employee", entityId: eid, summary: "Removed their enrolled face" });
  return c.json({ ok: true });
});

/* ---------------- the kiosk itself ---------------- */

export const kioskPublicRoutes = new Hono<AppEnv>();

kioskPublicRoutes.post("/pair", v("json", kioskPairSchema), async (c) => {
  const db = c.get("db");
  const hash = await sha256Hex(c.req.valid("json").code);
  const [d] = await db.select().from(attendanceDevices).where(and(eq(attendanceDevices.pairCodeHash, hash), eq(attendanceDevices.kind, "kiosk")));
  if (!d || !d.pairExpiresAt || d.pairExpiresAt < new Date()) throw badRequest("That code is wrong or has expired. Ask HR for a new one.");
  const k = await newKey(d.id);
  await db.update(attendanceDevices).set({ keyHash: k.keyHash, keyHint: k.keyHint, pairCodeHash: null, pairExpiresAt: null, lastSeenAt: new Date() }).where(eq(attendanceDevices.id, d.id));
  return c.json({ key: k.key, name: d.name });
});

/** The kiosk signs every request with its key. Turned off kiosks and companies without the add-on are refused. */
async function kiosk(c: Context<AppEnv>) {
  const m = (c.req.header("authorization") ?? "").match(/^Bearer dev_([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/);
  if (!m) throw new ApiError(401, "This kiosk isn't paired", "unauthorized");
  const db = c.get("db");
  const [d] = await db.select().from(attendanceDevices).where(and(eq(attendanceDevices.id, m[1]!), eq(attendanceDevices.kind, "kiosk")));
  if (!d || d.keyHash !== (await sha256Hex(m[2]!))) throw new ApiError(401, "This kiosk isn't paired any more. Ask HR for a new code.", "unauthorized");
  if (!d.active) throw new ApiError(403, "HR has turned this kiosk off", "forbidden");
  const [t] = await db.select({ name: tenants.name, plan: tenants.plan, status: tenants.status, kycStatus: tenants.kycStatus }).from(tenants).where(eq(tenants.id, d.tenantId));
  if (!t || t.status === "suspended" || t.status === "cancelled" || t.kycStatus !== "approved") throw new ApiError(403, "This company's account isn't active", "forbidden");
  if (!(await featuresFor(db, { id: d.tenantId, plan: t.plan }))["addon.face_kiosk"]) throw new ApiError(403, "The face kiosk add-on is off for this company", "forbidden");
  return { d, company: t.name };
}

kioskPublicRoutes.get("/me", async (c) => {
  const { d, company } = await kiosk(c);
  await c.get("db").update(attendanceDevices).set({ lastSeenAt: new Date() }).where(eq(attendanceDevices.id, d.id));
  return c.json({ name: d.name, company });
});

kioskPublicRoutes.post("/punch", v("json", kioskPunchSchema), async (c) => {
  const { d } = await kiosk(c);
  const b = c.req.valid("json");
  const db = c.get("db");
  const people = await db
    .select({ id: employees.id, samples: faceTemplates.samples })
    .from(faceTemplates)
    .innerJoin(employees, eq(employees.id, faceTemplates.employeeId))
    .where(and(eq(faceTemplates.tenantId, d.tenantId), inArray(employees.status, ACTIVE)));
  const match = matchFace(b.descriptor, people);
  const eventId = crypto.randomUUID();
  let photoKey: string | null = null;
  if (b.photo) {
    const bytes = Uint8Array.from(atob(b.photo.slice(b.photo.indexOf(",") + 1)), (ch) => ch.charCodeAt(0));
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      photoKey = `tenants/${d.tenantId}/kiosk/${eventId}.jpg`;
      await putFile(c.env, photoKey, bytes.buffer as ArrayBuffer, "image/jpeg");
    }
  }
  const log = (result: string, employeeId: string | null, punchedAt: Date | null = null) => db.insert(kioskEvents).values({ id: eventId, tenantId: d.tenantId, deviceId: d.id, employeeId, result, distance: match.distance, photoKey, punchedAt });
  if (match.status !== "matched") {
    await log(match.status, null);
    return c.json({ result: match.status });
  }
  const [e] = await db.select({ id: employees.id, code: employees.employeeCode, name: employees.fullName, first: employees.firstName }).from(employees).where(eq(employees.id, match.id));
  const now = new Date();
  const [recent] = await db.select({ at: attendancePunches.punchedAt }).from(attendancePunches).where(and(eq(attendancePunches.employeeId, e!.id), gte(attendancePunches.punchedAt, new Date(now.getTime() - KIOSK_REPEAT_SECONDS * 1000)))).limit(1);
  if (recent) {
    await log("repeat", e!.id);
    return c.json({ result: "repeat", name: e!.name, first: e!.first, at: recent.at });
  }
  const r = await ingestPunches(db, d, [{ userId: e!.code, time: now.toISOString() }], "kiosk");
  if (!r.accepted) {
    await log("unknown", e!.id);
    return c.json({ result: "unknown" });
  }
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(attendancePunches).where(and(eq(attendancePunches.employeeId, e!.id), gte(attendancePunches.punchedAt, new Date(now.getTime() - 20 * 3600_000)), lt(attendancePunches.punchedAt, now)))) as [{ n: number }];
  await log("punched", e!.id, now);
  return c.json({ result: "punched", eventId, name: e!.name, first: e!.first, direction: n ? "out" : "in", at: now, undoSeconds: KIOSK_UNDO_SECONDS, note: r.skipped[0] ?? null });
});

/** "Not you?": takes the punch back, if it's recent and from this kiosk. */
kioskPublicRoutes.post("/undo", v("json", z.object({ eventId: z.string().uuid() })), async (c) => {
  const { d } = await kiosk(c);
  const db = c.get("db");
  const [ev] = await db.select().from(kioskEvents).where(and(eq(kioskEvents.id, c.req.valid("json").eventId), eq(kioskEvents.deviceId, d.id)));
  if (!ev || ev.result !== "punched" || !ev.employeeId || !ev.punchedAt) throw notFound("Punch");
  if (Date.now() - ev.createdAt.getTime() > KIOSK_UNDO_SECONDS * 1000 + 5000) throw badRequest("It's too late to take this punch back here. Ask HR to fix it.");
  const del = await db.delete(attendancePunches).where(and(eq(attendancePunches.tenantId, d.tenantId), eq(attendancePunches.employeeId, ev.employeeId), eq(attendancePunches.punchedAt, ev.punchedAt), eq(attendancePunches.deviceId, d.id))).returning({ date: attendancePunches.date });
  if (del.length) await recomputeDays(db, d.tenantId, del.map((x) => ({ empId: ev.employeeId!, date: x.date })), "kiosk");
  await db.update(kioskEvents).set({ result: "undone" }).where(eq(kioskEvents.id, ev.id));
  await db.update(attendanceDevices).set({ punchCount: sql`greatest(${attendanceDevices.punchCount} - ${del.length}, 0)` }).where(eq(attendanceDevices.id, d.id));
  return c.json({ ok: true });
});

/** Daily: remove kiosk photos older than the keep period. */
export async function purgeKioskPhotos(env: Env) {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) return;
  const db = createDb(url, { max: 2 });
  try {
    const old = await db.select({ id: kioskEvents.id, key: kioskEvents.photoKey }).from(kioskEvents).where(and(lt(kioskEvents.createdAt, new Date(Date.now() - KIOSK_PHOTO_DAYS * 86_400_000)), sql`${kioskEvents.photoKey} is not null`)).limit(2000);
    for (const o of old) await deleteFile(env, o.key!).catch(() => {});
    if (old.length) await db.update(kioskEvents).set({ photoKey: null }).where(inArray(kioskEvents.id, old.map((o) => o.id)));
  } catch (e) {
    console.error("kiosk photo purge failed", e);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}
