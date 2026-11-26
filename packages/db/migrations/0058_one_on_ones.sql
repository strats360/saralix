CREATE TABLE "one_on_ones" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"manager_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"repeat" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"agenda" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shared_notes" text DEFAULT '' NOT NULL,
	"manager_notes" text DEFAULT '' NOT NULL,
	"employee_notes" text DEFAULT '' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_on_ones" ADD CONSTRAINT "one_on_ones_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "one_on_ones_manager_idx" ON "one_on_ones" USING btree ("tenant_id","manager_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "one_on_ones_employee_idx" ON "one_on_ones" USING btree ("tenant_id","employee_id","scheduled_for");