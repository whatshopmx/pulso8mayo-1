CREATE TABLE "sales_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"quantity_sold" numeric(10, 2) NOT NULL,
	"sale_date" timestamp DEFAULT now() NOT NULL,
	"total_revenue" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
