import { Hono, type Context } from "hono";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { apiKeys, attendanceRecords, branches, departments, designations, employees, leaveRequests, leaveTypes, payrollItems, payrollRuns, tenants, webhookDeliveries, webhooks } from "@hrms/db";
import { apiEmployeeSchema, apiHookSchema, apiKeySchema, encryptField, WEBHOOK_EVENTS, randomToken, sha256Hex, webhookSchema, webhookUrlError, type ApiScope } from "@hrms/shared";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { ApiError, badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { allowLocalHooks, attemptDelivery, emitEvent } from "../services/webhooks";
import { linkExistingLogin, nextEmployeeCode, sendOnboardingInvite } from "../services/employees";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;

// ---------- settings: keys and webhooks ----------
export const integrationRoutes = new Hono<AppEnv>();
const admin = requirePerm("settings", "configure");

const keyView = (k: typeof apiKeys.$inferSelect) => ({ id: k.id, name: k.name, keyHint: k.keyHint, scopes: k.scopes, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt, createdAt: k.createdAt });

integrationRoutes.get("/keys", admin, async (c) => {
  const rows = await c.get("db").select().from(apiKeys).where(eq(apiKeys.tenantId, tid(c))).orderBy(desc(apiKeys.createdAt));
  return c.json({ endpoint: `${c.env.APP_URL}/api/v1`, rows: rows.map(keyView) });
});

integrationRoutes.post("/keys", admin, v("json", apiKeySchema), async (c) => {
  const b = c.req.valid("json");
  const id = crypto.randomUUID();
  const secret = randomToken(32);
  const [k] = await c.get("db").insert(apiKeys).values({ id, tenantId: tid(c), name: b.name, scopes: b.scopes, keyHash: await sha256Hex(secret), keyHint: secret.slice(-4), createdBy: c.get("session")!.userId }).returning();
  await audit(c, { action: "integrations.key_create", entity: "api_key", entityId: id, summary: `Created API key ${b.name} (${b.scopes.join(", ")})` });
  // shown once
  return c.json({ ...keyView(k!), key: `sx_${id}.${secret}` }, 201);
});

integrationRoutes.delete("/keys/:id", admin, async (c) => {
  const [k] = await c.get("db").update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, c.req.param("id")), eq(apiKeys.tenantId, tid(c)), isNull(apiKeys.revokedAt))).returning();
  if (!k) throw notFound("API key");
  await audit(c, { action: "integrations.key_revoke", entity: "api_key", entityId: k.id, summary: `Revoked API key ${k.name}. It stopped working straight away.` });
  return c.json({ ok: true });
});

const hookView = (h: typeof webhooks.$inferSelect) => ({ id: h.id, url: h.url, events: h.events, active: h.active, secretHint: h.secretHint, createdAt: h.createdAt });
const checkUrl = (c: Context<AppEnv>, url: string) => {
  const err = webhookUrlError(url, { allowLocal: allowLocalHooks(c.env) });
  if (err) throw badRequest(err);
};

integrationRoutes.get("/webhooks", admin, async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(webhooks).where(eq(webhooks.tenantId, tid(c))).orderBy(desc(webhooks.createdAt));
  const stats = rows.length
    ? await db
        .select({ id: webhookDeliveries.webhookId, failed: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'failed')::int`, pending: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'pending')::int`, last: sql<string | null>`max(${webhookDeliveries.deliveredAt})` })
        .from(webhookDeliveries)
        .where(inArray(webhookDeliveries.webhookId, rows.map((r) => r.id)))
        .groupBy(webhookDeliveries.webhookId)
    : [];
  return c.json({ rows: rows.map((h) => ({ ...hookView(h), ...(stats.find((s) => s.id === h.id) ?? { failed: 0, pending: 0, last: null }) })) });
});

integrationRoutes.post("/webhooks", admin, v("json", webhookSchema), async (c) => {
  const b = c.req.valid("json");
  checkUrl(c, b.url);
  const secret = `whsec_${randomToken(24)}`;
  const [h] = await c
    .get("db")
    .insert(webhooks)
    .values({ tenantId: tid(c), url: b.url, events: b.events, active: b.active, secretEnc: await encryptField(secret, c.env.ENCRYPTION_KEY!), secretHint: secret.slice(-4), createdBy: c.get("session")!.userId })
    .returning();
  await audit(c, { action: "integrations.webhook_create", entity: "webhook", entityId: h!.id, summary: `Added a webhook to ${new URL(b.url).host} for ${b.events.join(", ")}` });
  return c.json({ ...hookView(h!), secret }, 201);
});

