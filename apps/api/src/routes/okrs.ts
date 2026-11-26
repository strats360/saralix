import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { departments, employees, keyResults, objectives, okrCheckins } from "@hrms/db";
import { can, checkinSchema, objectiveProgress, objectiveSchema, periodOf, todayLocal, type KrKind, type ObjectiveInput } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";

type Db = AppEnv["Variables"]["db"];
type Objective = typeof objectives.$inferSelect;
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const isHr = (c: Context<AppEnv>) => can(c.get("tenant").permissions, "employees", "edit");
const periodQuery = z.object({ period: z.string().regex(/^FY\d{4}-\d{2}( Q[1-4])?$/).optional() });

/** Objectives with their key results, owners, teams and progress. */
async function shape(db: Db, rows: Objective[]) {
  if (!rows.length) return [];
  const krs = await db.select().from(keyResults).where(inArray(keyResults.objectiveId, rows.map((o) => o.id))).orderBy(asc(keyResults.sortOrder));
  const ownerIds = [...new Set(rows.map((o) => o.ownerId).filter((x): x is string => !!x))];
  const owners = ownerIds.length ? new Map((await db.select({ id: employees.id, name: employees.fullName, managerId: employees.managerId }).from(employees).where(inArray(employees.id, ownerIds))).map((e) => [e.id, e])) : new Map();
  const deptIds = [...new Set(rows.map((o) => o.departmentId).filter((x): x is string => !!x))];
  const depts = deptIds.length ? new Map((await db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, deptIds))).map((d) => [d.id, d.name])) : new Map<string, string>();
  return rows.map((o) => {
    const mine = krs.filter((k) => k.objectiveId === o.id).map((k) => ({ id: k.id, title: k.title, kind: k.kind as KrKind, start: k.start, target: k.target, current: k.current, unit: k.unit }));
    return { ...o, owner: o.ownerId ? { id: o.ownerId, name: owners.get(o.ownerId)?.name ?? "", managerId: owners.get(o.ownerId)?.managerId ?? null } : null, department: o.departmentId ? depts.get(o.departmentId) ?? null : null, keyResults: mine, progress: objectiveProgress(mine) };
  });
}

async function load(c: Context<AppEnv>, id: string) {
  const [o] = await c.get("db").select().from(objectives).where(and(eq(objectives.id, id), eq(objectives.tenantId, tid(c))));
  if (!o) throw notFound("Objective");
  return o;
}

async function checkParent(c: Context<AppEnv>, parentId: string | null, selfId?: string) {
  if (!parentId) return;
  if (parentId === selfId) throw badRequest("An objective can't line up under itself");
  const p = await load(c, parentId);
  if (p.status !== "active") throw badRequest("That objective has been archived");
  // walk up to make sure we don't make a loop
  let cur: Objective | undefined = p;
  for (let i = 0; cur?.parentId && i < 10; i++) {
    if (cur.parentId === selfId) throw badRequest("That would make a loop");
    [cur] = await c.get("db").select().from(objectives).where(eq(objectives.id, cur.parentId));
  }
}

async function save(c: Context<AppEnv>, b: ObjectiveInput, existing?: Objective) {
  const db = c.get("db");
  await checkParent(c, b.parentId, existing?.id);
  if (b.ownerId) {
    const [e] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, b.ownerId), eq(employees.tenantId, tid(c))));
    if (!e) throw badRequest("Pick a current employee as the owner");
  }
  const fields = { level: b.level, title: b.title, description: b.description, period: b.period, ownerId: b.ownerId, departmentId: b.level === "team" ? b.departmentId : null, parentId: b.parentId };
  return db.transaction(async (tx) => {
    const [o] = existing
      ? await tx.update(objectives).set({ ...fields, updatedAt: new Date() }).where(eq(objectives.id, existing.id)).returning()
      : await tx.insert(objectives).values({ ...fields, tenantId: tid(c), createdBy: c.get("session")!.userId }).returning();
    const old = existing ? await tx.select().from(keyResults).where(eq(keyResults.objectiveId, o!.id)) : [];
    const keep = new Set(b.keyResults.map((k) => k.id).filter(Boolean));
    const drop = old.filter((k) => !keep.has(k.id)).map((k) => k.id);
    if (drop.length) await tx.delete(keyResults).where(inArray(keyResults.id, drop));
    for (const [i, k] of b.keyResults.entries()) {
      const prev = old.find((x) => x.id === k.id);
      const vals = { title: k.title, kind: k.kind, start: k.kind === "done" ? 0 : k.start, target: k.kind === "done" ? 1 : k.target, unit: k.unit, sortOrder: i };
      if (prev) await tx.update(keyResults).set({ ...vals, updatedAt: new Date() }).where(eq(keyResults.id, prev.id));
      else await tx.insert(keyResults).values({ ...vals, current: vals.start, tenantId: tid(c), objectiveId: o!.id });
    }
    return o!;
  });
}

