import { expiringCount } from "../services/identities";
import { Hono } from "hono";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { attendanceCorrections, branches, companyBankAccounts, departments, employees, leaveRequests, leaveTypes, memberships, onboardingInvites, reimbursementClaims, tenants, user } from "@hrms/db";
import { can, SETUP_ITEMS, todayLocal, type SetupItemKey } from "@hrms/shared";
import { requirePerm } from "../lib/context";
import { badRequest } from "../lib/errors";
import { audit } from "../lib/audit";
import type { AppEnv } from "../env";
import { buildCalendar } from "../services/attendance";
import { teamScope } from "../services/scope";
import { onProbation } from "../services/probation";
import { isFinance } from "../services/reimbursements";

export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.get("/", async (c) => {
  const db = c.get("db");
  const t = c.get("tenant");
  const tid = t.tenantId;
  const today = todayLocal();

  const counts = await db
    .select({ status: employees.status, n: sql<number>`count(*)::int` })
    .from(employees)
    .where(eq(employees.tenantId, tid))
    .groupBy(employees.status);
  const n = (...s: string[]) => counts.filter((x) => s.includes(x.status)).reduce((a, b) => a + b.n, 0);

  let attendance = null;
  if (can(t.permissions, "attendance", "view")) {
    const scope = await teamScope(c, "attendance");
    const emps = await db
      .select({ id: employees.id, shiftId: employees.shiftId, branchId: employees.branchId, dateOfJoining: employees.dateOfJoining, lastWorkingDay: employees.lastWorkingDay })
      .from(employees)
      .where(and(eq(employees.tenantId, tid), sql`${employees.status} not in ('exited','inactive','onboarding')`, ...(scope ? [inArray(employees.id, scope.length ? scope : ["-"])] : [])));
    const cal = await buildCalendar(db, tid, emps, today, today);
    const st = emps.map((e) => cal.status(e, today));
    const k = (...s: string[]) => st.filter((x) => x && s.includes(x)).length;
    attendance = { present: k("present", "late", "wfh", "half_day"), wfh: k("wfh"), late: k("late"), absent: k("absent"), notMarked: k("not_marked"), onLeave: k("on_leave"), off: k("weekly_off", "holiday") };
  }

  let pendingLeaves: unknown[] = [];
  let pendingLeaveCount = 0;
  if (can(t.permissions, "leave", "view")) {
    const scope = await teamScope(c, "leave");
    const conds = [eq(leaveRequests.tenantId, tid), eq(leaveRequests.status, "pending")];
    if (scope) conds.push(inArray(leaveRequests.employeeId, scope.length ? scope : ["-"]));
    const rows = await db
      .select({ id: leaveRequests.id, code: leaveRequests.code, employeeId: leaveRequests.employeeId, employeeName: employees.fullName, employeeCode: employees.employeeCode, type: leaveTypes.name, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, days: leaveRequests.days })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(...conds))
      .orderBy(asc(leaveRequests.startDate));
    pendingLeaveCount = rows.length;
    pendingLeaves = rows.filter((r) => r.employeeId !== t.employeeId).slice(0, 6);
  }

  const [corr] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attendanceCorrections)
    .where(and(eq(attendanceCorrections.tenantId, tid), eq(attendanceCorrections.status, "pending")));
  const [ob] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(onboardingInvites)
    .where(and(eq(onboardingInvites.tenantId, tid), eq(onboardingInvites.status, "submitted")));

  // Claims this user can act on now: manager stage for their reports (or all, for admins), finance stage for finance
  let pendingClaimCount = 0;
  if (can(t.permissions, "reimbursements", "approve")) {
    const admin = can(t.permissions, "reimbursements", "configure");
    const stages = [
      admin ? sql`${reimbursementClaims.status} = 'pending_manager'` : sql`(${reimbursementClaims.status} = 'pending_manager' and ${employees.managerId} = ${t.employeeId ?? "-"})`,
      ...(isFinance(t.permissions) ? [sql`${reimbursementClaims.status} = 'pending_finance'`] : []),
    ];
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(reimbursementClaims)
      .innerJoin(employees, eq(employees.id, reimbursementClaims.employeeId))
      .where(and(eq(reimbursementClaims.tenantId, tid), sql`${reimbursementClaims.employeeId} <> ${t.employeeId ?? "-"}`, sql`(${sql.join(stages, sql` or `)})`));
    pendingClaimCount = r?.n ?? 0;
  }

  // Birthdays and work anniversaries in the next 14 days
  const celebrations = await db.execute<{ id: string; name: string; department: string | null; kind: string; date: string; years: number }>(sql`
    with e as (
      select ${employees.id} as id, ${employees.fullName} as name, ${departments.name} as department,
             ${employees.dateOfBirth} as dob, ${employees.dateOfJoining} as doj
      from ${employees} left join ${departments} on ${departments.id} = ${employees.departmentId}
      where ${employees.tenantId} = ${tid} and ${employees.status} not in ('exited','inactive')
    ), d as (select generate_series(${today}::date, ${today}::date + 13, interval '1 day')::date as day)
    select e.id, e.name, e.department, 'birthday' as kind, d.day::text as date, 0 as years
      from e join d on e.dob is not null and extract(month from e.dob) = extract(month from d.day) and extract(day from e.dob) = extract(day from d.day)
    union all
    select e.id, e.name, e.department, 'anniversary' as kind, d.day::text as date, (extract(year from d.day) - extract(year from e.doj))::int as years
      from e join d on extract(month from e.doj) = extract(month from d.day) and extract(day from e.doj) = extract(day from d.day) and d.day > e.doj
    order by date, name limit 8`);

  return c.json({
    date: today,
    employees: { total: counts.reduce((a, b) => a + b.n, 0), active: n("active", "probation", "notice"), inactive: n("inactive", "exited"), onboarding: n("onboarding"), probation: n("probation") },
    attendance,
    pendingLeaveCount,
    pendingLeaves,
    pendingCorrections: corr?.n ?? 0,
    pendingClaimCount,
    awaitingVerification: ob?.n ?? 0,
    // probation ending soon (or ended) without a decision, for people this user can see
    idsExpiring: can(c.get("tenant").permissions, "employees", "edit") ? await expiringCount(c.get("db"), c.get("tenant").tenantId) : 0,
    probationDue: can(c.get("tenant").permissions, "employees", "view") ? (await onProbation(c.get("db"), c.get("tenant").tenantId, await teamScope(c, "employees"))).filter((p) => p.due).length : 0,
    celebrations: [...celebrations],
  });
});

