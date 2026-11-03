CREATE TYPE "public"."passage_outcome" AS ENUM('accepted', 'duplicate', 'unknown_ticket', 'void_ticket', 'wrong_event');--> statement-breakpoint
CREATE TYPE "public"."scan_result" AS ENUM('valid', 'already_used', 'wrong_gate', 'void', 'invalid');--> statement-breakpoint
CREATE TABLE "manifest_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scanner_session_id" uuid NOT NULL,
	"ticket_count" integer NOT NULL,
	"cursor_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_id" uuid,
	"scanner_session_id" uuid NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"local_result" "scan_result" NOT NULL,
	"outcome" "passage_outcome" NOT NULL,
	"verify_ms" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manifest_downloads" ADD CONSTRAINT "manifest_downloads_scanner_session_id_scanner_sessions_id_fk" FOREIGN KEY ("scanner_session_id") REFERENCES "public"."scanner_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_scanner_session_id_scanner_sessions_id_fk" FOREIGN KEY ("scanner_session_id") REFERENCES "public"."scanner_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manifest_downloads_session_idx" ON "manifest_downloads" USING btree ("scanner_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passages_accepted_ticket_idx" ON "passages" USING btree ("ticket_id") WHERE "passages"."outcome" = 'accepted';--> statement-breakpoint
CREATE INDEX "passages_event_received_idx" ON "passages" USING btree ("event_id","received_at");