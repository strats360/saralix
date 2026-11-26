import { Hono, type Context } from "hono";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { departments, designations, employees, engagementSettings, kudos, kudosCheers, surveyParticipants, surveyResponses, surveys, tenants } from "@hrms/db";
import { ANONYMITY_MIN, checkAnswers, DEFAULT_VALUES, headline, inAudience, kudosSchema, responseSchema, summarise, surveySchema, todayLocal, valuesSchema, type Answer, type CompanyValue, type Question } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { sendNotification } from "../services/notifications";
import { emailSurvey, employeeNames, surveyAudience, type Survey } from "../services/engagement";

const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const ACTIVE = ["onboarding", "probation", "active", "notice"];

async function settingsOf(c: Context<AppEnv>): Promise<{ values: CompanyValue[]; kudosEnabled: boolean }> {
  const [s] = await c.get("db").select().from(engagementSettings).where(eq(engagementSettings.tenantId, tid(c)));
  return { values: s?.values ?? DEFAULT_VALUES, kudosEnabled: s?.kudosEnabled ?? true };
}

/** Results, with anonymous ones held back until enough people have answered. */
async function resultsOf(c: Context<AppEnv>, s: Survey, withBreakdown: boolean) {
  const db = c.get("db");
  const rows = await db.select({ answers: surveyResponses.answers, departmentId: surveyResponses.departmentId }).from(surveyResponses).where(eq(surveyResponses.surveyId, s.id));
  const hidden = s.anonymous && rows.length < ANONYMITY_MIN;
  const questions = s.questions as Question[];
  const overall = hidden ? null : summarise(questions, rows.map((r) => r.answers as Record<string, Answer>));
  let breakdown: { departmentId: string | null; name: string; responses: number; hidden: boolean; headlines: string[] }[] = [];
  if (withBreakdown && !hidden) {
    const groups = new Map<string | null, Record<string, Answer>[]>();
    for (const r of rows) groups.set(r.departmentId, [...(groups.get(r.departmentId) ?? []), r.answers as Record<string, Answer>]);
    const ids = [...groups.keys()].filter((x): x is string => !!x);
    const names = ids.length ? new Map((await db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, ids))).map((d) => [d.id, d.name])) : new Map<string, string>();
    breakdown = [...groups].map(([departmentId, list]) => {
      const small = s.anonymous && list.length < ANONYMITY_MIN;
      // written answers never appear per team: the words could give someone away
      return { departmentId, name: departmentId ? names.get(departmentId) ?? "Other" : "No department", responses: list.length, hidden: small, headlines: small ? [] : summarise(questions, list).map((q) => (q.type === "text" ? "" : headline(q))) };
    }).sort((a, b) => b.responses - a.responses);
  }
  return { responses: rows.length, invited: s.invited, hidden, minimum: ANONYMITY_MIN, questions: overall, breakdown };
}

const surveyOut = (s: Survey, responses = 0) => ({ ...s, responses, rate: s.invited ? Math.round((responses / s.invited) * 100) : null });

/* ---------------- HR ---------------- */

export const engagementRoutes = new Hono<AppEnv>();
engagementRoutes.use("*", requirePerm("employees", "edit"));

engagementRoutes.get("/surveys", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(surveys).where(eq(surveys.tenantId, tid(c))).orderBy(desc(surveys.createdAt)).limit(200);
  const counts = rows.length ? new Map((await db.select({ id: surveyResponses.surveyId, n: sql<number>`count(*)::int` }).from(surveyResponses).where(inArray(surveyResponses.surveyId, rows.map((r) => r.id))).groupBy(surveyResponses.surveyId)).map((r) => [r.id, r.n])) : new Map<string, number>();
  return c.json(rows.map((s) => surveyOut(s, counts.get(s.id) ?? 0)));
});

async function load(c: Context<AppEnv>, id: string) {
  const [s] = await c.get("db").select().from(surveys).where(and(eq(surveys.id, id), eq(surveys.tenantId, tid(c))));
  if (!s) throw notFound("Survey");
  return s;
}

const fields = (b: z.infer<typeof surveySchema>) => {
  if (b.closesOn && b.closesOn < todayLocal()) throw badRequest("The closing date has already passed");
  return { title: b.title, description: b.description, kind: b.kind, anonymous: b.anonymous, audience: { departmentIds: b.departmentIds, branchIds: b.branchIds }, questions: b.questions, closesOn: b.closesOn, shareResults: b.shareResults };
};