integrationRoutes.patch("/webhooks/:id", admin, v("json", webhookSchema.partial()), async (c) => {
  const b = c.req.valid("json");
  if (b.url) checkUrl(c, b.url);
  const [h] = await c.get("db").update(webhooks).set({ ...b, updatedAt: new Date() }).where(and(eq(webhooks.id, c.req.param("id")), eq(webhooks.tenantId, tid(c)))).returning();
  if (!h) throw notFound("Webhook");
  await audit(c, { action: "integrations.webhook_update", entity: "webhook", entityId: h.id, summary: `Updated the webhook to ${new URL(h.url).host}` });
  return c.json(hookView(h));
});

integrationRoutes.delete("/webhooks/:id", admin, async (c) => {
  const [h] = await c.get("db").delete(webhooks).where(and(eq(webhooks.id, c.req.param("id") ?? ""), eq(webhooks.tenantId, tid(c)))).returning();
  if (!h) throw notFound("Webhook");
  await audit(c, { action: "integrations.webhook_delete", entity: "webhook", entityId: h.id, summary: `Removed the webhook to ${new URL(h.url).host}` });
  return c.json({ ok: true });
});

/** Sends a ping, so you can check the receiver and its signature check. */
integrationRoutes.post("/webhooks/:id/test", admin, async (c) => {
  const db = c.get("db");
  const [h] = await db.select().from(webhooks).where(and(eq(webhooks.id, c.req.param("id")), eq(webhooks.tenantId, tid(c))));
  if (!h) throw notFound("Webhook");
  const [d] = await db.insert(webhookDeliveries).values({ tenantId: tid(c), webhookId: h.id, event: "ping", payload: { message: "Test from Saralix" } }).returning();
  const ok = await attemptDelivery(db, c.env, d!.id);
  const [after] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, d!.id));
  return c.json({ ok, responseCode: after?.responseCode ?? null, error: after?.lastError ?? null });
});

integrationRoutes.get("/webhooks/:id/deliveries", admin, async (c) => {
  const rows = await c
    .get("db")
    .select({ id: webhookDeliveries.id, event: webhookDeliveries.event, status: webhookDeliveries.status, attempts: webhookDeliveries.attempts, responseCode: webhookDeliveries.responseCode, lastError: webhookDeliveries.lastError, createdAt: webhookDeliveries.createdAt, deliveredAt: webhookDeliveries.deliveredAt, nextAttemptAt: webhookDeliveries.nextAttemptAt })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.webhookId, c.req.param("id")), eq(webhookDeliveries.tenantId, tid(c))))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(50);
  return c.json({ rows });
});

integrationRoutes.post("/deliveries/:id/retry", admin, async (c) => {
  const db = c.get("db");
  const [d] = await db.update(webhookDeliveries).set({ status: "pending", nextAttemptAt: new Date() }).where(and(eq(webhookDeliveries.id, c.req.param("id")), eq(webhookDeliveries.tenantId, tid(c)))).returning();
  if (!d) throw notFound("Delivery");
  return c.json({ ok: await attemptDelivery(db, c.env, d.id) });
});

// ---------- the public API: /api/v1, read only, with an API key ----------
type V1Env = AppEnv & { Variables: AppEnv["Variables"] & { apiTenant: string; apiScopes: string[]; apiKeyId: string; apiKeyName: string } };
export const v1Routes = new Hono<V1Env>();

