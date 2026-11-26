import { Hono, type Context } from "hono";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { employees, oneOnOnes, tenants } from "@hrms/db";
import { carryOver, nextMeeting, ONE_ON_ONE_REPEAT_LABEL, scheduleOneOnOneSchema, updateOneOnOneSchema, type OneOnOneRepeat } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requireEmployee } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { layout } from "../lib/email";
import { sendNotification } from "../services/notifications";

type Row = typeof oneOnOnes.$inferSelect;
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const eid = (c: Context<AppEnv>) => c.get("tenant").employeeId!;
const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Which side of the meeting I'm on. */
const side = (c: Context<AppEnv>, m: Row) => (m.managerId === eid(c) ? "manager" : "employee");

function out(c: Context<AppEnv>, m: Row, names: Map<string, { name: string }>) {
  const mine = side(c, m);
  const other = mine === "manager" ? m.employeeId : m.managerId;
  const { managerNotes, employeeNotes, ...rest } = m;
  return { ...rest, role: mine, with: { id: other, name: names.get(other)?.name ?? "" }, myNotes: mine === "manager" ? managerNotes : employeeNotes };
}

async function people(c: Context<AppEnv>, ids: string[]) {
  const list = [...new Set(ids)];
  if (!list.length) return new Map<string, { name: string; first: string; email: string; managerId: string | null }>();
  return new Map((await c.get("db").select({ id: employees.id, name: employees.fullName, first: employees.firstName, email: employees.workEmail, managerId: employees.managerId }).from(employees).where(inArray(employees.id, list))).map((e) => [e.id, e]));
}

async function tell(c: Context<AppEnv>, m: Row, subject: string, line: string) {
  const other = side(c, m) === "manager" ? m.employeeId : m.managerId;
  const p = await people(c, [other, eid(c)]);
  const to = p.get(other);
  if (!to?.email) return;
  const [t] = await c.get("db").select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
  const { html, text } = layout({ company: t?.name ?? "Saralix", heading: subject, paragraphs: [`Hi ${to.first},`, line, "Add anything you'd like to talk about to the agenda beforehand."], cta: { label: "Open the 1:1", url: `${c.env.APP_URL}/me/one-on-ones?id=${m.id}` } });
  await sendNotification(c, "one_on_ones", { to: to.email, subject, html, text }).catch((e) => console.error("1:1 email failed", e));
}

export const oneOnOneRoutes = new Hono<AppEnv>();
oneOnOneRoutes.use("*", requireEmployee);

/** My 1:1s, as a manager and as someone's report: what's coming up and the last few. */
oneOnOneRoutes.get("/", async (c) => {
  const db = c.get("db");
  const mine = or(eq(oneOnOnes.managerId, eid(c)), eq(oneOnOnes.employeeId, eid(c)));
  const [upcoming, past] = await Promise.all([
    db.select().from(oneOnOnes).where(and(eq(oneOnOnes.tenantId, tid(c)), mine, eq(oneOnOnes.status, "scheduled"))).orderBy(asc(oneOnOnes.scheduledFor)).limit(50),
    db.select().from(oneOnOnes).where(and(eq(oneOnOnes.tenantId, tid(c)), mine, inArray(oneOnOnes.status, ["done", "cancelled"]))).orderBy(desc(oneOnOnes.scheduledFor)).limit(30),
  ]);
  const me = (await people(c, [eid(c)])).get(eid(c));
  const reports = await db.select({ id: employees.id, name: employees.fullName }).from(employees).where(and(eq(employees.tenantId, tid(c)), eq(employees.managerId, eid(c)), inArray(employees.status, ["onboarding", "probation", "active", "notice"]))).orderBy(employees.fullName);
  const manager = me?.managerId ? (await people(c, [me.managerId])).get(me.managerId) : undefined;
  const n = await people(c, [...upcoming, ...past].flatMap((m) => [m.managerId, m.employeeId]));
  return c.json({
    upcoming: upcoming.map((m) => out(c, m, n)),
    past: past.map((m) => out(c, m, n)),
    // who I can book a 1:1 with
    people: [...(manager && me?.managerId ? [{ id: me.managerId, name: manager.name, relation: "manager" as const }] : []), ...reports.map((r) => ({ ...r, relation: "report" as const }))],
  });
});

