-- BAN-05: Identidad de ingresos esperados (cuenta destino en agregadores y RLS
-- fail-closed en `gateway_transactions` y `aggregator_settlements`).
ALTER TABLE "aggregator_settlements"
	ADD COLUMN IF NOT EXISTS "destination_bank_account_id" uuid REFERENCES "company_bank_accounts"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aggregator_settlements_company_dest_idx"
	ON "aggregator_settlements" ("company_id", "destination_bank_account_id");
--> statement-breakpoint
ALTER TABLE "gateway_transactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "aggregator_settlements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "gateway_transactions" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "aggregator_settlements" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_policies
		WHERE schemaname = 'public' AND tablename = 'gateway_transactions' AND policyname = 'gateway_transactions_tenant_isolation'
	) THEN
		CREATE POLICY "gateway_transactions_tenant_isolation" ON "gateway_transactions"
			USING (
				company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
				AND (
					"gateway_transactions"."destination_bank_account_id" IS NULL
					OR EXISTS (
						SELECT 1 FROM "company_bank_accounts" a
						WHERE a.id = "gateway_transactions"."destination_bank_account_id"
						  AND a.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
					)
				)
			)
			WITH CHECK (
				company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
				AND (
					"gateway_transactions"."destination_bank_account_id" IS NULL
					OR EXISTS (
						SELECT 1 FROM "company_bank_accounts" a
						WHERE a.id = "gateway_transactions"."destination_bank_account_id"
						  AND a.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
					)
				)
			);
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_policies
		WHERE schemaname = 'public' AND tablename = 'aggregator_settlements' AND policyname = 'aggregator_settlements_tenant_isolation'
	) THEN
		CREATE POLICY "aggregator_settlements_tenant_isolation" ON "aggregator_settlements"
			USING (
				company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
				AND (
					"aggregator_settlements"."destination_bank_account_id" IS NULL
					OR EXISTS (
						SELECT 1 FROM "company_bank_accounts" a
						WHERE a.id = "aggregator_settlements"."destination_bank_account_id"
						  AND a.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
					)
				)
			)
			WITH CHECK (
				company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
				AND (
					"aggregator_settlements"."destination_bank_account_id" IS NULL
					OR EXISTS (
						SELECT 1 FROM "company_bank_accounts" a
						WHERE a.id = "aggregator_settlements"."destination_bank_account_id"
						  AND a.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
					)
				)
			);
	END IF;
END $$;