v1Routes.use("*", async (c, next) => {
  const m = (c.req.header("authorization") ?? "").match(/^Bearer sx_([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/);
  if (!m) throw new ApiError(401, "Send your API key as: Authorization: Bearer sx_…", "unauthorized");
  const db = c.get("db");
  const [k] = await db.select().from(apiKeys).where(eq(apiKeys.id, m[1]!));
  if (!k || k.revokedAt || k.keyHash !== (await sha256Hex(m[2]!))) throw new ApiError(401, "Unknown or revoked API key", "unauthorized");
  c.set("apiTenant", k.tenantId);
  c.set("apiScopes", k.scopes);
  c.set("apiKeyId", k.id);
  c.set("apiKeyName", k.name);
  // note use at most once a minute, to keep writes down
  if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 60_000) await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, k.id));
  await next();
});
const scope = (s: ApiScope) => async (c: Context<V1Env>, next: () => Promise<void>) => {
  if (!c.get("apiScopes").includes(s)) throw new ApiError(403, `This key can't do that. It needs the ${s} scope.`, "forbidden");
  await next();
};
const page = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(100) });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const mgr = alias(employees, "mgr");
const employeeColumns = {
  id: employees.id,
  employeeCode: employees.employeeCode,
  fullName: employees.fullName,
  workEmail: employees.workEmail,
  phone: employees.phone,
  status: employees.status,
  employmentType: employees.employmentType,
  dateOfJoining: employees.dateOfJoining,
  lastWorkingDay: employees.lastWorkingDay,
  department: departments.name,
  designation: designations.name,
  branch: branches.name,
  managerId: employees.managerId,
  managerCode: mgr.employeeCode,
  entityId: employees.entityId,
  customFields: employees.customFields,
  updatedAt: employees.updatedAt,
};
const employeeQuery = (c: Context<V1Env>, where: SQL[]) =>
  c
    .get("db")
    .select(employeeColumns)
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(mgr, eq(mgr.id, employees.managerId))
    .where(and(eq(employees.tenantId, c.get("apiTenant")), ...where));

v1Routes.get("/employees", scope("employees:read"), v("query", page.extend({ status: z.string().optional(), updatedSince: z.string().datetime({ offset: true }).optional() })), async (c) => {
  const q = c.req.valid("query");
  const where: SQL[] = [];
  if (q.status) where.push(eq(employees.status, q.status));
  if (q.updatedSince) where.push(gte(employees.updatedAt, new Date(q.updatedSince)));
  const rows = await employeeQuery(c, where).orderBy(asc(employees.employeeCode)).limit(q.pageSize + 1).offset((q.page - 1) * q.pageSize);
  return c.json({ data: rows.slice(0, q.pageSize), page: q.page, hasMore: rows.length > q.pageSize });
});

v1Routes.get("/employees/:id", scope("employees:read"), async (c) => {
  const id = c.req.param("id");
  const [row] = await employeeQuery(c, [sql`(${employees.id} = ${id} or ${employees.employeeCode} = ${id})`]);
  if (!row) throw notFound("Employee");
  return c.json({ data: row });
});

v1Routes.get("/payroll/runs", scope("payroll:read"), v("query", page), async (c) => {
  const q = c.req.valid("query");
  const rows = await c
    .get("db")
    .select({ id: payrollRuns.id, entityId: payrollRuns.entityId, kind: payrollRuns.kind, label: payrollRuns.label, month: payrollRuns.month, periodStart: payrollRuns.periodStart, periodEnd: payrollRuns.periodEnd, frequency: payrollRuns.frequency, status: payrollRuns.status, payDate: payrollRuns.payDate, totals: payrollRuns.totals })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, c.get("apiTenant")), inArray(payrollRuns.status, ["approved", "paid"])))
    .orderBy(desc(payrollRuns.periodStart))
    .limit(q.pageSize + 1)
    .offset((q.page - 1) * q.pageSize);
  return c.json({ data: rows.slice(0, q.pageSize), page: q.page, hasMore: rows.length > q.pageSize });
});

v1Routes.get("/payroll/runs/:id/payslips", scope("payroll:read"), async (c) => {
  const db = c.get("db");
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, c.req.param("id")!), eq(payrollRuns.tenantId, c.get("apiTenant"))));
  if (!run || !["approved", "paid"].includes(run.status)) throw notFound("Approved payroll run");
  const items = await db.select().from(payrollItems).where(eq(payrollItems.runId, run.id)).orderBy(asc(sql`${payrollItems.snapshot}->>'code'`));
  return c.json({
    data: items.map((i) => ({ employeeId: i.employeeId, employeeCode: i.snapshot.code, name: i.snapshot.name, paidDays: Number(i.paidDays), earnings: i.earnings, deductions: i.deductions, employer: i.employer, gross: Number(i.gross), totalDeductions: Number(i.totalDeductions), net: Number(i.net), reimbursement: Number(i.reimbursement), onHold: i.onHold })),
  });
});

const range = z.object({ from: isoDate, to: isoDate }).refine((r) => r.from <= r.to && Date.parse(r.to) - Date.parse(r.from) <= 62 * 86400000, "Ask for up to 62 days at a time, with from on or before to");

