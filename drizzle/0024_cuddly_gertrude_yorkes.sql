ALTER TABLE "tenant_operating_config" ALTER COLUMN "manager_auth_limit_cents" SET DEFAULT 100000;--> statement-breakpoint
ALTER TABLE "tenant_operating_config" ALTER COLUMN "double_approval_threshold_cents" SET DEFAULT 1000000;--> statement-breakpoint
ALTER TABLE "tenant_operating_config" ALTER COLUMN "petty_cash_limit_cents" SET DEFAULT 500000;