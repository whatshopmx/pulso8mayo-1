-- OPS-02.nomina.E: lote aditivo de RLS para nómina ordinaria, aguinaldo y CFDI.
--
-- Cuatro tablas, tres formas de frontera:
-- - `payroll_runs` y `cfdi_nomina_timbrados` tienen `company_id` directo.
-- - `payroll_payslips` no tiene `company_id`: se acota por su corrida padre.
-- - `payroll_aguinaldo_dispersiones` tiene `company_id` y un `run_id` opcional;
--   cuando hay corrida, la empresa declarada debe coincidir con la del padre.
--
-- Mismo rechazo por defecto que los lotes SEC-04/SEC-05:
-- `NULLIF(current_setting('app.current_company_id', true), '')::uuid`.
--
-- Límites declarados:
-- - El rol dueño/migración conserva su bypass; el runtime debe ser NOBYPASSRLS.
--   No se usa FORCE ROW LEVEL SECURITY para no romper las rutas del dueño.
-- - No crea roles ni credenciales: sólo otorga privilegios si `pulso_app` ya
--   existe (lo aprovisiona el entorno, no este SQL).
-- - No incluye otras tablas de nómina/tesorería ni se aplica al operativo;
--   OPS-03 conserva la activación.
ALTER TABLE "payroll_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payroll_payslips" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payroll_aguinaldo_dispersiones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cfdi_nomina_timbrados" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_runs" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_payslips" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_aguinaldo_dispersiones" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "cfdi_nomina_timbrados" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
CREATE POLICY "payroll_runs_tenant_isolation" ON "payroll_runs"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- La línea hija no tiene `company_id`: se aísla vía su corrida padre. La
-- subconsulta queda filtrada además por la política de `payroll_runs`, de modo
-- que un cambio de `run_id` hacia una corrida ajena también se rechaza.
CREATE POLICY "payroll_payslips_tenant_isolation" ON "payroll_payslips"
	USING (EXISTS (
		SELECT 1 FROM "payroll_runs" r
		WHERE r.id = "payroll_payslips"."run_id"
		  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
	))
	WITH CHECK (EXISTS (
		SELECT 1 FROM "payroll_runs" r
		WHERE r.id = "payroll_payslips"."run_id"
		  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
	));
--> statement-breakpoint
-- Bitácora de dispersión: la empresa declarada manda, pero si la fila referencia
-- una corrida, esa corrida debe pertenecer a la misma empresa del contexto. Así
-- no se puede registrar una dispersión de A colgada de una corrida de B.
CREATE POLICY "payroll_aguinaldo_dispersiones_tenant_isolation" ON "payroll_aguinaldo_dispersiones"
	USING (
		company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		AND (
			"payroll_aguinaldo_dispersiones"."run_id" IS NULL
			OR EXISTS (
				SELECT 1 FROM "payroll_runs" r
				WHERE r.id = "payroll_aguinaldo_dispersiones"."run_id"
				  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
			)
		)
	)
	WITH CHECK (
		company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
		AND (
			"payroll_aguinaldo_dispersiones"."run_id" IS NULL
			OR EXISTS (
				SELECT 1 FROM "payroll_runs" r
				WHERE r.id = "payroll_aguinaldo_dispersiones"."run_id"
				  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
			)
		)
	);
--> statement-breakpoint
CREATE POLICY "cfdi_nomina_timbrados_tenant_isolation" ON "cfdi_nomina_timbrados"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