v1Routes.get("/attendance", scope("attendance:read"), v("query", range), async (c) => {
  const q = c.req.valid("query");
  const rows = await c
    .get("db")
    .select({ employeeId: attendanceRecords.employeeId, employeeCode: employees.employeeCode, date: attendanceRecords.date, status: attendanceRecords.status, checkIn: attendanceRecords.checkIn, checkOut: attendanceRecords.checkOut, workMinutes: attendanceRecords.workMinutes, lateMinutes: attendanceRecords.lateMinutes, overtimeMinutes: attendanceRecords.overtimeMinutes })
    .from(attendanceRecords)
    .innerJoin(employees, eq(employees.id, attendanceRecords.employeeId))
    .where(and(eq(attendanceRecords.tenantId, c.get("apiTenant")), gte(attendanceRecords.date, q.from), lte(attendanceRecords.date, q.to)))
    .orderBy(asc(attendanceRecords.date), asc(employees.employeeCode));
  return c.json({ data: rows });
});

v1Routes.get("/leave", scope("leave:read"), v("query", range), async (c) => {
  const q = c.req.valid("query");
  const rows = await c
    .get("db")
    .select({ id: leaveRequests.id, code: leaveRequests.code, employeeId: leaveRequests.employeeId, employeeCode: employees.employeeCode, leaveType: leaveTypes.name, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, halfDay: leaveRequests.halfDay, days: leaveRequests.days, status: leaveRequests.status })
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .leftJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(eq(leaveRequests.tenantId, c.get("apiTenant")), lte(leaveRequests.startDate, q.to), gte(leaveRequests.endDate, q.from)))
    .orderBy(asc(leaveRequests.startDate));
  return c.json({ data: rows });
});

/* ---------------- for Zapier and similar tools ---------------- */

/** Who the key belongs to: Zapier calls this to test the connection and label the account. */
v1Routes.get("/me", async (c) => {
  const [t] = await c.get("db").select({ id: tenants.id, name: tenants.name, code: tenants.code }).from(tenants).where(eq(tenants.id, c.get("apiTenant")));
  return c.json({ company: t, key: { name: c.get("apiKeyName"), scopes: c.get("apiScopes") } });
});

/** REST hook subscribe: one URL, one event. The delivery is the event's data, signed like any webhook. */
v1Routes.post("/hooks", scope("webhooks:manage"), v("json", apiHookSchema), async (c) => {
  const b = c.req.valid("json");
  const err = webhookUrlError(b.url, { allowLocal: allowLocalHooks(c.env) });
  if (err) throw badRequest(err);
  const secret = `whsec_${randomToken(24)}`;
  const [h] = await c.get("db").insert(webhooks).values({ tenantId: c.get("apiTenant"), url: b.url, events: [b.event], secretEnc: await encryptField(secret, c.env.ENCRYPTION_KEY!), secretHint: secret.slice(-4), createdBy: `api_key:${c.get("apiKeyId")}` }).returning();
  return c.json({ id: h!.id, event: b.event }, 201);
});

v1Routes.delete("/hooks/:id", scope("webhooks:manage"), async (c) => {
  // only hooks this key made, so one integration can't remove another's
  const [h] = await c.get("db").delete(webhooks).where(and(eq(webhooks.id, c.req.param("id") ?? ""), eq(webhooks.tenantId, c.get("apiTenant")), eq(webhooks.createdBy, `api_key:${c.get("apiKeyId")}`))).returning();
  if (!h) throw notFound("Subscription");
  return c.json({ ok: true });
});

