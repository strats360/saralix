import { bigint, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenancy";
import { id } from "./_helpers";

/** A company's KYC details, and the latest decision on them. */
export const companyKyc = pgTable("company_kyc", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  submittedBy: text("submitted_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
  reviewerName: text("reviewer_name"),
  /** Why it was sent back or rejected, shown to the company. */
  reviewNote: text("review_note"),
  /** Every submission and decision, oldest first. */
  history: jsonb("history").$type<{ at: string; by: string; action: string; note?: string }[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kycDocuments = pgTable(
  "kyc_documents",
  {
    id: id(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    fileKey: text("file_key").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    uploadedBy: text("uploaded_by"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("kyc_documents_tenant_idx").on(t.tenantId)],
);
