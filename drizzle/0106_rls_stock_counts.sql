-- SEC-05.inventario-conteos (Fase 2): RLS por lote sobre los conteos físicos.
--
-- `stock_counts` tiene `company_id` directo y un único escritor
-- (`stock-count-from-workflow`) más dos lectores (`inventory-reports-service`,
-- `inventory-snapshot-service`). Rechazo por defecto con
-- `NULLIF(current_setting('app.current_company_id', true), '')::uuid`.
--
-- Excepciones / límites declarados (aceptación 3):
-- - `inventory_items`, `inventory_batches` y `inventory_movements` NO entran en
--   este lote (38 y 18 archivos las tocan; requieren su propia subtarea con el
--   wiring de todos sus productores). No se declara cobertura universal.
-- - `inventory_periods` tampoco: se aborda en su propia subtarea.
-- - El rol dueño/migración conserva su bypass; el runtime debe ser NOBYPASSRLS.
ALTER TABLE "stock_counts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_counts" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
CREATE POLICY "stock_counts_tenant_isolation" ON "stock_counts"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
