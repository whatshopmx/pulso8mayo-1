ALTER TABLE "production_orders" ADD COLUMN "station" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "shift" "shift_type";--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "responsible_user_id" text;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "deadline_time" time;--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN "completed_by" text;--> statement-breakpoint
CREATE INDEX "production_orders_prep_list_idx" ON "production_orders" USING btree ("company_id","branch_id","planned_date");