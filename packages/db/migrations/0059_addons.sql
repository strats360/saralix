CREATE TABLE "addons" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"pricing" text DEFAULT 'per_employee' NOT NULL,
	"price" numeric(16, 3) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_addons" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"addon_key" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"started_by" text,
	"ended_by" text
);
--> statement-breakpoint
ALTER TABLE "tenant_addons" ADD CONSTRAINT "tenant_addons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_addons" ADD CONSTRAINT "tenant_addons_addon_key_addons_key_fk" FOREIGN KEY ("addon_key") REFERENCES "public"."addons"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_addons_tenant_idx" ON "tenant_addons" USING btree ("tenant_id","addon_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_addons_active_uq" ON "tenant_addons" USING btree ("tenant_id","addon_key") WHERE "tenant_addons"."ended_at" is null;--> statement-breakpoint
-- not on sale until each feature ships; the platform team switches them on in the console
INSERT INTO "addons" ("key", "name", "description", "pricing", "price", "sort_order", "active") VALUES
  ('addon.ai_assistant', 'AI assistant', 'Answers employees'' questions about leave, pay and policies, explains payslips, and applies for leave for them.', 'per_employee', 30, 1, false),
  ('addon.work_tools', 'Sign in and work tools', 'Sign in with Google or Microsoft, approvals and alerts in Slack and Microsoft Teams, and a connector for AI tools.', 'per_employee', 20, 2, false),
  ('addon.face_kiosk', 'Face attendance kiosk', 'A shared tablet at the entrance that recognises faces for punch in and out.', 'flat', 999, 3, false),
  ('addon.workflows', 'Forms and workflows', 'Your own request forms with approval steps, for anything HR doesn''t cover out of the box.', 'per_employee', 15, 4, false)
ON CONFLICT ("key") DO NOTHING;
