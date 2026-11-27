import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

type Field = { id: string; label: string; type: string; required: boolean; help: string; options: string[] };
type Step = { id: string; kind: string; employeeId: string | null };

/** A request form HR built (Forms and workflows add-on), with its approval steps. */
export const forms = pgTable(
  "forms",
  {
    id: id(),
    tenantId: tenantId(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    fields: jsonb("fields").$type<Field[]>().notNull().default([]),
    steps: jsonb("steps").$type<Step[]>().notNull().default([]),
    audience: jsonb("audience").$type<{ departmentIds: string[]; branchIds: string[] }>().notNull().default({ departmentIds: [], branchIds: [] }),
    status: text("status").notNull().default("draft"), // draft | published | archived
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [index("forms_tenant_idx").on(t.tenantId, t.status)],
);

/** One filled in form. Fields and steps are copied in, so later edits to the form don't change it. */
export const formSubmissions = pgTable(
  "form_submissions",
  {
    id: id(),
    tenantId: tenantId(),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    fields: jsonb("fields").$type<Field[]>().notNull(),
    steps: jsonb("steps").$type<Step[]>().notNull(),
    answers: jsonb("answers").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    files: jsonb("files").$type<Record<string, { key: string; name: string; type: string; size: number }>>().notNull().default({}),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | withdrawn
    stepIndex: integer("step_index").notNull().default(0),
    /** Who must act now: an employee, or null with stepKind "hr" for HR. */
    approverId: text("approver_id"),
    stepKind: text("step_kind"),
    history: jsonb("history").$type<{ step: number; kind: string; by: string; byName: string; decision: string; note: string; at: string }[]>().notNull().default([]),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("form_submissions_tenant_idx").on(t.tenantId, t.formId), index("form_submissions_approver_idx").on(t.tenantId, t.approverId, t.status), index("form_submissions_employee_idx").on(t.tenantId, t.employeeId)],
);
