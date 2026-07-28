ALTER TABLE "inventory_items" ADD COLUMN "tax_rate" integer DEFAULT 16 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "ieps_rate" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "tax_rate" integer DEFAULT 16 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "tax_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "ieps_rate" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD COLUMN "ieps_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "ieps_amount" integer DEFAULT 0 NOT NULL;