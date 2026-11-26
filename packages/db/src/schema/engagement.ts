import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

export type SurveyQuestion = { id: string; type: "scale" | "enps" | "choice" | "multi" | "text"; text: string; options: string[]; required: boolean };

/** Pulse checks, polls and surveys. */
export const surveys = pgTable(
  "surveys",
  {
    id: id(),
    tenantId: tenantId(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind").notNull().default("pulse"), // pulse | poll | survey
    anonymous: boolean("anonymous").notNull().default(true),
    audience: jsonb("audience").$type<{ departmentIds: string[]; branchIds: string[] }>().notNull().default({ departmentIds: [], branchIds: [] }),
    questions: jsonb("questions").$type<SurveyQuestion[]>().notNull(),
    status: text("status").notNull().default("draft"), // draft | open | closed
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closesOn: date("closes_on", { mode: "string" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    shareResults: boolean("share_results").notNull().default(false),
    /** People it was sent to when it opened, for the response rate. */
    invited: integer("invited").notNull().default(0),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    authorId: text("author_id"),
    authorName: text("author_name"),
    ...timestamps,
  },
  (t) => [index("surveys_tenant_idx").on(t.tenantId, t.status)],
);

/**
 * The answers. For an anonymous survey employeeId is null and only the team is kept, for the
 * breakdown, and the time is rounded to the day so it can't be matched to the participation row.
 */
export const surveyResponses = pgTable(
  "survey_responses",
  {
    id: id(),
    tenantId: tenantId(),
    surveyId: text("survey_id")
      .notNull()
      .references(() => surveys.id, { onDelete: "cascade" }),
    employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
    departmentId: text("department_id"),
    answers: jsonb("answers").$type<Record<string, number | string | string[]>>().notNull(),
    submittedOn: date("submitted_on", { mode: "string" }).notNull(),
  },
  (t) => [index("survey_responses_survey_idx").on(t.surveyId)],
);

/** Who has answered, never what they answered. Stops anyone answering twice. */
export const surveyParticipants = pgTable(
  "survey_participants",
  {
    surveyId: text("survey_id")
      .notNull()
      .references(() => surveys.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    tenantId: tenantId(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.surveyId, t.employeeId] })],
);

/** A company's values for kudos, and whether kudos is on. */
export const engagementSettings = pgTable("engagement_settings", {
  tenantId: tenantId().primaryKey(),
  values: jsonb("values").$type<{ key: string; label: string; emoji: string }[]>().notNull(),
  kudosEnabled: boolean("kudos_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kudos = pgTable(
  "kudos",
  {
    id: id(),
    tenantId: tenantId(),
    fromEmployeeId: text("from_employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    toEmployeeIds: jsonb("to_employee_ids").$type<string[]>().notNull(),
    value: text("value").notNull(),
    message: text("message").notNull(),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: text("hidden_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("kudos_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const kudosCheers = pgTable(
  "kudos_cheers",
  {
    id: id(),
    tenantId: tenantId(),
    kudosId: text("kudos_id")
      .notNull()
      .references(() => kudos.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("kudos_cheers_uq").on(t.kudosId, t.employeeId)],
);