oneOnOneRoutes.post("/", v("json", scheduleOneOnOneSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const p = await people(c, [b.withEmployeeId, eid(c)]);
  const other = p.get(b.withEmployeeId);
  const me = p.get(eid(c));
  let managerId: string, employeeId: string;
  if (other?.managerId === eid(c)) [managerId, employeeId] = [eid(c), b.withEmployeeId];
  else if (me?.managerId === b.withEmployeeId) [managerId, employeeId] = [b.withEmployeeId, eid(c)];
  else throw badRequest("1:1s are between a manager and someone who reports to them");
  const at = new Date(b.scheduledFor);
  if (at.getTime() < Date.now() - 86_400_000) throw badRequest("Pick a time that hasn't passed");
  const by = managerId === eid(c) ? "manager" : "employee";
  const [row] = await db.insert(oneOnOnes).values({ tenantId: tid(c), managerId, employeeId, scheduledFor: at, repeat: b.repeat, agenda: b.agenda.map((text) => ({ id: crypto.randomUUID(), text, by, done: false })) }).returning();
  await tell(c, row!, `1:1 with ${me?.name}: ${when(at)}`, `${me?.name} booked a 1:1 with you for ${when(at)}${b.repeat !== "none" ? `, repeating ${ONE_ON_ONE_REPEAT_LABEL[b.repeat as OneOnOneRepeat].toLowerCase()}` : ""}.`);
  return c.json({ id: row!.id }, 201);
});

async function load(c: Context<AppEnv>, id: string) {
  const [m] = await c.get("db").select().from(oneOnOnes).where(and(eq(oneOnOnes.id, id), eq(oneOnOnes.tenantId, tid(c))));
  if (!m || (m.managerId !== eid(c) && m.employeeId !== eid(c))) throw notFound("1:1");
  return m;
}

oneOnOneRoutes.get("/:id", async (c) => {
  const m = await load(c, c.req.param("id"));
  return c.json(out(c, m, await people(c, [m.managerId, m.employeeId])));
});

oneOnOneRoutes.patch("/:id", v("json", updateOneOnOneSchema), async (c) => {
  const m = await load(c, c.req.param("id"));
  const b = c.req.valid("json");
  if (m.status === "cancelled") throw badRequest("This 1:1 was cancelled");
  const mine = side(c, m);
  const set: Partial<typeof oneOnOnes.$inferInsert> = { updatedAt: new Date() };
  if (b.sharedNotes !== undefined) set.sharedNotes = b.sharedNotes;
  if (b.myNotes !== undefined) set[mine === "manager" ? "managerNotes" : "employeeNotes"] = b.myNotes;
  if (b.agenda) set.agenda = b.agenda;
  if (b.actions) set.actions = b.actions;
  if (b.repeat) set.repeat = b.repeat;
  if (b.scheduledFor && m.status === "scheduled") set.scheduledFor = new Date(b.scheduledFor);
  const [row] = await c.get("db").update(oneOnOnes).set(set).where(eq(oneOnOnes.id, m.id)).returning();
  if (set.scheduledFor && set.scheduledFor.getTime() !== m.scheduledFor.getTime()) {
    const me = (await people(c, [eid(c)])).get(eid(c));
    await tell(c, row!, `1:1 moved to ${when(set.scheduledFor)}`, `${me?.name} moved your 1:1 to ${when(set.scheduledFor)}.`);
  }
  return c.json(out(c, row!, await people(c, [m.managerId, m.employeeId])));
});

/** Mark it done. If it repeats, book the next one with whatever wasn't covered. */
oneOnOneRoutes.post("/:id/complete", async (c) => {
  const m = await load(c, c.req.param("id"));
  if (m.status !== "scheduled") throw badRequest("It's already done or cancelled");
  const db = c.get("db");
  await db.update(oneOnOnes).set({ status: "done", completedAt: new Date(), updatedAt: new Date() }).where(eq(oneOnOnes.id, m.id));
  const next = nextMeeting(m.scheduledFor, m.repeat as OneOnOneRepeat);
  let nextId: string | null = null;
  if (next) {
    // skip ahead if the series fell behind, so the next one isn't in the past
    let at = next;
    for (let i = 0; at.getTime() < Date.now() && i < 60; i++) at = nextMeeting(at, m.repeat as OneOnOneRepeat)!;
    const carry = carryOver(m.agenda, m.actions);
    const [row] = await db.insert(oneOnOnes).values({ tenantId: m.tenantId, managerId: m.managerId, employeeId: m.employeeId, scheduledFor: at, repeat: m.repeat, agenda: carry.agenda, actions: carry.actions }).returning();
    nextId = row!.id;
  }
  return c.json({ ok: true, nextId });
});

oneOnOneRoutes.post("/:id/cancel", async (c) => {
  const m = await load(c, c.req.param("id"));
  if (m.status !== "scheduled") throw badRequest("It's already done or cancelled");
  await c.get("db").update(oneOnOnes).set({ status: "cancelled", updatedAt: new Date() }).where(eq(oneOnOnes.id, m.id));
  const me = (await people(c, [eid(c)])).get(eid(c));
  await tell(c, m, `1:1 on ${when(m.scheduledFor)} cancelled`, `${me?.name} cancelled the 1:1 on ${when(m.scheduledFor)}.`);
  return c.json({ ok: true });
});
