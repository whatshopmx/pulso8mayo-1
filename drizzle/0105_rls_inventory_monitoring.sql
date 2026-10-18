-- SEC-05.inventario-monitoreo (Fase 2): RLS por lote sobre las salidas de
-- monitoreo de inventario.
--
-- Lote pequeño y de bajo radio: `inventory_snapshots` (cierre calculado vs
-- contado) y `inventory_expiration_alerts` (anti-spam de vencimientos) tienen
-- `company_id` directo y un único servicio dueño cada una. Igual que los lotes
-- anteriores, rechazo por defecto con
-- `NULLIF(current_setting('app.current_company_id', true), '')::uuid`.
--
-- Excepciones / límites declarados (aceptación 3):
-- - `inventory_items`, `inventory_batches` y `inventory_movements` NO entran en
--   este lote: son tablas centrales tocadas por decenas de servicios y exigen su
--   propia subtarea con el wiring del servicio de inventario; no se declara
--   cobertura universal.
-- - El cron de vencimientos recorre EMPRESAS: escribe con el `companyId` de cada
--   lote (alcance explícito), no con un rol privilegiado.
ALTER TABLE "inventory_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_expiration_alerts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
		GRANT USAGE ON SCHEMA "public" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_snapshots" TO "pulso_app";
		GRANT SELECT, INSERT, UPDATE, DELETE ON "inventory_expiration_alerts" TO "pulso_app";
	END IF;
END $$;
--> statement-breakpoint
CREATE POLICY "inventory_snapshots_tenant_isolation" ON "inventory_snapshots"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "inventory_expiration_alerts_tenant_isolation" ON "inventory_expiration_alerts"
	USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
