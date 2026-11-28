ALTER TABLE "attendance_devices" ADD COLUMN "require_blink" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "kiosk_events" ADD COLUMN "blinked" boolean DEFAULT false NOT NULL;