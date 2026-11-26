CREATE TABLE "travel_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"code" text NOT NULL,
	"employee_id" text NOT NULL,
	"purpose" text NOT NULL,
	"from_city" text NOT NULL,
	"to_city" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"mode" text DEFAULT 'train' NOT NULL,
	"estimated_cost" numeric(16, 3) DEFAULT 0 NOT NULL,
	"advance_amount" numeric(16, 3) DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending_manager' NOT NULL,
	"manager_approved_by" text,
	"manager_approved_at" timestamp with time zone,
	"finance_approved_by" text,
	"finance_approved_at" timestamp with time zone,
	"rejected_by" text,
	"rejection_reason" text,
	"advance_paid_on" date,
	"advance_reference" text,
	"settled_at" timestamp with time zone,
	"settled_by" text,
	"recovery_loan_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reimbursement_claims" ADD COLUMN "travel_request_id" text;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travel_requests_code_uq" ON "travel_requests" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "travel_requests_emp_idx" ON "travel_requests" USING btree ("tenant_id","employee_id");