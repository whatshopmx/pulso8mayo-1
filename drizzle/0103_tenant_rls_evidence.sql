-- SEC-04 (Fase 2): RLS piloto sobre el dominio de evidencia.
--
-- Frontera de aislamiento en la BASE, no sólo en el servicio: la política exige
-- que `company_id` coincida con `app.current_company_id`, que la aplicación fija
-- con `set_config(..., is_local => true)` dentro de la transacción del actor
-- (`lib/db/tenant-context.ts`). Sin ajuste, `current_setting(..., true)` es NULL
-- (o cadena vacía cuando una conexión reutilizada ya revirtió un ajuste local)
-- y `NULLIF(..., '')::uuid` deja la comparación en NULL: la fila queda
-- invisible/rechazada. Es decir, rechazo por defecto.
--
-- El rol de MIGRACIÓN (dueño de la tabla) conserva su bypass para DDL y seeds;
-- el rol de RUNTIME debe ser NOBYPassrls y no dueño. `ENABLE` (sin `FORCE`)
-- deja ese reparto explícito; SEC-05 replica el patrón por dominio y en tablas
-- hijas. No se habilita RLS en las 173 tablas de una sola vez.
ALTER TABLE "evidence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Si el rol de runtime ya existe (provisto por operación), se le dan los
-- privilegios mínimos del piloto. El rol NO se crea aquí para no sembrar
-- credenciales en el historial de migraciones.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "evidence" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
CREATE POLICY "evidence_tenant_isolation" ON "evidence"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
