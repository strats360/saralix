import { Hono, type Context } from "hono";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { employees, feedback, performanceReviews, reviewCycles, tenants } from "@hrms/db";
import { answerFeedbackSchema, askFeedbackSchema, can, FEEDBACK_MIN, fmtDate, giveFeedbackSchema, reviewFeedbackRequestSchema, todayLocal } from "@hrms/shared";
import type { AppEnv } from "../env";
import { requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { sendNotification } from "../services/notifications";

type Row = typeof feedback.$inferSelect;
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const me = (c: Context<AppEnv>) => c.get("tenant").employeeId ?? null;
const ACTIVE = ["onboarding", "probation", "active", "notice"];

async function names(c: Context<AppEnv>, ids: string[]) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map<string, { name: string; first: string; email: string; managerId: string | null }>();
  const rows = await c.get("db").select({ id: employees.id, name: employees.fullName, first: employees.firstName, email: employees.workEmail, managerId: employees.managerId }).from(employees).where(inArray(employees.id, list));
  return new Map(rows.map((r) => [r.id, r]));
}

async function email(c: Context<AppEnv>, to: { first: string; email: string } | undefined, subject: string, heading: string, lines: string[], cta: { label: string; path: string }) {
  if (!to?.email) return;
  const [t] = await c.get("db").select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tid(c)));
  const { html, text } = layout({ company: t?.name ?? "Saralix", heading, paragraphs: [`Hi ${to.first},`, ...lines], cta: { label: cta.label, url: `${c.env.APP_URL}${cta.path}` } });
  await sendNotification(c, "feedback", { to: to.email, subject, html, text }).catch((e) => console.error("feedback email failed", e));
}

/** Check people are current colleagues, and not the person the feedback is about. */
async function colleagues(c: Context<AppEnv>, ids: string[], about: string) {
  const list = [...new Set(ids)];
  if (list.includes(about)) throw badRequest("Pick colleagues other than the person the feedback is about");
  const rows = await c.get("db").select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, tid(c)), inArray(employees.id, list), inArray(employees.status, ACTIVE)));
  if (rows.length !== list.length) throw badRequest("Pick current colleagues");
  return list;
}

/** Create requests, skipping anyone already asked and not yet answered. */
async function ask(c: Context<AppEnv>, opts: { kind: "review" | "request"; about: string; from: string[]; prompt: string; dueOn: string | null; reviewId?: string; relation?: string }) {
  const db = c.get("db");
  if (opts.dueOn && opts.dueOn < todayLocal()) throw badRequest("The due date has already passed");
  const open = await db.select({ from: feedback.fromEmployeeId }).from(feedback).where(and(eq(feedback.tenantId, tid(c)), eq(feedback.aboutEmployeeId, opts.about), eq(feedback.kind, opts.kind), eq(feedback.status, "requested"), opts.reviewId ? eq(feedback.reviewId, opts.reviewId) : undefined));
  const skip = new Set(open.map((o) => o.from));
  const fresh = opts.from.filter((f) => !skip.has(f));
  if (!fresh.length) return 0;
  const s = c.get("session")!;
  await db.insert(feedback).values(fresh.map((f) => ({ tenantId: tid(c), kind: opts.kind, reviewId: opts.reviewId ?? null, aboutEmployeeId: opts.about, fromEmployeeId: f, requestedBy: s.userId, requestedByName: s.name, relation: opts.relation ?? null, prompt: opts.prompt, dueOn: opts.dueOn })));
  const p = await names(c, [opts.about, ...fresh]);
  const aboutName = p.get(opts.about)?.name ?? "a colleague";
  for (const f of fresh) {
    const self = opts.kind === "request";
    await email(c, p.get(f), self ? `${aboutName} asked for your feedback` : `Feedback on ${aboutName} for their review`, self ? `${aboutName} would like your feedback` : `Share feedback on ${aboutName}`, [self ? `${aboutName} asked what they do well and what they could do better.` : `${s.name} asked for your feedback on ${aboutName} as part of their performance review. Only their manager and HR see your name.`, ...(opts.prompt ? [`"${opts.prompt}"`] : []), ...(opts.dueOn ? [`Please answer by ${fmtDate(opts.dueOn)}.`] : [])], { label: "Give feedback", path: "/me/feedback" });
  }
  return fresh.length;
}

