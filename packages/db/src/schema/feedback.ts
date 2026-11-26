import { index, integer, pgTable, text, timestamp, date } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { performanceReviews } from "./performance";
import { id } from "./_helpers";

/** Feedback from one colleague about another: asked for in a review, asked for any time, or just given. */
export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    tenantId: tenantId(),
    kind: text("kind").notNull(), // review | request | given
    reviewId: text("review_id").references(() => performanceReviews.id, { onDelete: "cascade" }),
    aboutEmployeeId: text("about_employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    fromEmployeeId: text("from_employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** Who asked: the person themselves, their manager, or HR (a user id). */
    requestedBy: text("requested_by"),
    requestedByName: text("requested_by_name"),
    relation: text("relation"),
    prompt: text("prompt").notNull().default(""),
    status: text("status").notNull().default("requested"), // requested | submitted | declined
    visibility: text("visibility").notNull().default("private"), // private | manager
    strengths: text("strengths"),
    improvements: text("improvements"),
    rating: integer("rating"),
    dueOn: date("due_on", { mode: "string" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feedback_about_idx").on(t.tenantId, t.aboutEmployeeId), index("feedback_from_idx").on(t.tenantId, t.fromEmployeeId, t.status), index("feedback_review_idx").on(t.reviewId)],
);
