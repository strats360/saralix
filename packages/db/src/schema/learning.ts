import { bigint, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

/** A course (lessons and a quiz) or a policy to read and confirm. */
export const courses = pgTable(
  "courses",
  {
    id: id(),
    tenantId: tenantId(),
    kind: text("kind").notNull().default("course"), // course | policy
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    lessons: jsonb("lessons").$type<{ id: string; title: string; body: string; videoUrl: string | null }[]>().notNull().default([]),
    quiz: jsonb("quiz").$type<{ id: string; question: string; options: string[]; answer: number }[]>().notNull().default([]),
    passMark: integer("pass_mark").notNull().default(70),
    acknowledgement: text("acknowledgement").notNull().default(""),
    audience: jsonb("audience").$type<{ departmentIds: string[]; branchIds: string[] }>().notNull().default({ departmentIds: [], branchIds: [] }),
    dueDays: integer("due_days").notNull().default(14),
    status: text("status").notNull().default("draft"), // draft | published | archived
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fileKey: text("file_key"),
    fileName: text("file_name"),
    fileType: text("file_type"),
    fileSize: bigint("file_size", { mode: "number" }),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [index("courses_tenant_idx").on(t.tenantId, t.status)],
);

/** One person's copy of a course: when it was assigned, due, started, done, and their score. */
export const courseEnrollments = pgTable(
  "course_enrollments",
  {
    id: id(),
    tenantId: tenantId(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lessonsDone: jsonb("lessons_done").$type<string[]>().notNull().default([]),
    attempts: integer("attempts").notNull().default(0),
    score: integer("score"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("course_enrollments_uq").on(t.courseId, t.employeeId), index("course_enrollments_emp_idx").on(t.tenantId, t.employeeId)],
);
