import { index, jsonb, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { attendanceDevices } from "./time";
import { id, timestamps } from "./_helpers";

/** A person's face, as descriptors (numbers, not photos), enrolled with their consent. */
export const faceTemplates = pgTable(
  "face_templates",
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    samples: jsonb("samples").$type<number[][]>().notNull(),
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
    /** self: the person enrolled from their own app; hr: HR enrolled them with the person present. */
    enrolledVia: text("enrolled_via").notNull().default("self"),
    enrolledBy: text("enrolled_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("face_templates_employee_uq").on(t.employeeId), index("face_templates_tenant_idx").on(t.tenantId)],
);

/** Every face the kiosk saw: who it matched, and the photo, so HR can check punches. */
export const kioskEvents = pgTable(
  "kiosk_events",
  {
    id: id(),
    tenantId: tenantId(),
    deviceId: text("device_id")
      .notNull()
      .references(() => attendanceDevices.id, { onDelete: "cascade" }),
    employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
    /** punched | repeat | unknown | unsure | undone */
    result: text("result").notNull(),
    distance: real("distance"),
    photoKey: text("photo_key"),
    punchedAt: timestamp("punched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("kiosk_events_tenant_idx").on(t.tenantId, t.createdAt)],
);
