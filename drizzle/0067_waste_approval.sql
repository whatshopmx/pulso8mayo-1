-- Task 3 (plan-loteprod-gaps §8.1): aprobación y tope de mermas STAFF/COURTESY.
-- Registros previos quedan AUTO (sin flujo de aprobación), igual que las mermas
-- operativas (EXPIRED/DAMAGED/...).
ALTER TABLE "inventory_waste" ADD COLUMN "approval_status" text DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
CREATE INDEX "inventory_waste_approval_status_idx" ON "inventory_waste" USING btree ("approval_status");--> statement-breakpoint
-- Tope mensual configurable por empresa (centavos). Null = sin tope.
ALTER TABLE "companies" ADD COLUMN "courtesy_waste_monthly_cap_cents" integer;
