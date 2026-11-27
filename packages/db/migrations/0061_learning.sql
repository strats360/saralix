CREATE TABLE "course_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"course_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_on" date NOT NULL,
	"started_at" timestamp with time zone,
	"lessons_done" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"score" integer,
	"completed_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text DEFAULT 'course' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"lessons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quiz" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pass_mark" integer DEFAULT 70 NOT NULL,
	"acknowledgement" text DEFAULT '' NOT NULL,
	"audience" jsonb DEFAULT '{"departmentIds":[],"branchIds":[]}'::jsonb NOT NULL,
	"due_days" integer DEFAULT 14 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"file_key" text,
	"file_name" text,
	"file_type" text,
	"file_size" bigint,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_enrollments_uq" ON "course_enrollments" USING btree ("course_id","employee_id");--> statement-breakpoint
CREATE INDEX "course_enrollments_emp_idx" ON "course_enrollments" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "courses_tenant_idx" ON "courses" USING btree ("tenant_id","status");