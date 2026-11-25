CREATE TABLE "pending_signups" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pending_signups_token_uq" ON "pending_signups" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "pending_signups_email_idx" ON "pending_signups" USING btree ("email");