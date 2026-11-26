import { Hono, type Context } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { employeeLoans, employees, reimbursementClaims, tenants, travelRequests } from "@hrms/db";
import { can, fmtDate, fmtMoney, TRAVEL_MODE_LABEL, travelRequestSchema, travelSettlement, todayLocal, type TravelMode } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { sendNotification } from "../services/notifications";
import { nextLoanCode } from "../services/loans";

type Trip = typeof travelRequests.$inferSelect;
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const me = (c: Context<AppEnv>) => c.get("tenant").employeeId ?? null;
const OPEN = ["pending_manager", "pending_finance"];

async function nextCode(db: AppEnv["Variables"]["db"], tenantId: string) {
  const [r] = await db.select({ n: sql<number>`coalesce(max(substring(${travelRequests.code} from 4)::int), 1000)::int` }).from(travelRequests).where(eq(travelRequests.tenantId, tenantId));
  return `TR-${(r?.n ?? 1000) + 1}`;
}

/** What the trip has cost so far: approved or paid claims linked to it. */
async function claimedFor(db: AppEnv["Variables"]["db"], ids: string[]) {
  if (!ids.length) return new Map<string, { claimed: number; open: number; count: number }>();
  const rows = await db
    .select({ id: reimbursementClaims.travelRequestId, claimed: sql<number>`coalesce(sum(${reimbursementClaims.amount}) filter (where ${reimbursementClaims.status} in ('approved','paid')), 0)::float`, open: sql<number>`count(*) filter (where ${reimbursementClaims.status} like 'pending%')::int`, count: sql<number>`count(*)::int` })
    .from(reimbursementClaims)
    .where(inArray(reimbursementClaims.travelRequestId, ids))
    .groupBy(reimbursementClaims.travelRequestId);
  return new Map(rows.map((r) => [r.id!, { claimed: Number(r.claimed), open: r.open, count: r.count }]));
}

async function shape(c: Context<AppEnv>, trips: Trip[]) {
  const db = c.get("db");
  const ids = [...new Set(trips.map((t) => t.employeeId))];
  const people = ids.length ? new Map((await db.select({ id: employees.id, name: employees.fullName, code: employees.employeeCode, managerId: employees.managerId }).from(employees).where(inArray(employees.id, ids))).map((e) => [e.id, e])) : new Map();
  const claimed = await claimedFor(db, trips.map((t) => t.id));
  return trips.map((t) => {
    const cl = claimed.get(t.id) ?? { claimed: 0, open: 0, count: 0 };
    return { ...t, estimatedCost: Number(t.estimatedCost), advanceAmount: Number(t.advanceAmount), employee: people.get(t.employeeId) ?? null, claims: cl, settlement: travelSettlement(t.advancePaidOn ? Number(t.advanceAmount) : 0, cl.claimed) };
  });
}

async function tell(c: Context<AppEnv>, employeeId: string, subject: string, line: string, path = "/me/claims?tab=trips") {
  const db = c.get("db");
  const [e] = await db.select({ email: employees.workEmail, first: employees.firstName, company: tenants.name }).from(employees).innerJoin(tenants, eq(tenants.id, employees.tenantId)).where(eq(employees.id, employeeId));
  if (!e?.email) return;
  const { html, text } = layout({ company: e.company, heading: subject, paragraphs: [`Hi ${e.first},`, line], cta: { label: "Open it", url: `${c.env.APP_URL}${path}` } });
  await sendNotification(c, "claim_decision", { to: e.email, subject, html, text }).catch((x) => console.error("travel email failed", x));
}

const tripLine = (t: Trip) => `${t.code}: ${t.fromCity} to ${t.toCity}, ${fmtDate(t.startDate)} to ${fmtDate(t.endDate)}`;

/* ---------------- self-service ---------------- */

export const essTravelRoutes = new Hono<AppEnv>();
essTravelRoutes.use("*", requireEmployee);

essTravelRoutes.get("/", async (c) => {
  const rows = await c.get("db").select().from(travelRequests).where(and(eq(travelRequests.tenantId, tid(c)), eq(travelRequests.employeeId, me(c)!))).orderBy(desc(travelRequests.startDate)).limit(100);
  return c.json(await shape(c, rows));
});

