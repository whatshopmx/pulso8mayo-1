-- NOM-05: Obligaciones netas de nómina aprobada por empleado/período y
-- asignaciones de pago parcial/total independientes del estado CFDI.
CREATE TABLE IF NOT EXISTS "payroll_treasury_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id"),
	"payroll_run_id" uuid NOT NULL REFERENCES "payroll_runs"("id"),
	"payslip_id" uuid REFERENCES "payroll_payslips"("id"),
	"user_id" text NOT NULL REFERENCES "users"("id"),
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"snapshot_version" integer NOT NULL,
	"net_amount_cents" integer NOT NULL,
	"paid_amount_cents" integer DEFAULT 0 NOT NULL,
	"remaining_amount_cents" integer NOT NULL,
	"payment_status" text DEFAULT 'OPEN' NOT NULL,
	"created_by" text REFERENCES "users"("id"),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_treasury_obligations_amounts_check" CHECK ("net_amount_cents" >= 0 AND "paid_amount_cents" >= 0 AND "remaining_amount_cents" >= 0 AND "paid_amount_cents" + "remaining_amount_cents" = "net_amount_cents"),
	CONSTRAINT "payroll_treasury_obligations_status_check" CHECK ("payment_status" IN ('OPEN', 'PARTIALLY_PAID', 'PAID'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_treasury_obligations_company_user_period_unique"
	ON "payroll_treasury_obligations" ("company_id", "user_id", "period_start", "period_end");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_treasury_obligations_company_run_idx"
	ON "payroll_treasury_obligations" ("company_id", "payroll_run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_treasury_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id"),
	"obligation_id" uuid NOT NULL REFERENCES "payroll_treasury_obligations"("id") ON DELETE CASCADE,
	"payment_run_item_id" uuid NOT NULL REFERENCES "payment_run_items"("id"),
	"amount_cents" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by" text REFERENCES "users"("id"),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_treasury_allocations_amount_positive_check" CHECK ("amount_cents" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_treasury_allocations_company_idem_unique"
	ON "payroll_treasury_allocations" ("company_id", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_treasury_allocations_obligation_item_unique"
	ON "payroll_treasury_allocations" ("obligation_id", "payment_run_item_id");
--> statement-breakpoint
ALTER TABLE "payroll_treasury_obligations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payroll_treasury_allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_treasury_obligations" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_treasury_allocations" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
CREATE POLICY "payroll_treasury_obligations_tenant_isolation" ON "payroll_treasury_obligations"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "payroll_treasury_allocations_tenant_isolation" ON "payroll_treasury_allocations"
	USING (
		company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		AND EXISTS (
			SELECT 1 FROM "payroll_treasury_obligations" o
			WHERE o.id = "payroll_treasury_allocations"."obligation_id"
			  AND o.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		)
	)
	WITH CHECK (
		company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		AND EXISTS (
			SELECT 1 FROM "payroll_treasury_obligations" o
			WHERE o.id = "payroll_treasury_allocations"."obligation_id"
			  AND o.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		)
	);
