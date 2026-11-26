import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

/** A 1:1 between a manager and someone who reports to them. */
export const oneOnOnes = pgTable(
  "one_on_ones",
  {
    id: id(),
    tenantId: tenantId(),
    managerId: text("manager_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    repeat: text("repeat").notNull().default("none"),
    status: text("status").notNull().default("scheduled"), // scheduled | done | cancelled
    agenda: jsonb("agenda").$type<{ id: string; text: string; by: "manager" | "employee"; done: boolean }[]>().notNull().default([]),
    actions: jsonb("actions").$type<{ id: string; text: string; owner: "manager" | "employee"; due: string | null; done: boolean }[]>().notNull().default([]),
    sharedNotes: text("shared_notes").notNull().default(""),
    /** Each side's private notes. The other person never sees them. */
    managerNotes: text("manager_notes").notNull().default(""),
    employeeNotes: text("employee_notes").notNull().default(""),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("one_on_ones_manager_idx").on(t.tenantId, t.managerId, t.scheduledFor), index("one_on_ones_employee_idx").on(t.tenantId, t.employeeId, t.scheduledFor)],
);
