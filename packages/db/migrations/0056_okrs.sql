CREATE TABLE "key_results" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"objective_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'number' NOT NULL,
	"start" double precision DEFAULT 0 NOT NULL,
	"target" double precision NOT NULL,
	"current" double precision DEFAULT 0 NOT NULL,
	"unit" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objectives" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"level" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"period" text NOT NULL,
	"owner_id" text,
	"department_id" text,
	"parent_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"confidence" text,
	"last_checkin_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "okr_checkins" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"objective_id" text NOT NULL,
	"values" jsonb NOT NULL,
	"progress" integer NOT NULL,
	"confidence" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"by_user_id" text,
	"by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "key_results" ADD CONSTRAINT "key_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_results" ADD CONSTRAINT "key_results_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_owner_id_employees_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "okr_checkins" ADD CONSTRAINT "okr_checkins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "okr_checkins" ADD CONSTRAINT "okr_checkins_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "key_results_objective_idx" ON "key_results" USING btree ("objective_id");--> statement-breakpoint
CREATE INDEX "objectives_tenant_idx" ON "objectives" USING btree ("tenant_id","period");--> statement-breakpoint
CREATE INDEX "objectives_owner_idx" ON "objectives" USING btree ("tenant_id","owner_id");--> statement-breakpoint
CREATE INDEX "okr_checkins_objective_idx" ON "okr_checkins" USING btree ("objective_id","created_at");