ALTER TABLE "inventory_waste" ALTER COLUMN "item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD COLUMN "production_result_id" uuid;--> statement-breakpoint
ALTER TABLE "production_results" ADD COLUMN "hold_alert_notified_at" timestamp;--> statement-breakpoint
ALTER TABLE "production_results" ADD COLUMN "discarded_at" timestamp;--> statement-breakpoint
ALTER TABLE "production_results" ADD COLUMN "discarded_quantity" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "production_results" ADD COLUMN "discarded_by" text;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_waste_production_result_unique" ON "inventory_waste" USING btree ("production_result_id") WHERE "inventory_waste"."production_result_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "production_results_hold_pending_idx" ON "production_results" USING btree ("expires_at") WHERE "production_results"."expires_at" IS NOT NULL AND "production_results"."discarded_at" IS NULL;