essTravelRoutes.post("/", v("json", travelRequestSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const [emp] = await db.select({ managerId: employees.managerId, name: employees.fullName }).from(employees).where(eq(employees.id, me(c)!));
  const status = emp?.managerId ? "pending_manager" : "pending_finance";
  const [t] = await db.insert(travelRequests).values({ tenantId: tid(c), code: await nextCode(db, tid(c)), employeeId: me(c)!, ...b, status }).returning();
  await audit(c, { action: "travel.request", entity: "travel_request", entityId: t!.id, summary: `${tripLine(t!)}${b.advanceAmount ? `, advance ${fmtMoney(b.advanceAmount)}` : ""}` });
  if (emp?.managerId) await tell(c, emp.managerId, `${emp.name} asked to travel`, `${emp.name} asked to travel for "${b.purpose}": ${b.fromCity} to ${b.toCity}, ${fmtDate(b.startDate)} to ${fmtDate(b.endDate)} by ${TRAVEL_MODE_LABEL[b.mode as TravelMode].toLowerCase()}${b.advanceAmount ? `, with an advance of ${fmtMoney(b.advanceAmount)}` : ""}.`, "/reimbursements/travel");
  return c.json({ id: t!.id, code: t!.code, status }, 201);
});

essTravelRoutes.post("/:id/cancel", async (c) => {
  const db = c.get("db");
  const [t] = await db.select().from(travelRequests).where(and(eq(travelRequests.id, c.req.param("id")), eq(travelRequests.tenantId, tid(c)), eq(travelRequests.employeeId, me(c)!)));
  if (!t) throw notFound("Trip");
  if (!OPEN.includes(t.status) && !(t.status === "approved" && !t.advancePaidOn)) throw badRequest("It can't be cancelled now. Ask finance.");
  const [linked] = await db.select({ n: sql<number>`count(*)::int` }).from(reimbursementClaims).where(eq(reimbursementClaims.travelRequestId, t.id));
  if (linked!.n) throw badRequest("It has claims against it. Ask finance.");
  await db.update(travelRequests).set({ status: "cancelled", updatedAt: new Date() }).where(eq(travelRequests.id, t.id));
  return c.json({ ok: true });
});

/* ---------------- managers and finance ---------------- */

export const travelRoutes = new Hono<AppEnv>();
travelRoutes.use("*", requirePerm("reimbursements", "view"));
const finance = (c: Context<AppEnv>) => can(c.get("tenant").permissions, "reimbursements", "approve");

async function load(c: Context<AppEnv>, id: string) {
  const [t] = await c.get("db").select().from(travelRequests).where(and(eq(travelRequests.id, id), eq(travelRequests.tenantId, tid(c))));
  if (!t) throw notFound("Trip");
  return t;
}

/** Who may take the next step: the manager first, then finance. Nobody approves their own trip. */
async function mayDecide(c: Context<AppEnv>, t: Trip) {
  if (t.employeeId === me(c)) return "You can't approve your own trip";
  if (t.status === "pending_manager") {
    const [e] = await c.get("db").select({ managerId: employees.managerId }).from(employees).where(eq(employees.id, t.employeeId));
    if (e?.managerId === me(c) || can(c.get("tenant").permissions, "reimbursements", "configure")) return null;
    return "Waiting for their manager";
  }
  if (t.status === "pending_finance") return finance(c) ? null : "Waiting for finance";
  return "It's not waiting for a decision";
}

travelRoutes.get("/", v("query", z.object({ status: z.string().optional() })), async (c) => {
  const db = c.get("db");
  const q = c.req.valid("query");
  const rows = await db.select().from(travelRequests).where(and(eq(travelRequests.tenantId, tid(c)), q.status ? inArray(travelRequests.status, q.status.split(",")) : undefined)).orderBy(desc(travelRequests.createdAt)).limit(300);
  // managers without finance rights see their own team's trips
  const visible = finance(c) || can(c.get("tenant").permissions, "reimbursements", "configure") ? rows : (await Promise.all(rows.map(async (t) => ((await mayDecide(c, t)) === null || t.employeeId === me(c) ? t : null)))).filter((t): t is Trip => !!t);
  const out = await shape(c, visible);
  return c.json(await Promise.all(out.map(async (t) => ({ ...t, canDecide: (await mayDecide(c, t)) === null, canFinance: finance(c) && t.employeeId !== me(c) }))));
});