const out = (f: Row, n: Map<string, { name: string }>, showFrom: boolean) => ({
  id: f.id,
  kind: f.kind,
  about: { id: f.aboutEmployeeId, name: n.get(f.aboutEmployeeId)?.name ?? "" },
  from: showFrom ? { id: f.fromEmployeeId, name: n.get(f.fromEmployeeId)?.name ?? "" } : null,
  relation: f.relation,
  prompt: f.prompt,
  status: f.status,
  visibility: f.visibility,
  strengths: f.strengths,
  improvements: f.improvements,
  rating: f.rating,
  dueOn: f.dueOn,
  submittedAt: f.submittedAt,
  createdAt: f.createdAt,
  requestedByName: f.requestedByName,
});

/* ---------------- 360 in a review: the reviewing manager and HR ---------------- */

export const reviewFeedbackRoutes = new Hono<AppEnv>();
reviewFeedbackRoutes.use("*", requirePerm("employees", "view"));

async function reviewFor(c: Context<AppEnv>, id: string) {
  const [r] = await c.get("db").select().from(performanceReviews).where(and(eq(performanceReviews.id, id), eq(performanceReviews.tenantId, tid(c))));
  if (!r) throw notFound("Review");
  const hr = can(c.get("tenant").permissions, "employees", "configure");
  if (r.employeeId === me(c) || !(hr || (me(c) && r.managerId === me(c)))) throw notFound("Review");
  return r;
}

reviewFeedbackRoutes.get("/:reviewId", async (c) => {
  const r = await reviewFor(c, c.req.param("reviewId"));
  const rows = await c.get("db").select().from(feedback).where(eq(feedback.reviewId, r.id)).orderBy(desc(feedback.createdAt));
  const n = await names(c, rows.flatMap((f) => [f.aboutEmployeeId, f.fromEmployeeId]));
  return c.json(rows.map((f) => out(f, n, true)));
});

reviewFeedbackRoutes.post("/:reviewId", v("json", reviewFeedbackRequestSchema), async (c) => {
  const r = await reviewFor(c, c.req.param("reviewId"));
  const [cy] = await c.get("db").select().from(reviewCycles).where(eq(reviewCycles.id, r.cycleId));
  if (cy?.status !== "active" || r.stage === "shared" || r.stage === "acknowledged") throw badRequest("Feedback can only be asked for while the review is open");
  const b = c.req.valid("json");
  const from = await colleagues(c, b.fromEmployeeIds, r.employeeId);
  const asked = await ask(c, { kind: "review", about: r.employeeId, from, prompt: b.prompt, dueOn: b.dueOn ?? cy.managerDue, reviewId: r.id, relation: b.relation });
  await audit(c, { action: "feedback.review_request", entity: "performance_review", entityId: r.id, summary: `Asked ${asked} people for 360 feedback` });
  return c.json({ asked }, 201);
});

/* ---------------- self-service ---------------- */

export const essFeedbackRoutes = new Hono<AppEnv>();
essFeedbackRoutes.use("*", requireEmployee);

essFeedbackRoutes.get("/", async (c) => {
  const db = c.get("db");
  const eid = me(c)!;
  const reports = (await db.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, tid(c)), eq(employees.managerId, eid)))).map((r) => r.id);
  const rows = await db
    .select()
    .from(feedback)
    .where(and(eq(feedback.tenantId, tid(c)), or(eq(feedback.fromEmployeeId, eid), eq(feedback.aboutEmployeeId, eid), reports.length ? inArray(feedback.aboutEmployeeId, reports) : undefined)))
    .orderBy(desc(feedback.createdAt))
    .limit(500);
  const n = await names(c, rows.flatMap((f) => [f.aboutEmployeeId, f.fromEmployeeId]));
  // 360 answers about me: shown without names once my review is shared, and only with enough answers
  const reviewIds = [...new Set(rows.filter((f) => f.kind === "review" && f.aboutEmployeeId === eid).map((f) => f.reviewId!))];
  const shared = reviewIds.length ? new Set((await db.select({ id: performanceReviews.id }).from(performanceReviews).where(and(inArray(performanceReviews.id, reviewIds), inArray(performanceReviews.stage, ["shared", "acknowledged"])))).map((r) => r.id)) : new Set<string>();
  const answered360 = (rid: string) => rows.filter((f) => f.reviewId === rid && f.status === "submitted").length;
  const aboutMe = rows.filter((f) => f.aboutEmployeeId === eid && f.status === "submitted" && (f.kind === "review" ? shared.has(f.reviewId!) && answered360(f.reviewId!) >= FEEDBACK_MIN : f.kind === "request" || f.visibility === "private"));
  return c.json({
    toAnswer: rows.filter((f) => f.fromEmployeeId === eid && f.status === "requested").map((f) => out(f, n, false)),
    received: aboutMe.map((f) => out(f, n, f.kind !== "review")),
    asked: rows.filter((f) => f.aboutEmployeeId === eid && f.kind === "request" && f.status !== "submitted").map((f) => out(f, n, true)),
    given: rows.filter((f) => f.fromEmployeeId === eid && f.status === "submitted").map((f) => out(f, n, true)),
    // a manager sees what their team has received (names included), except 360 still being gathered
    team: rows.filter((f) => reports.includes(f.aboutEmployeeId) && f.fromEmployeeId !== eid && f.status === "submitted" && f.kind !== "review").map((f) => out(f, n, true)),
    minimum: FEEDBACK_MIN,
  });
});

