-- 0055_idempotencia-extractores.sql
-- A9 (tasks/plan-auditoria-conteo-produccion-merma.md), cierra AD-4 del plan
-- original: la idempotencia de los extractores deja de ser un
-- `SELECT ... WHERE notes LIKE '%instance:{id}%'` seguido de un INSERT y pasa a
-- ser columna + indice unico parcial, como ya lo tenia `stock_counts`.
--
-- El check-then-insert no era atomico: dos ejecuciones simultaneas del mismo
-- extractor leian las dos "no existe" y escribian las dos. En produccion eso
-- descontaba el lote por duplicado (demostrado en
-- `tests/extractor-idempotente.spec.ts`: 94 esperado, 88 real).
--
-- `inventory_waste.origin` es lo que distingue las mermas que conviven en una
-- misma instancia: `workflow_merma` (captura del operador), `diferencia_conteo`
-- (varianza del conteo) y `lote_insuficiente` (faltante de produccion).
-- `lote_insuficiente` queda FUERA del unico a proposito: una instancia con dos
-- recetas cortas del mismo insumo escribe dos filas legitimas, y su
-- idempotencia ya la da el unico de `production_results`.
--
-- Las dos columnas son nullables y los indices son parciales: las filas
-- existentes (todas con NULL) y la captura manual por API quedan fuera y
-- siguen siendo validas. Nada que rellenar.
--
-- Reversible:
--   DROP INDEX "inventory_waste_instance_item_origin_unique";
--   DROP INDEX "production_results_instance_recipe_unique";
--   ALTER TABLE "inventory_waste" DROP COLUMN "workflow_instance_id", DROP COLUMN "origin";
--   ALTER TABLE "production_results" DROP COLUMN "workflow_instance_id";
--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD COLUMN "workflow_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_waste" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "production_results" ADD COLUMN "workflow_instance_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_waste_instance_item_origin_unique" ON "inventory_waste" USING btree ("workflow_instance_id","item_id","origin") WHERE "inventory_waste"."workflow_instance_id" IS NOT NULL AND "inventory_waste"."origin" <> 'lote_insuficiente';--> statement-breakpoint
CREATE UNIQUE INDEX "production_results_instance_recipe_unique" ON "production_results" USING btree ("workflow_instance_id","recipe_id") WHERE "production_results"."workflow_instance_id" IS NOT NULL;
