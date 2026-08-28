CREATE TABLE IF NOT EXISTS "recipe_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_yield" numeric(10, 2) NOT NULL,
	"unit" text NOT NULL,
	"hold_time_minutes" integer,
	"calculated_cost" integer NOT NULL,
	"price_selling" integer NOT NULL,
	"food_cost_percentage" numeric(5, 2) NOT NULL,
	"items_snapshot" jsonb NOT NULL,
	"change_reason" text,
	"changed_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "exception_approved_by" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "exception_approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "exception_reason" text;--> statement-breakpoint
ALTER TABLE "service_orders" ADD COLUMN IF NOT EXISTS "service_provider_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recipe_versions_recipe_idx" ON "recipe_versions" USING btree ("recipe_id","version_number");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_exception_approved_by_users_id_fk" FOREIGN KEY ("exception_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_service_provider_id_service_providers_id_fk" FOREIGN KEY ("service_provider_id") REFERENCES "public"."service_providers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;