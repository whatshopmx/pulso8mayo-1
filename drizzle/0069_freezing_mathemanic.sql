ALTER TYPE "public"."inventory_waste_reason" ADD VALUE 'HOLD_TIME';--> statement-breakpoint
ALTER TYPE "public"."inventory_waste_reason" ADD VALUE 'PREPARATION';--> statement-breakpoint
ALTER TYPE "public"."inventory_waste_reason" ADD VALUE 'CUSTOMER_RETURN';--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD COLUMN "recipe_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD COLUMN "processed_quantity" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD COLUMN "expected_quantity" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD COLUMN "yield_flagged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "production_results" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "hold_time_minutes" integer;--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD CONSTRAINT "inventory_waste_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;