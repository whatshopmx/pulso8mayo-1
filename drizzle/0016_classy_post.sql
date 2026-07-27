ALTER TABLE "inventory_items" ADD COLUMN "yield_percent" integer DEFAULT 100;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD COLUMN "yield_percent" integer DEFAULT 100;