/** Recent examples of an event, newest first: what Zapier shows while someone sets up a zap. */
v1Routes.get("/events/:event/samples", scope("webhooks:manage"), async (c) => {
  const event = c.req.param("event") ?? "";
  if (!(WEBHOOK_EVENTS as readonly string[]).includes(event)) throw notFound("Event");
  const db = c.get("db");
  const sent = await db.select({ id: webhookDeliveries.id, payload: webhookDeliveries.payload, at: webhookDeliveries.createdAt }).from(webhookDeliveries).where(and(eq(webhookDeliveries.tenantId, c.get("apiTenant")), eq(webhookDeliveries.event, event))).orderBy(desc(webhookDeliveries.createdAt)).limit(3);
  if (sent.length) return c.json(sent.map((s) => s.payload));
  // nothing sent yet: build examples from what's in Saralix
  const tid = c.get("apiTenant");
  if (event.startsWith("employee.")) {
    const rows = await db.select({ id: employees.id, employeeCode: employees.employeeCode, fullName: employees.fullName, workEmail: employees.workEmail, status: employees.status, dateOfJoining: employees.dateOfJoining, lastWorkingDay: employees.lastWorkingDay }).from(employees).where(eq(employees.tenantId, tid)).orderBy(desc(employees.createdAt)).limit(3);
    return c.json(rows.map((r) => (event === "employee.exited" ? { id: r.id, employeeCode: r.employeeCode, fullName: r.fullName, type: "resignation", lastWorkingDay: r.lastWorkingDay ?? r.dateOfJoining } : event === "employee.updated" ? { id: r.id, employeeCode: r.employeeCode, fullName: r.fullName, status: r.status, fields: ["designationId"] } : r)));
  }
  if (event === "leave.approved") {
    const rows = await db.select({ id: leaveRequests.id, code: leaveRequests.code, employeeId: leaveRequests.employeeId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, days: leaveRequests.days, halfDay: leaveRequests.halfDay }).from(leaveRequests).where(and(eq(leaveRequests.tenantId, tid), eq(leaveRequests.status, "approved"))).orderBy(desc(leaveRequests.createdAt)).limit(3);
    return c.json(rows.map((r) => ({ ...r, days: Number(r.days) })));
  }
  const runs = await db.select().from(payrollRuns).where(eq(payrollRuns.tenantId, tid)).orderBy(desc(payrollRuns.periodStart)).limit(3);
  return c.json(runs.map((r) => ({ id: r.id, month: r.month, periodStart: r.periodStart, periodEnd: r.periodEnd, payDate: r.payDate, totals: r.totals })));
});

/** Add an employee: enough to start onboarding. They get an invite to fill in the rest. */
v1Routes.post("/employees", scope("employees:write"), v("json", apiEmployeeSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const tid = c.get("apiTenant");
  const [dup] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, tid), sql`lower(${employees.workEmail}) = ${b.workEmail}`));
  if (dup) throw new ApiError(409, "Someone with that work email is already in Saralix", "conflict");
  const byName = async (table: typeof departments | typeof designations, name: string | null, what: string) => {
    if (!name) return null;
    const [r] = await db.select({ id: table.id }).from(table).where(and(eq(table.tenantId, tid), sql`lower(${table.name}) = ${name.toLowerCase()}`));
    if (!r) throw badRequest(`There's no ${what} called "${name}" in Saralix. Use one that exists, or leave it out.`);
    return r.id;
  };
  const departmentId = await byName(departments, b.department, "department");
  const designationId = await byName(designations, b.designation, "designation");
  const code = b.employeeCode || (await nextEmployeeCode(db, tid));
  const fullName = [b.firstName, b.lastName].filter(Boolean).join(" ");
  const status = b.sendInvite ? "onboarding" : "probation";
  const [emp] = await db.insert(employees).values({ tenantId: tid, employeeCode: code, firstName: b.firstName, lastName: b.lastName || null, fullName, workEmail: b.workEmail, phone: b.mobile, dateOfJoining: b.dateOfJoining, departmentId, designationId, status }).returning();
  // the invite and audit helpers work in a company's context
  (c as unknown as Context<AppEnv>).set("tenant", { tenantId: tid, membershipId: `api_key:${c.get("apiKeyId")}`, roleId: null, roleName: `API key ${c.get("apiKeyName")}`, permissions: {}, employeeId: null, plan: "", features: {}, kycStatus: "approved", readOnly: null });
  const linked = await linkExistingLogin(db, tid, emp!.id, emp!.workEmail);
  if (b.sendInvite && !linked) await sendOnboardingInvite(c as unknown as Context<AppEnv>, emp!.id);
  await emitEvent(c as unknown as Context<AppEnv>, "employee.created", { id: emp!.id, employeeCode: code, fullName, workEmail: emp!.workEmail, status, dateOfJoining: emp!.dateOfJoining }, tid);
  await audit(c as unknown as Context<AppEnv>, { tenantId: tid, action: "employee.create", entity: "employee", entityId: emp!.id, summary: `Added ${fullName} (${code}) through the API key ${c.get("apiKeyName")}` });
  return c.json({ id: emp!.id, employeeCode: code, fullName, workEmail: emp!.workEmail, status, invited: b.sendInvite && !linked }, 201);
});
