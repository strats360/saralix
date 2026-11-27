import { Hono, type Context } from "hono";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { courseEnrollments, courses, createDb, employees, tenants, type Database } from "@hrms/db";
import { courseSchema, enrollmentState, fmtDate, gradeQuiz, inAudience, quizAttemptSchema, todayLocal } from "@hrms/shared";
import type { AppEnv, Env } from "../env";
import { mailerFor, requireEmployee, requirePerm } from "../lib/context";
import { v } from "../lib/validate";
import { badRequest, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { layout } from "../lib/email";
import { deleteFile, getFile, putFile, safeName } from "../lib/storage";
import { allowedRecipients } from "../services/notifications";
import { audienceOf } from "../services/announcements";
import { imageType } from "./photos";

type Course = typeof courses.$inferSelect;
type Enrollment = typeof courseEnrollments.$inferSelect;
const tid = (c: Context<AppEnv>) => c.get("tenant").tenantId;
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Email people about a course: when it's assigned, or a reminder before it's due. */
async function emailAbout(db: Database, env: Env, course: Course, people: { email: string | null; first: string; dueOn: string }[], mode: "assigned" | "remind") {
  if (!people.length) return 0;
  const ok = await allowedRecipients(db, course.tenantId, "learning", people.map((p) => p.email ?? ""));
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, course.tenantId));
  const mailer = mailerFor(env);
  const what = course.kind === "policy" ? "policy" : "course";
  let sent = 0;
  for (const p of people.filter((x) => x.email && ok.has(x.email))) {
    const { html, text } = layout({ company: t?.name ?? "Saralix", heading: mode === "assigned" ? course.title : `Reminder: ${course.title}`, paragraphs: [`Hi ${p.first},`, mode === "assigned" ? `There's a ${what} for you to ${course.kind === "policy" ? "read and confirm" : "complete"}.` : `This ${what} is due on ${fmtDate(p.dueOn)}.`, ...(course.description ? [course.description] : []), ...(mode === "assigned" ? [`Please finish it by ${fmtDate(p.dueOn)}.`] : [])], cta: { label: course.kind === "policy" ? "Read it" : "Start", url: `${env.APP_URL}/me/learning/${course.id}` } });
    await mailer.send({ to: p.email!, subject: mode === "assigned" ? `${course.kind === "policy" ? "Please read" : "New course"}: ${course.title}` : `Due soon: ${course.title}`, html, text }).then(() => sent++).catch((e) => console.error("learning email failed", e));
  }
  return sent;
}

/** Assign a published course to everyone it's for who doesn't have it yet. Returns the new ones. */
async function assign(db: Database, course: Course, onlyEmployeeId?: string) {
  const people = (await audienceOf(db, course)).filter((p) => !onlyEmployeeId || p.id === onlyEmployeeId);
  if (!people.length) return [];
  const dueOn = addDays(todayLocal(), course.dueDays);
  const rows = await db.insert(courseEnrollments).values(people.map((p) => ({ tenantId: course.tenantId, courseId: course.id, employeeId: p.id, dueOn }))).onConflictDoNothing().returning();
  const byId = new Map(people.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, email: byId.get(r.employeeId)?.email ?? null, first: byId.get(r.employeeId)?.first ?? "" }));
}

