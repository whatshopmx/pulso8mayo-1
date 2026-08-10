CREATE TABLE "inventory_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"calculated_stock" numeric(12, 4) NOT NULL,
	"counted_stock" numeric(12, 4),
	"variance" numeric(12, 4) GENERATED ALWAYS AS ((counted_stock - calculated_stock)) STORED,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_snapshots_unique" ON "inventory_snapshots" USING btree ("company_id","branch_id","item_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "inventory_snapshots_branch_date_idx" ON "inventory_snapshots" USING btree ("branch_id","snapshot_date" DESC NULLS LAST);