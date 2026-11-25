-- SEC-05.tesoreria: lote aditivo de RLS y privilegios mínimos para tesorería y banca.
--
-- Inventario de 8 tablas bancarias y de pagos:
-- - Con `company_id` directo: `company_bank_accounts`, `supplier_bank_accounts`,
--   `payee_bank_accounts`, `payment_runs`, `recurring_contracts`.
-- - Con `company_id` + referencia padre verificada: `bank_transactions`
--   (`source_bank_account_id` opcional perteneciente a la misma empresa) y
--   `recurring_payables` (`contract_id` perteneciente a la misma empresa).
-- - Hija sin `company_id`: `payment_run_items` (acotada vía su corrida padre
--   `payment_runs`).
--
-- Rechazo por defecto (fail-closed):
-- `NULLIF(current_setting('app.current_company_id', true), '')::uuid`.
--
-- Límites declarados:
-- - El rol dueño/migración conserva bypass; el runtime debe ser NOBYPASSRLS.
--   No se usa FORCE ROW LEVEL SECURITY para no romper rutas del dueño.
-- - No crea roles ni credenciales: solo otorga privilegios si `pulso_app` existe.
-- - No se aplica al entorno operativo en este ticket (OPS-03).
ALTER TABLE "company_bank_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "supplier_bank_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payee_bank_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bank_transactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_run_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recurring_contracts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recurring_payables" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "company_bank_accounts" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_bank_accounts" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payee_bank_accounts" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_transactions" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_runs" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_run_items" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "recurring_contracts" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "recurring_payables" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
CREATE POLICY "company_bank_accounts_tenant_isolation" ON "company_bank_accounts"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "supplier_bank_accounts_tenant_isolation" ON "supplier_bank_accounts"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "payee_bank_accounts_tenant_isolation" ON "payee_bank_accounts"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "bank_transactions_tenant_isolation" ON "bank_transactions"
	USING (
		company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		AND (
			"bank_transactions"."source_bank_account_id" IS NULL
			OR EXISTS (
				SELECT 1 FROM "company_bank_accounts" a
				WHERE a.id = "bank_transactions"."source_bank_account_id"
				  AND a.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
			)
		)
	)
	WITH CHECK (
		company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		AND (
			"bank_transactions"."source_bank_account_id" IS NULL
			OR EXISTS (
				SELECT 1 FROM "company_bank_accounts" a
				WHERE a.id = "bank_transactions"."source_bank_account_id"
				  AND a.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
			)
		)
	);
--> statement-breakpoint
CREATE POLICY "payment_runs_tenant_isolation" ON "payment_runs"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "payment_run_items_tenant_isolation" ON "payment_run_items"
	USING (EXISTS (
		SELECT 1 FROM "payment_runs" r
		WHERE r.id = "payment_run_items"."payment_run_id"
		  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
	))
	WITH CHECK (EXISTS (
		SELECT 1 FROM "payment_runs" r
		WHERE r.id = "payment_run_items"."payment_run_id"
		  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
	));
--> statement-breakpoint
CREATE POLICY "recurring_contracts_tenant_isolation" ON "recurring_contracts"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "recurring_payables_tenant_isolation" ON "recurring_payables"
	USING (
		company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		AND EXISTS (
			SELECT 1 FROM "recurring_contracts" c
			WHERE c.id = "recurring_payables"."contract_id"
			  AND c.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		)
	)
	WITH CHECK (
		company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		AND EXISTS (
			SELECT 1 FROM "recurring_contracts" c
			WHERE c.id = "recurring_payables"."contract_id"
			  AND c.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		)
	);
