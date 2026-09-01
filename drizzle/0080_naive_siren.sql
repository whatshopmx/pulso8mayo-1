CREATE TABLE "channel_commission_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"effective_from" date NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_sales_cuts" ADD COLUMN "commission_cents" integer;--> statement-breakpoint
ALTER TABLE "daily_sales_cuts" ADD COLUMN "tpv_deposit_cents" integer;--> statement-breakpoint
ALTER TABLE "pnl_snapshots" ADD COLUMN "commission_cents" integer;--> statement-breakpoint
ALTER TABLE "channel_commission_rates" ADD CONSTRAINT "channel_commission_rates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_commission_rates" ADD CONSTRAINT "channel_commission_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_commission_rate_unique" ON "channel_commission_rates" USING btree ("company_id","channel","effective_from");