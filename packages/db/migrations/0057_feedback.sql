CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"review_id" text,
	"about_employee_id" text NOT NULL,
	"from_employee_id" text NOT NULL,
	"requested_by" text,
	"requested_by_name" text,
	"relation" text,
	"prompt" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"strengths" text,
	"improvements" text,
	"rating" integer,
	"due_on" date,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_review_id_performance_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."performance_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_about_employee_id_employees_id_fk" FOREIGN KEY ("about_employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_from_employee_id_employees_id_fk" FOREIGN KEY ("from_employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_about_idx" ON "feedback" USING btree ("tenant_id","about_employee_id");--> statement-breakpoint
CREATE INDEX "feedback_from_idx" ON "feedback" USING btree ("tenant_id","from_employee_id","status");--> statement-breakpoint
CREATE INDEX "feedback_review_idx" ON "feedback" USING btree ("review_id");