// ---------- the setup checklist ----------
type Checklist = { done?: string[]; hidden?: boolean };

/** Each setup step, done or not, from what the company has actually set up. */
dashboardRoutes.get("/setup", requirePerm("settings", "configure"), async (c) => {
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [[t], [emp], [admins], [bank], [me], [br]] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, tid)),
    db.select({ n: sql<number>`count(*)::int`, paid: sql<number>`count(*) filter (where ${employees.annualCtc} > 0)::int` }).from(employees).where(eq(employees.tenantId, tid)),
    db.select({ n: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.tenantId, tid), sql`${memberships.roleId} is not null`, eq(memberships.status, "active"))),
    db.select({ n: sql<number>`count(*)::int` }).from(companyBankAccounts).where(eq(companyBankAccounts.tenantId, tid)),
    db.select({ twoFactor: user.twoFactorEnabled }).from(user).where(eq(user.id, c.get("session")!.userId)),
    db.select({ n: sql<number>`count(*)::int` }).from(branches).where(eq(branches.tenantId, tid)),
  ]);
  const list = ((t?.settings as { setupChecklist?: Checklist } | null)?.setupChecklist ?? {}) as Checklist;
  const step = Number(t?.setupStep ?? 0);
  const statutory = (t?.statutory ?? {}) as Record<string, { enabled?: boolean; registration?: string | null }>;
  const auto: Record<SetupItemKey, boolean> = {
    kyc: t?.kycStatus === "approved",
    company: !!(t?.pan && t?.registeredAddress),
    statutory: step >= 3 || Object.values(statutory).some((x) => x?.registration),
    // a new company has default pay settings, so it's done once there's a branch or the step was saved
    payroll: step >= 4 || (br?.n ?? 0) > 0,
    employees: (emp?.n ?? 0) > 0,
    salaries: (emp?.paid ?? 0) > 0,
    admins: (admins?.n ?? 0) > 1,
    bank: (bank?.n ?? 0) > 0,
    leave: false,
    holidays: false,
    security: !!me?.twoFactor,
  };
  const items = SETUP_ITEMS.map((i) => ({ ...i, done: auto[i.key] || (list.done ?? []).includes(i.key) }));
  const required = items.filter((i) => i.required);
  return c.json({
    items,
    requiredDone: required.filter((i) => i.done).length,
    requiredTotal: required.length,
    complete: !!t?.setupCompletedAt,
    hidden: !!list.hidden,
  });
});

/** Tick a step that can't be detected (like reviewing the defaults), or untick it. */
dashboardRoutes.post("/setup/:key", requirePerm("settings", "configure"), async (c) => {
  const key = c.req.param("key") as SetupItemKey;
  const item = SETUP_ITEMS.find((i) => i.key === key);
  if (!item?.manual) throw badRequest("That step is ticked off automatically once it's done");
  const body = (await c.req.json().catch(() => ({}))) as { done?: boolean };
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [t] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tid));
  const cur = ((t?.s as { setupChecklist?: Checklist } | null)?.setupChecklist ?? {}) as Checklist;
  const done = new Set(cur.done ?? []);
  if (body.done === false) done.delete(key);
  else done.add(key);
  await db.update(tenants).set({ settings: sql`${tenants.settings} || ${JSON.stringify({ setupChecklist: { ...cur, done: [...done] } })}::jsonb` }).where(eq(tenants.id, tid));
  return c.json({ ok: true });
});

/** Finish setup (all required steps done), or just hide the card for now. */
dashboardRoutes.post("/setup-finish", requirePerm("settings", "configure"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { hideOnly?: boolean };
  const db = c.get("db");
  const tid = c.get("tenant").tenantId;
  const [t] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tid));
  const cur = ((t?.s as { setupChecklist?: Checklist } | null)?.setupChecklist ?? {}) as Checklist;
  await db
    .update(tenants)
    .set({ settings: sql`${tenants.settings} || ${JSON.stringify({ setupChecklist: { ...cur, hidden: true } })}::jsonb`, ...(body.hideOnly ? {} : { setupCompletedAt: new Date() }) })
    .where(eq(tenants.id, tid));
  if (!body.hideOnly) await audit(c, { action: "tenant.setup_complete", entity: "tenant", entityId: tid, summary: "Completed company setup" });
  return c.json({ ok: true });
});
