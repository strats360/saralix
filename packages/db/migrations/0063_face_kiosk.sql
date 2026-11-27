CREATE TABLE "face_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"samples" jsonb NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"enrolled_via" text DEFAULT 'self' NOT NULL,
	"enrolled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kiosk_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"device_id" text NOT NULL,
	"employee_id" text,
	"result" text NOT NULL,
	"distance" real,
	"photo_key" text,
	"punched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD COLUMN "kind" text DEFAULT 'biometric' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD COLUMN "pair_code_hash" text;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD COLUMN "pair_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "face_templates" ADD CONSTRAINT "face_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_templates" ADD CONSTRAINT "face_templates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_events" ADD CONSTRAINT "kiosk_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_events" ADD CONSTRAINT "kiosk_events_device_id_attendance_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."attendance_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_events" ADD CONSTRAINT "kiosk_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "face_templates_employee_uq" ON "face_templates" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "face_templates_tenant_idx" ON "face_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "kiosk_events_tenant_idx" ON "kiosk_events" USING btree ("tenant_id","created_at");