/** Hourly: remind people two days before something is due, once. */
export async function runLearningReminders(env: Env) {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) return;
  const db = createDb(url, { max: 2 });
  try {
    const soon = addDays(todayLocal(), 2);
    const due = await db.update(courseEnrollments).set({ reminderSentAt: new Date() }).where(and(isNull(courseEnrollments.completedAt), isNull(courseEnrollments.reminderSentAt), lte(courseEnrollments.dueOn, soon), sql`${courseEnrollments.dueOn} >= ${todayLocal()}`)).returning();
    const byCourse = new Map<string, Enrollment[]>();
    for (const e of due) byCourse.set(e.courseId, [...(byCourse.get(e.courseId) ?? []), e]);
    for (const [courseId, list] of byCourse) {
      const [course] = await db.select().from(courses).where(and(eq(courses.id, courseId), eq(courses.status, "published")));
      if (!course) continue;
      const people = await db.select({ id: employees.id, email: employees.workEmail, first: employees.firstName }).from(employees).where(inArray(employees.id, list.map((e) => e.employeeId)));
      await emailAbout(db, env, course, people.map((p) => ({ ...p, dueOn: list.find((e) => e.employeeId === p.id)!.dueOn })), "remind");
    }
    if (due.length) console.log(`learning: ${due.length} reminders`);
  } catch (e) {
    console.error("learning reminders failed", e);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

/* ---------------- HR ---------------- */

export const learningRoutes = new Hono<AppEnv>();
learningRoutes.use("*", requirePerm("employees", "edit"));

async function load(c: Context<AppEnv>, id: string) {
  const [x] = await c.get("db").select().from(courses).where(and(eq(courses.id, id), eq(courses.tenantId, tid(c))));
  if (!x) throw notFound("Course");
  return x;
}
const fields = (b: ReturnType<typeof courseSchema.parse>) => ({ kind: b.kind, title: b.title, description: b.description, lessons: b.lessons, quiz: b.kind === "course" ? b.quiz : [], passMark: b.passMark, acknowledgement: b.acknowledgement, audience: { departmentIds: b.departmentIds, branchIds: b.branchIds }, dueDays: b.dueDays });
const out = ({ fileKey, ...x }: Course) => ({ ...x, hasFile: !!fileKey });

learningRoutes.get("/", async (c) => {
  const db = c.get("db");
  const rows = await db.select().from(courses).where(eq(courses.tenantId, tid(c))).orderBy(desc(courses.createdAt)).limit(200);
  const today = todayLocal();
  const stats = rows.length
    ? await db
        .select({ id: courseEnrollments.courseId, assigned: sql<number>`count(*)::int`, done: sql<number>`count(${courseEnrollments.completedAt})::int`, overdue: sql<number>`count(*) filter (where ${courseEnrollments.completedAt} is null and ${courseEnrollments.dueOn} < ${today})::int` })
        .from(courseEnrollments)
        .where(inArray(courseEnrollments.courseId, rows.map((r) => r.id)))
        .groupBy(courseEnrollments.courseId)
    : [];
  const s = new Map(stats.map((x) => [x.id, x]));
  return c.json(rows.map((r) => ({ ...out(r), assigned: s.get(r.id)?.assigned ?? 0, done: s.get(r.id)?.done ?? 0, overdue: s.get(r.id)?.overdue ?? 0 })));
});

learningRoutes.post("/", v("json", courseSchema), async (c) => {
  const [row] = await c.get("db").insert(courses).values({ ...fields(c.req.valid("json")), tenantId: tid(c), createdBy: c.get("session")!.userId }).returning();
  await audit(c, { action: "learning.create", entity: "course", entityId: row!.id, summary: `Created "${row!.title}"` });
  return c.json(out(row!), 201);
});

learningRoutes.get("/:id", async (c) => c.json(out(await load(c, c.req.param("id")))));

learningRoutes.put("/:id", v("json", courseSchema), async (c) => {
  const x = await load(c, c.req.param("id"));
  const f = fields(c.req.valid("json"));
  if (x.status !== "draft" && f.kind !== x.kind) throw badRequest("It's published, so it can't change between course and policy");
  const [row] = await c.get("db").update(courses).set({ ...f, updatedAt: new Date() }).where(eq(courses.id, x.id)).returning();
  // widening who it's for assigns it to the newcomers straight away
  if (row!.status === "published") await emailAbout(c.get("db"), c.env, row!, await assign(c.get("db"), row!), "assigned");
  return c.json(out(row!));
});

learningRoutes.post("/:id/publish", async (c) => {
  const x = await load(c, c.req.param("id"));
  if (x.status === "published") throw badRequest("It's already published");
  if (x.kind === "policy" && !x.fileKey && !x.lessons.some((l) => l.body.trim())) throw badRequest("Attach the policy document or write it in, first");
  const [row] = await c.get("db").update(courses).set({ status: "published", publishedAt: x.publishedAt ?? new Date(), updatedAt: new Date() }).where(eq(courses.id, x.id)).returning();
  const added = await assign(c.get("db"), row!);
  const emailed = await emailAbout(c.get("db"), c.env, row!, added, "assigned");
  await audit(c, { action: "learning.publish", entity: "course", entityId: x.id, summary: `Published "${x.title}" to ${added.length} people` });
  return c.json({ assigned: added.length, emailed });
});

learningRoutes.post("/:id/archive", async (c) => {
  const x = await load(c, c.req.param("id"));
  await c.get("db").update(courses).set({ status: "archived", updatedAt: new Date() }).where(eq(courses.id, x.id));
  await audit(c, { action: "learning.archive", entity: "course", entityId: x.id, summary: `Archived "${x.title}"` });
  return c.json({ ok: true });
});

learningRoutes.delete("/:id", async (c) => {
  const x = await load(c, c.req.param("id"));
  if (x.status !== "draft") throw badRequest("Only drafts can be deleted. Archive it instead.");
  if (x.fileKey) await deleteFile(c.env, x.fileKey).catch(() => {});
  await c.get("db").delete(courses).where(eq(courses.id, x.id));
  return c.json({ ok: true });
});

learningRoutes.post("/:id/file", async (c) => {
  const x = await load(c, c.req.param("id"));
  const file = (await c.req.formData()).get("file");
  if (!(file instanceof File) || !file.size) throw badRequest("Attach a file");
  if (file.size > 20 * 1024 * 1024) throw badRequest("Files must be 20 MB or smaller");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 ? "application/pdf" : imageType(bytes);
  if (!type) throw badRequest("Attach a PDF or an image");
  const key = `tenants/${tid(c)}/learning/${x.id}/${crypto.randomUUID()}`;
  await putFile(c.env, key, bytes.buffer as ArrayBuffer, type);
  await c.get("db").update(courses).set({ fileKey: key, fileName: safeName(file.name || "document.pdf"), fileType: type, fileSize: file.size, updatedAt: new Date() }).where(eq(courses.id, x.id));
  if (x.fileKey) await deleteFile(c.env, x.fileKey).catch(() => {});
  return c.json({ ok: true });
});

learningRoutes.get("/:id/file", async (c) => {
  const x = await load(c, c.req.param("id"));
  if (!x.fileKey) throw notFound("Document");
  const f = await getFile(c.env, x.fileKey);
  if (!f) throw notFound("Document");
  return c.body(f.body as ArrayBuffer, 200, { "Content-Type": x.fileType ?? f.type, "Content-Disposition": `inline; filename="${x.fileName ?? "document.pdf"}"`, "Cache-Control": "private, no-store" });
});

/** Who it's assigned to, and where each person is. */
learningRoutes.get("/:id/progress", async (c) => {
  const x = await load(c, c.req.param("id"));
  const rows = await c.get("db").select({ e: courseEnrollments, name: employees.fullName, code: employees.employeeCode }).from(courseEnrollments).innerJoin(employees, eq(employees.id, courseEnrollments.employeeId)).where(eq(courseEnrollments.courseId, x.id)).orderBy(employees.fullName);
  const today = todayLocal();
  return c.json(rows.map(({ e, name, code }) => ({ employeeId: e.employeeId, name, code, dueOn: e.dueOn, state: enrollmentState(e, today), lessonsDone: e.lessonsDone.length, lessons: x.lessons.length, attempts: e.attempts, score: e.score, completedAt: e.completedAt })));
});

learningRoutes.post("/:id/remind", async (c) => {
  const x = await load(c, c.req.param("id"));
  if (x.status !== "published") throw badRequest("Publish it first");
  const rows = await c.get("db").select({ email: employees.workEmail, first: employees.firstName, dueOn: courseEnrollments.dueOn }).from(courseEnrollments).innerJoin(employees, eq(employees.id, courseEnrollments.employeeId)).where(and(eq(courseEnrollments.courseId, x.id), isNull(courseEnrollments.completedAt)));
  const sent = await emailAbout(c.get("db"), c.env, x, rows, "remind");
  await audit(c, { action: "learning.remind", entity: "course", entityId: x.id, summary: `Reminded ${sent} people about "${x.title}"` });
  return c.json({ sent });
});

/* ---------------- self-service ---------------- */

export const essLearningRoutes = new Hono<AppEnv>();
essLearningRoutes.use("*", requireEmployee);
const eid = (c: Context<AppEnv>) => c.get("tenant").employeeId!;

/** Published courses for me. Anything I should have but don't (I joined later) is assigned now. */
async function myCourses(c: Context<AppEnv>) {
  const db = c.get("db");
  const [me] = await db.select({ departmentId: employees.departmentId, branchId: employees.branchId }).from(employees).where(eq(employees.id, eid(c)));
  const published = (await db.select().from(courses).where(and(eq(courses.tenantId, tid(c)), eq(courses.status, "published")))).filter((x) => me && inAudience(x.audience, me));
  let mine = published.length ? await db.select().from(courseEnrollments).where(and(eq(courseEnrollments.employeeId, eid(c)), inArray(courseEnrollments.courseId, published.map((x) => x.id)))) : [];
  const missing = published.filter((x) => !mine.some((e) => e.courseId === x.id));
  if (missing.length) {
    for (const x of missing) await assign(db, x, eid(c));
    mine = await db.select().from(courseEnrollments).where(and(eq(courseEnrollments.employeeId, eid(c)), inArray(courseEnrollments.courseId, published.map((x) => x.id))));
  }
  // anything assigned earlier that's since been archived or moved out of my team still counts if I finished it
  return { published, mine };
}

essLearningRoutes.get("/", async (c) => {
  const { published, mine } = await myCourses(c);
  const today = todayLocal();
  return c.json(published.map((x) => {
    const e = mine.find((m) => m.courseId === x.id)!;
    return { id: x.id, kind: x.kind, title: x.title, description: x.description, lessons: x.lessons.length, quiz: x.quiz.length, dueOn: e.dueOn, state: enrollmentState(e, today), lessonsDone: e.lessonsDone.length, score: e.score, completedAt: e.completedAt };
  }).sort((a, b) => Number(a.state === "completed") - Number(b.state === "completed") || a.dueOn.localeCompare(b.dueOn)));
});

async function mine(c: Context<AppEnv>, id: string) {
  const { published, mine: list } = await myCourses(c);
  const x = published.find((p) => p.id === id);
  const e = list.find((m) => m.courseId === id);
  if (!x || !e) throw notFound("Course");
  return { x, e };
}

/** The course without the quiz answers. */
essLearningRoutes.get("/:id", async (c) => {
  const { x, e } = await mine(c, c.req.param("id"));
  return c.json({ id: x.id, kind: x.kind, title: x.title, description: x.description, lessons: x.lessons, quiz: x.quiz.map(({ answer: _a, ...q }) => q), passMark: x.passMark, acknowledgement: x.acknowledgement, hasFile: !!x.fileKey, fileName: x.fileName, enrollment: { dueOn: e.dueOn, state: enrollmentState(e, todayLocal()), lessonsDone: e.lessonsDone, attempts: e.attempts, score: e.score, completedAt: e.completedAt } });
});

const finished = (x: Course, lessonsDone: string[], passed: boolean) => x.lessons.every((l) => lessonsDone.includes(l.id)) && (x.quiz.length === 0 || passed);

essLearningRoutes.post("/:id/lessons/:lessonId", async (c) => {
  const { x, e } = await mine(c, c.req.param("id"));
  const lessonId = c.req.param("lessonId");
  if (!x.lessons.some((l) => l.id === lessonId)) throw notFound("Lesson");
  const done = [...new Set([...e.lessonsDone, lessonId])];
  const complete = !e.completedAt && x.kind === "course" && finished(x, done, (e.score ?? -1) >= x.passMark);
  await c.get("db").update(courseEnrollments).set({ lessonsDone: done, startedAt: e.startedAt ?? new Date(), ...(complete ? { completedAt: new Date() } : {}) }).where(eq(courseEnrollments.id, e.id));
  return c.json({ lessonsDone: done, completed: complete || !!e.completedAt });
});

essLearningRoutes.post("/:id/quiz", v("json", quizAttemptSchema), async (c) => {
  const { x, e } = await mine(c, c.req.param("id"));
  if (!x.quiz.length) throw badRequest("This course has no quiz");
  if (!x.lessons.every((l) => e.lessonsDone.includes(l.id))) throw badRequest("Finish the lessons first");
  const r = gradeQuiz(x.quiz, c.req.valid("json").answers, x.passMark);
  const best = Math.max(r.score, e.score ?? 0);
  const complete = !e.completedAt && r.passed;
  await c.get("db").update(courseEnrollments).set({ attempts: e.attempts + 1, score: best, startedAt: e.startedAt ?? new Date(), ...(complete ? { completedAt: new Date() } : {}) }).where(eq(courseEnrollments.id, e.id));
  if (complete) await audit(c, { action: "learning.complete", entity: "course", entityId: x.id, summary: `Completed "${x.title}" with ${r.score}%` });
  // tell them how many were wrong, not which answers were right
  return c.json({ score: r.score, passed: r.passed, wrong: r.wrong.length, passMark: x.passMark, completed: complete || !!e.completedAt });
});

essLearningRoutes.post("/:id/acknowledge", async (c) => {
  const { x, e } = await mine(c, c.req.param("id"));
  if (x.kind !== "policy") throw badRequest("Only policies are confirmed");
  if (e.completedAt) return c.json({ ok: true });
  await c.get("db").update(courseEnrollments).set({ startedAt: e.startedAt ?? new Date(), completedAt: new Date() }).where(eq(courseEnrollments.id, e.id));
  await audit(c, { action: "learning.acknowledge", entity: "course", entityId: x.id, summary: `Confirmed reading "${x.title}"` });
  return c.json({ ok: true });
});

essLearningRoutes.get("/:id/file", async (c) => {
  const { x } = await mine(c, c.req.param("id"));
  if (!x.fileKey) throw notFound("Document");
  const f = await getFile(c.env, x.fileKey);
  if (!f) throw notFound("Document");
  return c.body(f.body as ArrayBuffer, 200, { "Content-Type": x.fileType ?? f.type, "Content-Disposition": `inline; filename="${x.fileName ?? "document.pdf"}"`, "Cache-Control": "private, no-store" });
});