async function open(c: Context<AppEnv>, s: Survey) {
  const db = c.get("db");
  const invited = (await surveyAudience(db, s)).length;
  if (!invited) throw badRequest("Nobody is in the chosen teams yet");
  const [row] = await db.update(surveys).set({ status: "open", openedAt: new Date(), invited, updatedAt: new Date() }).where(and(eq(surveys.id, s.id), eq(surveys.status, "draft"))).returning();
  if (!row) throw badRequest("It's already open");
  const emailed = await emailSurvey(db, c.env, row, "open");
  await audit(c, { action: "survey.open", entity: "survey", entityId: s.id, summary: `Opened "${s.title}" for ${invited} people${emailed ? `, emailed ${emailed}` : ""}` });
  return { ...surveyOut(row), emailed };
}

engagementRoutes.post("/surveys", v("json", surveySchema.and(z.object({ open: z.boolean().default(false) }))), async (c) => {
  const b = c.req.valid("json");
  const s = c.get("session")!;
  const [row] = await c.get("db").insert(surveys).values({ ...fields(b), tenantId: tid(c), authorId: s.userId, authorName: s.name }).returning();
  await audit(c, { action: "survey.create", entity: "survey", entityId: row!.id, summary: `Created "${row!.title}"` });
  return c.json(b.open ? await open(c, row!) : surveyOut(row!), 201);
});

engagementRoutes.get("/surveys/:id", async (c) => c.json(surveyOut(await load(c, c.req.param("id")))));

engagementRoutes.put("/surveys/:id", v("json", surveySchema), async (c) => {
  const s = await load(c, c.req.param("id"));
  const f = fields(c.req.valid("json"));
  // once people are answering, the questions and who it's for are fixed
  const set = s.status === "draft" ? f : { title: f.title, description: f.description, closesOn: f.closesOn, shareResults: f.shareResults };
  if (s.status === "closed" && f.closesOn !== s.closesOn) throw badRequest("It's closed. Reopen it to change the closing date.");
  const [row] = await c.get("db").update(surveys).set({ ...set, reminderSentAt: f.closesOn !== s.closesOn ? null : s.reminderSentAt, updatedAt: new Date() }).where(eq(surveys.id, s.id)).returning();
  return c.json(surveyOut(row!));
});

engagementRoutes.post("/surveys/:id/open", async (c) => c.json(await open(c, await load(c, c.req.param("id")))));

engagementRoutes.post("/surveys/:id/close", async (c) => {
  const s = await load(c, c.req.param("id"));
  if (s.status !== "open") throw badRequest("Only an open survey can be closed");
  await c.get("db").update(surveys).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(eq(surveys.id, s.id));
  await audit(c, { action: "survey.close", entity: "survey", entityId: s.id, summary: `Closed "${s.title}"` });
  return c.json({ ok: true });
});

engagementRoutes.post("/surveys/:id/reopen", v("json", z.object({ closesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null) })), async (c) => {
  const s = await load(c, c.req.param("id"));
  if (s.status !== "closed") throw badRequest("Only a closed survey can be reopened");
  const { closesOn } = c.req.valid("json");
  if (closesOn && closesOn < todayLocal()) throw badRequest("The closing date has already passed");
  await c.get("db").update(surveys).set({ status: "open", closedAt: null, closesOn, reminderSentAt: null, updatedAt: new Date() }).where(eq(surveys.id, s.id));
  await audit(c, { action: "survey.reopen", entity: "survey", entityId: s.id, summary: `Reopened "${s.title}"` });
  return c.json({ ok: true });
});

engagementRoutes.post("/surveys/:id/remind", async (c) => {
  const s = await load(c, c.req.param("id"));
  if (s.status !== "open") throw badRequest("Only an open survey can be sent a reminder");
  const sent = await emailSurvey(c.get("db"), c.env, s, "remind");
  await audit(c, { action: "survey.remind", entity: "survey", entityId: s.id, summary: `Reminded people about "${s.title}" (${sent} emails)` });
  return c.json({ sent });
});

engagementRoutes.delete("/surveys/:id", async (c) => {
  const s = await load(c, c.req.param("id"));
  if (s.status !== "draft") throw badRequest("Only drafts can be deleted. Close it instead.");
  await c.get("db").delete(surveys).where(eq(surveys.id, s.id));
  return c.json({ ok: true });
});

engagementRoutes.get("/surveys/:id/results", async (c) => c.json(await resultsOf(c, await load(c, c.req.param("id")), true)));