travelRoutes.post("/:id/decision", v("json", z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(500).default("") })), async (c) => {
  const t = await load(c, c.req.param("id"));
  const why = await mayDecide(c, t);
  if (why) throw forbidden(why);
  const { decision, reason } = c.req.valid("json");
  const uid = c.get("session")!.userId;
  if (decision === "reject") {
    if (reason.length < 3) throw badRequest("Say why");
    await c.get("db").update(travelRequests).set({ status: "rejected", rejectedBy: uid, rejectionReason: reason, updatedAt: new Date() }).where(eq(travelRequests.id, t.id));
    await tell(c, t.employeeId, `Trip ${t.code} wasn't approved`, `Your trip ${tripLine(t)} wasn't approved: ${reason}`);
  } else {
    // an advance needs finance as well
    const next = t.status === "pending_manager" && Number(t.advanceAmount) > 0 ? "pending_finance" : "approved";
    await c.get("db").update(travelRequests).set(t.status === "pending_manager" ? { status: next, managerApprovedBy: uid, managerApprovedAt: new Date(), updatedAt: new Date() } : { status: "approved", financeApprovedBy: uid, financeApprovedAt: new Date(), updatedAt: new Date() }).where(eq(travelRequests.id, t.id));
    if (next === "approved" || t.status === "pending_finance") await tell(c, t.employeeId, `Trip ${t.code} approved`, `Your trip ${tripLine(t)} is approved.${Number(t.advanceAmount) ? ` Finance will pay the ${fmtMoney(Number(t.advanceAmount))} advance.` : ""} Link your expense claims to it.`);
  }
  await audit(c, { action: `travel.${decision}`, entity: "travel_request", entityId: t.id, summary: `${decision === "approve" ? "Approved" : "Rejected"} ${t.code}${reason ? `: ${reason}` : ""}` });
  return c.json({ ok: true });
});

/** Finance records the advance as paid. */
travelRoutes.post("/:id/advance-paid", v("json", z.object({ paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().trim().max(80).default("") })), async (c) => {
  if (!finance(c)) throw forbidden();
  const t = await load(c, c.req.param("id"));
  if (t.status !== "approved") throw badRequest("Approve the trip first");
  if (!Number(t.advanceAmount)) throw badRequest("This trip has no advance");
  if (t.advancePaidOn) throw badRequest("The advance is already marked paid");
  const b = c.req.valid("json");
  if (b.paidOn > todayLocal()) throw badRequest("The payment date can't be in the future");
  await c.get("db").update(travelRequests).set({ advancePaidOn: b.paidOn, advanceReference: b.reference || null, updatedAt: new Date() }).where(eq(travelRequests.id, t.id));
  await audit(c, { action: "travel.advance_paid", entity: "travel_request", entityId: t.id, summary: `Paid the ${fmtMoney(Number(t.advanceAmount))} advance for ${t.code}${b.reference ? ` (${b.reference})` : ""}` });
  await tell(c, t.employeeId, `Advance paid for ${t.code}`, `Your ${fmtMoney(Number(t.advanceAmount))} travel advance was paid on ${fmtDate(b.paidOn)}.`);
  return c.json({ ok: true });
});

/**
 * Settle the trip once its claims are decided. Claims are paid with salary as usual; a paid
 * advance becomes a one month recovery in the next payroll, so the person nets what they spent.
 */
travelRoutes.post("/:id/settle", async (c) => {
  if (!finance(c)) throw forbidden();
  const t = await load(c, c.req.param("id"));
  if (t.status !== "approved") throw badRequest("Only an approved trip can be settled");
  if (t.endDate > todayLocal()) throw badRequest("The trip isn't over yet");
  const [cl] = await shape(c, [t]);
  if (cl!.claims.open) throw badRequest(`${cl!.claims.open} claim${cl!.claims.open === 1 ? " is" : "s are"} still waiting for a decision`);
  const db = c.get("db");
  const s = c.get("session")!;
  let recoveryLoanId: string | null = null;
  if (t.advancePaidOn && Number(t.advanceAmount) > 0) {
    const month = todayLocal().slice(0, 7);
    const [loan] = await db.insert(employeeLoans).values({ tenantId: tid(c), employeeId: t.employeeId, code: await nextLoanCode(db, tid(c), "advance"), type: "advance", status: "active", amount: Number(t.advanceAmount), months: 1, startMonth: month, reason: `Travel advance for ${t.code}`, requestedBy: s.userId, decidedBy: s.userId, decidedAt: new Date(), paidOn: t.advancePaidOn, paidMethod: "travel_advance", paidReference: t.code }).returning();
    recoveryLoanId = loan!.id;
  }
  await db.update(travelRequests).set({ status: "settled", settledAt: new Date(), settledBy: s.userId, recoveryLoanId, updatedAt: new Date() }).where(eq(travelRequests.id, t.id));
  const st = cl!.settlement;
  await audit(c, { action: "travel.settle", entity: "travel_request", entityId: t.id, summary: `Settled ${t.code}: claimed ${fmtMoney(st.claimed)}, advance ${fmtMoney(st.advance)}` });
  await tell(c, t.employeeId, `Trip ${t.code} settled`, st.advance ? `You claimed ${fmtMoney(st.claimed)} and had a ${fmtMoney(st.advance)} advance. Your claims are paid with your salary and the advance is taken back in the same payroll, so you ${st.net >= 0 ? `get ${fmtMoney(st.net)}` : `pay back ${fmtMoney(-st.net)}`} overall.` : `You claimed ${fmtMoney(st.claimed)}. It's paid with your salary.`);
  return c.json({ ok: true, settlement: st, recoveryLoanId });
});
