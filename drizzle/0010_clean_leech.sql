CREATE TABLE "recipe_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(10, 4) NOT NULL,
	"unit" text NOT NULL,
	"is_sub_recipe" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_yield" numeric(10, 2) DEFAULT '1.00' NOT NULL,
	"unit" text DEFAULT 'PORTION' NOT NULL,
	"calculated_cost" integer DEFAULT 0 NOT NULL,
	"price_selling" integer DEFAULT 0 NOT NULL,
	"food_cost_percentage" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
