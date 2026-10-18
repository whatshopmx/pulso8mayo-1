-- SEC-05.recepcion (Fase 2): RLS por lote sobre el dominio de recepción.
--
-- Primer lote de SEC-05 tras el piloto `evidence` (SEC-04). Cubre una tabla raíz
-- con `company_id` (`receiving_reports`) y su tabla hija SIN `company_id`
-- (`receiving_report_items`), que se acota por el reporte padre. Mismo patrón de
-- rechazo por defecto: `NULLIF(current_setting('app.current_company_id', true), '')::uuid`.
--
-- Excepciones / límites declarados (aceptación 3):
-- - `inventory_batches`, `inventory_movements`, `inventory_*` y demás tablas del
--   dominio inventario NO se incluyen en este lote: quedan fuera y se migrarán
--   en sus propias subtareas SEC-05.*; no se declara cobertura universal.
-- - El rol dueño/migración conserva su bypass; el runtime debe ser NOBYPASSRLS.
ALTER TABLE "receiving_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "receiving_report_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "receiving_reports" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "receiving_report_items" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
CREATE POLICY "receiving_reports_tenant_isolation" ON "receiving_reports"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- La línea hija no tiene `company_id`: se aísla vía su reporte padre. La
-- subconsulta también queda filtrada por la política de `receiving_reports`.
CREATE POLICY "receiving_report_items_tenant_isolation" ON "receiving_report_items"
	USING (EXISTS (
		SELECT 1 FROM "receiving_reports" r
		WHERE r.id = "receiving_report_items"."receiving_report_id"
		  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
	))
	WITH CHECK (EXISTS (
		SELECT 1 FROM "receiving_reports" r
		WHERE r.id = "receiving_report_items"."receiving_report_id"
		  AND r.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
	));
