ALTER TABLE "inventory_waste" ADD COLUMN "approval_status" text DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "courtesy_waste_monthly_cap_cents" integer;--> statement-breakpoint
-- Índice de la Task 3 (plan-loteprod-gaps §8.1): vivía en la 0067 manual que
-- esta migración sustituye. IF NOT EXISTS por si algún entorno ya lo tiene.
CREATE INDEX IF NOT EXISTS "inventory_waste_approval_status_idx" ON "inventory_waste" USING btree ("approval_status");
