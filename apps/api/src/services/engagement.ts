import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { employees, surveyParticipants, surveys, tenants, type Database } from "@hrms/db";
import { fmtDate } from "@hrms/shared";
import type { Env } from "../env";
import { layout } from "../lib/email";
import { mailerFor } from "../lib/context";
import { allowedRecipients } from "./notifications";
import { audienceOf } from "./announcements";

export type Survey = typeof surveys.$inferSelect;

/** Staff a survey goes to, minus anyone who has already answered when `pendingOnly`. */
export async function surveyAudience(db: Database, s: Pick<Survey, "id" | "tenantId" | "audience">, pendingOnly = false) {
  const people = await audienceOf(db, s);
  if (!pendingOnly || !people.length) return people;
  const done = new Set((await db.select({ id: surveyParticipants.employeeId }).from(surveyParticipants).where(eq(surveyParticipants.surveyId, s.id))).map((r) => r.id));
  return people.filter((p) => !done.has(p.id));
}

/** Email the people a survey is for: when it opens, or as a reminder to those who haven't answered. */
export async function emailSurvey(db: Database, env: Env, s: Survey, mode: "open" | "remind") {
  const people = await surveyAudience(db, s, mode === "remind");
  const ok = await allowedRecipients(db, s.tenantId, "surveys", people.map((p) => p.email));
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, s.tenantId));
  const mailer = mailerFor(env);
  const queue = people.filter((p) => p.email && ok.has(p.email));
  const what = s.kind === "poll" ? "poll" : "survey";
  let sent = 0;
  for (let i = 0; i < queue.length; i += 10) {
    await Promise.all(
      queue.slice(i, i + 10).map(async (p) => {
        try {
          const { html, text } = layout({
            company: t?.name ?? "Saralix",
            heading: mode === "open" ? s.title : `Reminder: ${s.title}`,
            paragraphs: [
              `Hi ${p.first},`,
              mode === "open" ? `There's a new ${what} for you${s.questions.length > 1 ? ` with ${s.questions.length} questions` : ""}. It takes a minute or two.` : `You haven't answered this ${what} yet.`,
              ...(s.description ? [s.description] : []),
              ...(s.anonymous ? ["Your answers are anonymous. Nobody can see who said what."] : []),
              ...(s.closesOn ? [`It closes on ${fmtDate(s.closesOn)}.`] : []),
            ],
            cta: { label: `Open the ${what}`, url: `${env.APP_URL}/me/engagement/surveys/${s.id}` },
          });
          await mailer.send({ to: p.email!, subject: mode === "open" ? `${what === "poll" ? "Quick poll" : "Your view"}: ${s.title}` : `Reminder: ${s.title}`, html, text });
          sent++;
        } catch (e) {
          console.error("survey email failed", e);
        }
      }),
    );
  }
  return sent;
}

/** Hourly: close surveys past their closing date, and remind people the day before one closes. */
export async function runSurveyJobs(db: Database, env: Env, now = new Date()) {
  const today = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  const closed = await db.update(surveys).set({ status: "closed", closedAt: now, updatedAt: now }).where(and(eq(surveys.status, "open"), sql`${surveys.closesOn} < ${today}`)).returning({ id: surveys.id });
  // claim the reminder first so two runs can't both send it
  const due = await db.update(surveys).set({ reminderSentAt: now }).where(and(eq(surveys.status, "open"), lte(surveys.closesOn, tomorrow), sql`${surveys.closesOn} >= ${today}`, isNull(surveys.reminderSentAt))).returning();
  let reminded = 0;
  for (const s of due) reminded += await emailSurvey(db, env, s, "remind");
  return { closed: closed.length, reminders: due.length, reminded };
}

/** Department names for the breakdown. */
export async function employeeNames(db: Database, ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; first: string; email: string | null }>();
  const rows = await db.select({ id: employees.id, name: employees.fullName, first: employees.firstName, email: employees.workEmail }).from(employees).where(inArray(employees.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, { name: r.name, first: r.first, email: r.email }]));
}
