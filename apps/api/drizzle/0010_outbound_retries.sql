ALTER TABLE "outbound_messages" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "outbound_messages_queued_idx" ON "outbound_messages" USING btree ("next_attempt_at") WHERE "outbound_messages"."status" = 'queued';