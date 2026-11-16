-- EXC-01.rls: aislamiento reproducible de la persistencia canónica de excepciones.
--
-- `exceptions` tiene `company_id` directo; se acota con el mismo contrato que
-- los lotes SEC-04/SEC-05 y 0123:
-- `NULLIF(current_setting('app.current_company_id', true), '')::uuid`.
--
-- Límites declarados:
-- - El rol dueño/migración conserva su bypass; el runtime debe ser NOBYPASSRLS.
--   No se usa FORCE ROW LEVEL SECURITY para no romper las rutas del dueño.
-- - No crea roles ni credenciales: sólo otorga privilegios si `pulso_app` ya
--   existe (lo aprovisiona el entorno, no este SQL).
-- - No incluye otras tablas del frente de excepciones ni se aplica al operativo;
--   OPS-03 conserva la activación.
ALTER TABLE "exceptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "exceptions" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
-- Idempotente a propósito: las pruebas de integración aplican este mismo archivo
-- sobre un esquema privado y sobre la base aislada ya migrada.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_policies
		WHERE schemaname = current_schema()
		  AND tablename = 'exceptions'
		  AND policyname = 'exceptions_tenant_isolation'
	) THEN
		CREATE POLICY "exceptions_tenant_isolation" ON "exceptions"
			USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
			WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
	END IF;
END $$;