async function checkin(c: Context<AppEnv>, o: Objective, b: z.infer<typeof checkinSchema>) {
  const db = c.get("db");
  if (o.status !== "active") throw badRequest("This objective is archived");
  const krs = await db.select().from(keyResults).where(eq(keyResults.objectiveId, o.id));
  for (const id of Object.keys(b.values)) if (!krs.some((k) => k.id === id)) throw badRequest("That key result isn't part of this objective");
  for (const k of krs) if (b.values[k.id] !== undefined) await db.update(keyResults).set({ current: k.kind === "done" ? (b.values[k.id]! >= 1 ? 1 : 0) : b.values[k.id]!, updatedAt: new Date() }).where(eq(keyResults.id, k.id));
  const after = krs.map((k) => ({ kind: k.kind as KrKind, start: k.start, target: k.target, current: b.values[k.id] ?? k.current }));
  const progress = objectiveProgress(after);
  const s = c.get("session")!;
  await db.insert(okrCheckins).values({ tenantId: tid(c), objectiveId: o.id, values: b.values, progress, confidence: b.confidence, note: b.note, byUserId: s.userId, byName: s.name });
  await db.update(objectives).set({ confidence: b.confidence, lastCheckinAt: new Date(), updatedAt: new Date() }).where(eq(objectives.id, o.id));
  await audit(c, { action: "okr.checkin", entity: "objective", entityId: o.id, summary: `Checked in on "${o.title}": ${progress}%, ${b.confidence.replace("_", " ")}` });
  return progress;
}

async function detail(c: Context<AppEnv>, o: Objective) {
  const db = c.get("db");
  const [shaped] = await shape(db, [o]);
  const history = await db.select().from(okrCheckins).where(eq(okrCheckins.objectiveId, o.id)).orderBy(desc(okrCheckins.createdAt)).limit(50);
  const children = await shape(db, await db.select().from(objectives).where(and(eq(objectives.parentId, o.id), eq(objectives.status, "active"))));
  const parent = o.parentId ? (await db.select({ id: objectives.id, title: objectives.title, level: objectives.level }).from(objectives).where(eq(objectives.id, o.parentId)))[0] ?? null : null;
  return { ...shaped!, history: history.map(({ values: _v, ...h }) => h), children, parent };
}

/* ---------------- HR ---------------- */

export const okrRoutes = new Hono<AppEnv>();
okrRoutes.use("*", requirePerm("employees", "view"));
const hrOnly = createMiddleware<AppEnv>(async (c, next) => {
  if (!isHr(c)) throw forbidden();
  await next();
});

okrRoutes.get("/", v("query", periodQuery), async (c) => {
  const period = c.req.valid("query").period ?? periodOf(todayLocal());
  const rows = await c.get("db").select().from(objectives).where(and(eq(objectives.tenantId, tid(c)), eq(objectives.period, period), eq(objectives.status, "active"))).orderBy(asc(objectives.createdAt));
  return c.json({ period, objectives: await shape(c.get("db"), rows) });
});
okrRoutes.get("/:id", async (c) => c.json(await detail(c, await load(c, c.req.param("id")))));
okrRoutes.post("/", hrOnly, v("json", objectiveSchema), async (c) => {
  const o = await save(c, c.req.valid("json"));
  await audit(c, { action: "okr.create", entity: "objective", entityId: o.id, summary: `Added the objective "${o.title}" (${o.period})` });
  return c.json({ id: o.id }, 201);
});
okrRoutes.put("/:id", hrOnly, v("json", objectiveSchema), async (c) => {
  const o = await save(c, c.req.valid("json"), await load(c, c.req.param("id")));
  return c.json({ id: o.id });
});
okrRoutes.post("/:id/archive", hrOnly, async (c) => {
  const o = await load(c, c.req.param("id"));
  await c.get("db").update(objectives).set({ status: "archived", updatedAt: new Date() }).where(eq(objectives.id, o.id));
  await c.get("db").update(objectives).set({ parentId: null }).where(eq(objectives.parentId, o.id));
  await audit(c, { action: "okr.archive", entity: "objective", entityId: o.id, summary: `Archived the objective "${o.title}"` });
  return c.json({ ok: true });
});
okrRoutes.post("/:id/checkin", hrOnly, v("json", checkinSchema), async (c) => c.json({ progress: await checkin(c, await load(c, c.req.param("id")), c.req.valid("json")) }));

