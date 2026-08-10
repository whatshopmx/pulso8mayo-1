ALTER TYPE "public"."inventory_waste_reason" ADD VALUE 'COURTESY';--> statement-breakpoint
ALTER TABLE "tenant_operating_config" ADD COLUMN "merma_variance_threshold_pct" numeric(5, 2) DEFAULT '5.00';