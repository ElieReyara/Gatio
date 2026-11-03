CREATE TABLE "scanner_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scanner_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "scanner_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"invite_id" uuid,
	"first_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scanner_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "scanner_invites" ADD CONSTRAINT "scanner_invites_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scanner_invites" ADD CONSTRAINT "scanner_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scanner_sessions" ADD CONSTRAINT "scanner_sessions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scanner_sessions" ADD CONSTRAINT "scanner_sessions_invite_id_scanner_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."scanner_invites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scanner_invites_event_id_idx" ON "scanner_invites" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "scanner_sessions_event_id_idx" ON "scanner_sessions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "scanner_sessions_invite_id_idx" ON "scanner_sessions" USING btree ("invite_id");