/* ---------------- self-service ---------------- */

export const essOkrRoutes = new Hono<AppEnv>();
essOkrRoutes.use("*", requireEmployee);
const eid = (c: Context<AppEnv>) => c.get("tenant").employeeId!;

/** Company and team objectives are open to everyone; personal ones to the person and their managers. */
async function canSee(c: Context<AppEnv>, o: Objective) {
  if (o.level !== "individual" || o.ownerId === eid(c)) return true;
  if (!o.ownerId) return false;
  const [owner] = await c.get("db").select({ managerId: employees.managerId }).from(employees).where(eq(employees.id, o.ownerId));
  return owner?.managerId === eid(c);
}
/** The owner, or the owner's manager, can update an objective. */
async function canEdit(c: Context<AppEnv>, o: Objective) {
  if (o.ownerId === eid(c)) return true;
  if (!o.ownerId) return false;
  const [owner] = await c.get("db").select({ managerId: employees.managerId }).from(employees).where(eq(employees.id, o.ownerId));
  return owner?.managerId === eid(c);
}
async function mine(c: Context<AppEnv>, id: string, edit = false) {
  const o = await load(c, id);
  if (!(await canSee(c, o))) throw notFound("Objective");
  if (edit && !(await canEdit(c, o))) throw forbidden("Only the owner or their manager can change this");
  return o;
}

essOkrRoutes.get("/", v("query", periodQuery), async (c) => {
  const db = c.get("db");
  const period = c.req.valid("query").period ?? periodOf(todayLocal());
  const team = await db.select({ id: employees.id, name: employees.fullName }).from(employees).where(and(eq(employees.tenantId, tid(c)), or(eq(employees.managerId, eid(c)), eq(employees.id, eid(c))), inArray(employees.status, ["onboarding", "probation", "active", "notice"])));
  const reports = team.filter((t) => t.id !== eid(c)).map((r) => r.id);
  const rows = await db
    .select()
    .from(objectives)
    .where(and(eq(objectives.tenantId, tid(c)), eq(objectives.period, period), eq(objectives.status, "active"), or(sql`${objectives.level} <> 'individual'`, inArray(objectives.ownerId, [eid(c), ...reports]))))
    .orderBy(asc(objectives.createdAt));
  const shaped = await shape(db, rows);
  return c.json({ period, me: eid(c), reports, people: team, objectives: shaped.map((o) => ({ ...o, canEdit: o.ownerId === eid(c) || (!!o.owner && o.owner.managerId === eid(c)) })) });
});
essOkrRoutes.get("/:id", async (c) => {
  const o = await mine(c, c.req.param("id"));
  return c.json({ ...(await detail(c, o)), canEdit: await canEdit(c, o) });
});
/** People add their own objectives, and managers add them for their team. Company and team ones are HR's. */
essOkrRoutes.post("/", v("json", objectiveSchema), async (c) => {
  const b = c.req.valid("json");
  if (b.level !== "individual") throw forbidden("HR sets company and team objectives");
  if (b.ownerId !== eid(c)) {
    const [o] = await c.get("db").select({ managerId: employees.managerId }).from(employees).where(eq(employees.id, b.ownerId!));
    if (o?.managerId !== eid(c)) throw forbidden("You can add objectives for yourself and your team");
  }
  const o = await save(c, b);
  await audit(c, { action: "okr.create", entity: "objective", entityId: o.id, summary: `Added the objective "${o.title}" (${o.period})` });
  return c.json({ id: o.id }, 201);
});
essOkrRoutes.put("/:id", v("json", objectiveSchema), async (c) => {
  const o = await mine(c, c.req.param("id"), true);
  const b = c.req.valid("json");
  if (b.level !== o.level || (o.level === "individual" && b.ownerId !== o.ownerId)) throw forbidden("Only HR can move an objective to someone else");
  await save(c, b, o);
  return c.json({ id: o.id });
});
essOkrRoutes.post("/:id/archive", async (c) => {
  const o = await mine(c, c.req.param("id"), true);
  if (o.level !== "individual") throw forbidden("HR archives company and team objectives");
  await c.get("db").update(objectives).set({ status: "archived", updatedAt: new Date() }).where(eq(objectives.id, o.id));
  return c.json({ ok: true });
});
essOkrRoutes.post("/:id/checkin", v("json", checkinSchema), async (c) => c.json({ progress: await checkin(c, await mine(c, c.req.param("id"), true), c.req.valid("json")) }));
