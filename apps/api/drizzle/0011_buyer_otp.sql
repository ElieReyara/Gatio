CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_codes_attempts" CHECK ("otp_codes"."attempts" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "phone_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "otp_codes_phone_created_idx" ON "otp_codes" USING btree ("phone_e164","created_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_buyer_id_idx" ON "auth_sessions" USING btree ("buyer_id");