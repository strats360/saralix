import { doublePrecision, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, timestamps } from "./_helpers";

/** An objective for the company, a team or a person, in a period such as "FY2026-27 Q3". */
export const objectives = pgTable(
  "objectives",
  {
    id: id(),
    tenantId: tenantId(),
    level: text("level").notNull(), // company | team | individual
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    period: text("period").notNull(),
    /** Who answers for it: the person for a personal one, a lead for a company or team one. */
    ownerId: text("owner_id").references(() => employees.id, { onDelete: "set null" }),
    departmentId: text("department_id"),
    /** The objective this one lines up under. */
    parentId: text("parent_id"),
    status: text("status").notNull().default("active"), // active | archived
    /** From the latest check in: on_track | at_risk | off_track. */
    confidence: text("confidence"),
    lastCheckinAt: timestamp("last_checkin_at", { withTimezone: true }),
    createdBy: text("created_by"),
    ...timestamps,
  },
  (t) => [index("objectives_tenant_idx").on(t.tenantId, t.period), index("objectives_owner_idx").on(t.tenantId, t.ownerId)],
);

export const keyResults = pgTable(
  "key_results",
  {
    id: id(),
    tenantId: tenantId(),
    objectiveId: text("objective_id")
      .notNull()
      .references(() => objectives.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("number"), // number | percent | currency | done
    start: doublePrecision("start").notNull().default(0),
    target: doublePrecision("target").notNull(),
    current: doublePrecision("current").notNull().default(0),
    unit: text("unit"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("key_results_objective_idx").on(t.objectiveId)],
);

/** A progress update: new values for the key results, how confident the owner is, and a note. */
export const okrCheckins = pgTable(
  "okr_checkins",
  {
    id: id(),
    tenantId: tenantId(),
    objectiveId: text("objective_id")
      .notNull()
      .references(() => objectives.id, { onDelete: "cascade" }),
    values: jsonb("values").$type<Record<string, number>>().notNull(),
    progress: integer("progress").notNull(),
    confidence: text("confidence").notNull(),
    note: text("note").notNull().default(""),
    byUserId: text("by_user_id"),
    byName: text("by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("okr_checkins_objective_idx").on(t.objectiveId, t.createdAt)],
);
