import { date, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantIdColumn as tenantId } from "./org";
import { employees } from "./people";
import { id, money, timestamps } from "./_helpers";

export const travelRequests = pgTable(
  "travel_requests",
  {
    id: id(),
    tenantId: tenantId(),
    code: text("code").notNull(), // TR-1001
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    fromCity: text("from_city").notNull(),
    toCity: text("to_city").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    mode: text("mode").notNull().default("train"),
    estimatedCost: money("estimated_cost").notNull().default(0),
    advanceAmount: money("advance_amount").notNull().default(0),
    notes: text("notes").notNull().default(""),
    status: text("status").notNull().default("pending_manager"),
    managerApprovedBy: text("manager_approved_by"),
    managerApprovedAt: timestamp("manager_approved_at", { withTimezone: true }),
    financeApprovedBy: text("finance_approved_by"),
    financeApprovedAt: timestamp("finance_approved_at", { withTimezone: true }),
    rejectedBy: text("rejected_by"),
    rejectionReason: text("rejection_reason"),
    advancePaidOn: date("advance_paid_on", { mode: "string" }),
    advanceReference: text("advance_reference"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    settledBy: text("settled_by"),
    /** The one month advance recovery made at settlement. */
    recoveryLoanId: text("recovery_loan_id"),
    ...timestamps,
  },
  (t) => [uniqueIndex("travel_requests_code_uq").on(t.tenantId, t.code), index("travel_requests_emp_idx").on(t.tenantId, t.employeeId)],
);
