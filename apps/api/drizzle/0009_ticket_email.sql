CREATE TABLE "email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verifications_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"purpose" text NOT NULL,
	"recipient" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_ref" text,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_messages_channel" CHECK ("outbound_messages"."channel" in ('sms', 'email')),
	CONSTRAINT "outbound_messages_purpose" CHECK ("outbound_messages"."purpose" in ('otp', 'ticket', 'email_verification', 'password_reset')),
	CONSTRAINT "outbound_messages_status" CHECK ("outbound_messages"."status" in ('queued', 'sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "email_access_token_hash" text;--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_verifications_buyer_id_idx" ON "email_verifications" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "outbound_messages_order_id_idx" ON "outbound_messages" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "outbound_messages_created_at_idx" ON "outbound_messages" USING btree ("created_at");