/** Who hasn't answered yet, by name. Only for surveys that aren't anonymous. */
engagementRoutes.get("/surveys/:id/pending", async (c) => {
  const s = await load(c, c.req.param("id"));
  if (s.anonymous) throw badRequest("It's anonymous, so we don't show who has or hasn't answered");
  const people = await surveyAudience(c.get("db"), s, true);
  const names = await employeeNames(c.get("db"), people.map((p) => p.id));
  return c.json(people.map((p) => ({ employeeId: p.id, name: names.get(p.id)?.name ?? "" })).sort((a, b) => a.name.localeCompare(b.name)));
});

engagementRoutes.get("/settings", async (c) => c.json(await settingsOf(c)));

engagementRoutes.put("/settings", v("json", valuesSchema), async (c) => {
  const b = c.req.valid("json");
  await c.get("db").insert(engagementSettings).values({ tenantId: tid(c), values: b.values, kudosEnabled: b.kudosEnabled }).onConflictDoUpdate({ target: engagementSettings.tenantId, set: { values: b.values, kudosEnabled: b.kudosEnabled, updatedAt: new Date() } });
  await audit(c, { action: "engagement.settings", entity: "tenant", entityId: tid(c), summary: `Kudos ${b.kudosEnabled ? "on" : "off"}, values: ${b.values.map((x) => x.label).join(", ")}` });
  return c.json({ ok: true });
});

