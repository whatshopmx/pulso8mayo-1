ALTER TABLE "corporate_twins" ADD COLUMN "projected_cash_flow_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD COLUMN "upcoming_obligations_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD COLUMN "liquidity_risk" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD COLUMN "operational_risk" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD COLUMN "compliance_risk" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD COLUMN "people_risk" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD COLUMN "expansion_readiness" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD COLUMN "execution_capacity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD COLUMN "brand_consistency" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD COLUMN "knowledge_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD COLUMN "playbook_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD COLUMN "best_practices_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "corporate_twins" ADD COLUMN "executive_state" jsonb DEFAULT '{}'::jsonb NOT NULL;