/** Colleagues to give feedback to or ask. */
essFeedbackRoutes.get("/people", async (c) => {
  const rows = await c.get("db").select({ id: employees.id, name: employees.fullName, code: employees.employeeCode }).from(employees).where(and(eq(employees.tenantId, tid(c)), inArray(employees.status, ACTIVE))).orderBy(employees.fullName);
  return c.json(rows.filter((r) => r.id !== me(c)));
});

essFeedbackRoutes.post("/give", v("json", giveFeedbackSchema), async (c) => {
  const b = c.req.valid("json");
  const eid = me(c)!;
  await colleagues(c, [b.aboutEmployeeId], eid);
  const [row] = await c.get("db").insert(feedback).values({ tenantId: tid(c), kind: "given", aboutEmployeeId: b.aboutEmployeeId, fromEmployeeId: eid, status: "submitted", visibility: b.visibility, strengths: b.strengths, improvements: b.improvements, submittedAt: new Date() }).returning();
  const n = await names(c, [b.aboutEmployeeId, eid]);
  const about = n.get(b.aboutEmployeeId);
  const from = n.get(eid)?.name ?? "A colleague";
  if (b.visibility === "private") await email(c, about, `${from} gave you feedback`, `Feedback from ${from}`, [`${from} shared some feedback with you.`], { label: "Read it", path: "/me/feedback" });
  if (about?.managerId && about.managerId !== eid) {
    const mgr = (await names(c, [about.managerId])).get(about.managerId);
    await email(c, mgr, `Feedback on ${about.name}`, `${from} shared feedback on ${about.name}`, [b.visibility === "manager" ? "It's for you only. They won't see it." : "They've been sent it too."], { label: "Read it", path: "/me/feedback" });
  }
  return c.json({ id: row!.id }, 201);
});

essFeedbackRoutes.post("/ask", v("json", askFeedbackSchema), async (c) => {
  const b = c.req.valid("json");
  const from = await colleagues(c, b.fromEmployeeIds, me(c)!);
  return c.json({ asked: await ask(c, { kind: "request", about: me(c)!, from, prompt: b.prompt, dueOn: b.dueOn }) }, 201);
});

async function mineToAnswer(c: Context<AppEnv>, id: string) {
  const [f] = await c.get("db").select().from(feedback).where(and(eq(feedback.id, id), eq(feedback.tenantId, tid(c))));
  if (!f || f.fromEmployeeId !== me(c)) throw notFound("Feedback request");
  if (f.status !== "requested") throw badRequest(f.status === "submitted" ? "You've already answered this" : "You declined this one");
  return f;
}

essFeedbackRoutes.post("/:id/answer", v("json", answerFeedbackSchema), async (c) => {
  const f = await mineToAnswer(c, c.req.param("id"));
  const b = c.req.valid("json");
  if (f.kind === "review" && !b.rating) throw badRequest("Give an overall rating from 1 to 5");
  if (f.kind === "review") {
    const [r] = await c.get("db").select({ stage: performanceReviews.stage }).from(performanceReviews).where(eq(performanceReviews.id, f.reviewId!));
    if (r && (r.stage === "shared" || r.stage === "acknowledged")) throw forbidden("That review is already finished");
  }
  await c.get("db").update(feedback).set({ status: "submitted", strengths: b.strengths, improvements: b.improvements, rating: f.kind === "review" ? b.rating : null, submittedAt: new Date() }).where(eq(feedback.id, f.id));
  if (f.kind === "request") {
    const n = await names(c, [f.aboutEmployeeId, f.fromEmployeeId]);
    await email(c, n.get(f.aboutEmployeeId), `${n.get(f.fromEmployeeId)?.name} answered your feedback request`, "You've got feedback", [`${n.get(f.fromEmployeeId)?.name} answered your request for feedback.`], { label: "Read it", path: "/me/feedback" });
  }
  return c.json({ ok: true });
});

essFeedbackRoutes.post("/:id/decline", async (c) => {
  const f = await mineToAnswer(c, c.req.param("id"));
  await c.get("db").update(feedback).set({ status: "declined" }).where(eq(feedback.id, f.id));
  return c.json({ ok: true });
});
