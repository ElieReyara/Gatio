CREATE TYPE "public"."event_status" AS ENUM('draft', 'published', 'postponed', 'cancelled', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('concert', 'party', 'sport', 'conference', 'culture', 'other');--> statement-breakpoint
CREATE TYPE "public"."fee_calc_type" AS ENUM('percent_fixed', 'tiered');--> statement-breakpoint
CREATE TYPE "public"."fee_scope" AS ENUM('platform', 'organizer', 'event', 'category');--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"image_key" text,
	"event_type" "event_type" NOT NULL,
	"city" text NOT NULL,
	"venue" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"status_before_suspension" "event_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "events_capacity_positive" CHECK ("events"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "fee_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "fee_scope" NOT NULL,
	"scope_id" uuid,
	"calc_type" "fee_calc_type" NOT NULL,
	"params" jsonb NOT NULL,
	"currency" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_rules_scope_id" CHECK (("fee_rules"."scope" = 'platform') = ("fee_rules"."scope_id" is null))
);
--> statement-breakpoint
CREATE TABLE "ticket_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"quantity_total" integer NOT NULL,
	"quantity_sold" integer DEFAULT 0 NOT NULL,
	"quantity_reserved" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"sale_starts_at" timestamp with time zone,
	"sale_ends_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_categories_stock" CHECK ("ticket_categories"."quantity_sold" >= 0 and "ticket_categories"."quantity_reserved" >= 0 and "ticket_categories"."quantity_sold" + "ticket_categories"."quantity_reserved" <= "ticket_categories"."quantity_total"),
	CONSTRAINT "ticket_categories_price_positive" CHECK ("ticket_categories"."price_amount" > 0),
	CONSTRAINT "ticket_categories_quantity_positive" CHECK ("ticket_categories"."quantity_total" > 0),
	CONSTRAINT "ticket_categories_sale_period" CHECK ("ticket_categories"."sale_starts_at" is null or "ticket_categories"."sale_ends_at" is null or "ticket_categories"."sale_ends_at" > "ticket_categories"."sale_starts_at")
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_categories" ADD CONSTRAINT "ticket_categories_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_status_starts_at_idx" ON "events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "events_city_idx" ON "events" USING btree ("city");--> statement-breakpoint
CREATE INDEX "events_organizer_id_idx" ON "events" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "fee_rules_scope_idx" ON "fee_rules" USING btree ("scope","scope_id");--> statement-breakpoint
CREATE INDEX "ticket_categories_event_id_idx" ON "ticket_categories" USING btree ("event_id");