/** Every kudos in a period, including hidden ones, with who gave and got the most. */
engagementRoutes.get("/kudos", v("query", z.object({ days: z.coerce.number().int().min(1).max(366).default(30) })), async (c) => {
  const db = c.get("db");
  const since = new Date(Date.now() - c.req.valid("query").days * 86_400_000);
  const rows = await db.select().from(kudos).where(and(eq(kudos.tenantId, tid(c)), gte(kudos.createdAt, since))).orderBy(desc(kudos.createdAt)).limit(1000);
  const names = await employeeNames(db, rows.flatMap((k) => [k.fromEmployeeId, ...k.toEmployeeIds]));
  const live = rows.filter((k) => !k.hiddenAt);
  const tally = (ids: string[]) => {
    const m = new Map<string, number>();
    for (const i of ids) m.set(i, (m.get(i) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([employeeId, count]) => ({ employeeId, name: names.get(employeeId)?.name ?? "", count }));
  };
  const byValue = new Map<string, number>();
  for (const k of live) byValue.set(k.value, (byValue.get(k.value) ?? 0) + 1);
  return c.json({
    total: live.length,
    givers: new Set(live.map((k) => k.fromEmployeeId)).size,
    received: tally(live.flatMap((k) => k.toEmployeeIds)),
    given: tally(live.map((k) => k.fromEmployeeId)),
    byValue: [...byValue].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    items: rows.map((k) => ({ id: k.id, from: { id: k.fromEmployeeId, name: names.get(k.fromEmployeeId)?.name ?? "" }, to: k.toEmployeeIds.map((i) => ({ id: i, name: names.get(i)?.name ?? "" })), value: k.value, message: k.message, createdAt: k.createdAt, hidden: !!k.hiddenAt })),
  });
});

engagementRoutes.post("/kudos/:id/hide", v("json", z.object({ hidden: z.boolean() })), async (c) => {
  const db = c.get("db");
  const [k] = await db.select().from(kudos).where(and(eq(kudos.id, c.req.param("id")), eq(kudos.tenantId, tid(c))));
  if (!k) throw notFound("Kudos");
  const { hidden } = c.req.valid("json");
  await db.update(kudos).set({ hiddenAt: hidden ? new Date() : null, hiddenBy: hidden ? c.get("session")!.userId : null }).where(eq(kudos.id, k.id));
  await audit(c, { action: hidden ? "kudos.hide" : "kudos.unhide", entity: "kudos", entityId: k.id, summary: `${hidden ? "Hid" : "Restored"} a kudos: "${k.message.slice(0, 80)}"` });
  return c.json({ ok: true });
});

/* ---------------- self-service ---------------- */

export const essEngagementRoutes = new Hono<AppEnv>();
essEngagementRoutes.use("*", requireEmployee);

const eid = (c: Context<AppEnv>) => c.get("tenant").employeeId!;

async function me(c: Context<AppEnv>) {
  const [e] = await c.get("db").select({ departmentId: employees.departmentId, branchId: employees.branchId }).from(employees).where(eq(employees.id, eid(c)));
  return e ?? { departmentId: null, branchId: null };
}

/** Open surveys for me, plus closed ones from the last 60 days whose results were shared. */
essEngagementRoutes.get("/surveys", async (c) => {
  const db = c.get("db");
  const who = await me(c);
  const rows = (await db.select().from(surveys).where(and(eq(surveys.tenantId, tid(c)), sql`(${surveys.status} = 'open' or (${surveys.status} = 'closed' and ${surveys.shareResults} and ${surveys.closedAt} > now() - interval '60 days'))`)).orderBy(desc(surveys.openedAt))).filter((s) => inAudience(s.audience, who));
  const answered = rows.length ? new Set((await db.select({ id: surveyParticipants.surveyId }).from(surveyParticipants).where(and(eq(surveyParticipants.employeeId, eid(c)), inArray(surveyParticipants.surveyId, rows.map((r) => r.id))))).map((r) => r.id)) : new Set<string>();
  return c.json(rows.map((s) => ({ id: s.id, title: s.title, description: s.description, kind: s.kind, anonymous: s.anonymous, status: s.status, closesOn: s.closesOn, questions: s.questions.length, answered: answered.has(s.id), resultsShared: s.status === "closed" && s.shareResults })));
});

async function mine(c: Context<AppEnv>, id: string) {
  const [s] = await c.get("db").select().from(surveys).where(and(eq(surveys.id, id), eq(surveys.tenantId, tid(c))));
  if (!s || s.status === "draft" || !inAudience(s.audience, await me(c))) throw notFound("Survey");
  return s;
}

essEngagementRoutes.get("/surveys/:id", async (c) => {
  const s = await mine(c, c.req.param("id"));
  const [done] = await c.get("db").select().from(surveyParticipants).where(and(eq(surveyParticipants.surveyId, s.id), eq(surveyParticipants.employeeId, eid(c))));
  return c.json({ id: s.id, title: s.title, description: s.description, kind: s.kind, anonymous: s.anonymous, status: s.status, closesOn: s.closesOn, questions: s.questions, answered: !!done, resultsShared: s.status === "closed" && s.shareResults });
});

essEngagementRoutes.post("/surveys/:id/respond", v("json", responseSchema), async (c) => {
  const s = await mine(c, c.req.param("id"));
  if (s.status !== "open") throw badRequest("This survey has closed");
  const checked = checkAnswers(s.questions as Question[], c.req.valid("json").answers);
  if (!checked.ok) throw badRequest(checked.error);
  const who = await me(c);
  const db = c.get("db");
  await db.transaction(async (tx) => {
    const [claimed] = await tx.insert(surveyParticipants).values({ surveyId: s.id, employeeId: eid(c), tenantId: tid(c) }).onConflictDoNothing().returning();
    if (!claimed) throw badRequest("You've already answered this one");
    await tx.insert(surveyResponses).values({ tenantId: tid(c), surveyId: s.id, employeeId: s.anonymous ? null : eid(c), departmentId: who.departmentId, answers: checked.answers, submittedOn: todayLocal() });
  });
  // anonymous answers aren't audited: the log would tie a person to the time they answered
  if (!s.anonymous) await audit(c, { action: "survey.respond", entity: "survey", entityId: s.id, summary: `Answered "${s.title}"` });
  return c.json({ ok: true });
});

essEngagementRoutes.get("/surveys/:id/results", async (c) => {
  const s = await mine(c, c.req.param("id"));
  if (!(s.status === "closed" && s.shareResults)) throw badRequest("The results haven't been shared");
  return c.json(await resultsOf(c, s, false));
});

/** Colleagues to give kudos to. */
essEngagementRoutes.get("/people", async (c) => {
  const db = c.get("db");
  const rows = await db.select({ id: employees.id, name: employees.fullName, code: employees.employeeCode, photoKey: employees.photoKey, department: departments.name, designation: designations.name }).from(employees).leftJoin(departments, eq(departments.id, employees.departmentId)).leftJoin(designations, eq(designations.id, employees.designationId)).where(and(eq(employees.tenantId, tid(c)), inArray(employees.status, ACTIVE))).orderBy(employees.fullName);
  return c.json(rows.filter((r) => r.id !== eid(c)).map(({ photoKey, ...r }) => ({ ...r, hasPhoto: !!photoKey })));
});

essEngagementRoutes.get("/settings", async (c) => c.json(await settingsOf(c)));

/** The kudos wall, newest first, 30 at a time. */
essEngagementRoutes.get("/kudos", v("query", z.object({ before: z.iso.datetime({ offset: true }).optional(), employeeId: z.string().optional() })), async (c) => {
  const db = c.get("db");
  const q = c.req.valid("query");
  const rows = await db
    .select()
    .from(kudos)
    .where(and(eq(kudos.tenantId, tid(c)), isNull(kudos.hiddenAt), q.before ? lt(kudos.createdAt, new Date(q.before)) : undefined, q.employeeId ? sql`(${kudos.toEmployeeIds} ? ${q.employeeId} or ${kudos.fromEmployeeId} = ${q.employeeId})` : undefined))
    .orderBy(desc(kudos.createdAt))
    .limit(30);
  const names = await employeeNames(db, rows.flatMap((k) => [k.fromEmployeeId, ...k.toEmployeeIds]));
  const cheers = rows.length ? await db.select({ id: kudosCheers.kudosId, n: sql<number>`count(*)::int`, mine: sql<boolean>`bool_or(${kudosCheers.employeeId} = ${eid(c)})` }).from(kudosCheers).where(inArray(kudosCheers.kudosId, rows.map((k) => k.id))).groupBy(kudosCheers.kudosId) : [];
  const cm = new Map(cheers.map((x) => [x.id, x]));
  return c.json({
    items: rows.map((k) => ({ id: k.id, from: { id: k.fromEmployeeId, name: names.get(k.fromEmployeeId)?.name ?? "" }, to: k.toEmployeeIds.map((i) => ({ id: i, name: names.get(i)?.name ?? "" })), value: k.value, message: k.message, createdAt: k.createdAt, cheers: cm.get(k.id)?.n ?? 0, cheered: !!cm.get(k.id)?.mine, mine: k.fromEmployeeId === eid(c) })),
    next: rows.length === 30 ? rows[29]!.createdAt : null,
  });
});

essEngagementRoutes.post("/kudos", v("json", kudosSchema), async (c) => {
  const b = c.req.valid("json");
  const db = c.get("db");
  const s = await settingsOf(c);
  if (!s.kudosEnabled) throw badRequest("Kudos is switched off for your company");
  const value = s.values.find((x) => x.key === b.value);
  if (!value) throw badRequest("Pick one of your company's values");
  const to = [...new Set(b.toEmployeeIds)];
  if (to.includes(eid(c))) throw badRequest("You can't give kudos to yourself");
  const people = await db.select({ id: employees.id, first: employees.firstName, email: employees.workEmail }).from(employees).where(and(eq(employees.tenantId, tid(c)), inArray(employees.id, to), inArray(employees.status, ACTIVE)));
  if (people.length !== to.length) throw badRequest("Pick current colleagues");
  // a little friction against spam: at most 20 a day
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(kudos).where(and(eq(kudos.fromEmployeeId, eid(c)), sql`${kudos.createdAt} > now() - interval '1 day'`))) as [{ n: number }];
  if (n >= 20) throw badRequest("That's 20 kudos today. Save some for tomorrow.");
  const [row] = await db.insert(kudos).values({ tenantId: tid(c), fromEmployeeId: eid(c), toEmployeeIds: to, value: b.value, message: b.message }).returning();
  const from = (await employeeNames(db, [eid(c)])).get(eid(c))?.name ?? "A colleague";
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
  for (const p of people) {
    const { html, text } = layout({ company: t?.name ?? "Saralix", heading: `${value.emoji} Kudos from ${from}`, paragraphs: [`Hi ${p.first},`, `${from} gave you kudos for ${value.label.toLowerCase()}:`, `"${b.message}"`], cta: { label: "See it on the kudos wall", url: `${c.env.APP_URL}/me/engagement` } });
    await sendNotification(c, "kudos_received", { to: p.email, subject: `${from} gave you kudos`, html, text }).catch((e) => console.error("kudos email failed", e));
  }
  return c.json({ id: row!.id }, 201);
});

essEngagementRoutes.post("/kudos/:id/cheer", async (c) => {
  const db = c.get("db");
  const [k] = await db.select().from(kudos).where(and(eq(kudos.id, c.req.param("id")), eq(kudos.tenantId, tid(c)), isNull(kudos.hiddenAt)));
  if (!k) throw notFound("Kudos");
  const gone = await db.delete(kudosCheers).where(and(eq(kudosCheers.kudosId, k.id), eq(kudosCheers.employeeId, eid(c)))).returning();
  if (!gone.length) await db.insert(kudosCheers).values({ tenantId: tid(c), kudosId: k.id, employeeId: eid(c) }).onConflictDoNothing();
  return c.json({ cheered: !gone.length });
});

essEngagementRoutes.delete("/kudos/:id", async (c) => {
  const db = c.get("db");
  const [k] = await db.select().from(kudos).where(and(eq(kudos.id, c.req.param("id")), eq(kudos.tenantId, tid(c))));
  if (!k || k.fromEmployeeId !== eid(c)) throw notFound("Kudos");
  await db.delete(kudos).where(eq(kudos.id, k.id));
  return c.json({ ok: true });
});
