-- 0051_merma-decimal-quantities.sql
-- T1 (tasks/plan-inventory-waste.md): `inventory_waste.quantity`,
-- `inventory_movements.quantity_change` e `inventory_batches.{initial,current}_quantity`
-- pasan de `integer` a `numeric(12,4)` — misma convención que `stock_counts`
-- (AD-6). Sin esto, una merma de 0.4 kg guarda 0, y la baja del lote
-- (`current_quantity - quantity`) redondea el stock restante a entero:
-- corrupción silenciosa peor que el bug que se corrige.
--
-- Reversible en papel (no hay forma fiel de volver de fracciones a enteros):
--   ALTER TABLE "inventory_batches"  ALTER COLUMN "initial_quantity" TYPE integer USING round("initial_quantity");
--   ALTER TABLE "inventory_batches"  ALTER COLUMN "current_quantity"  TYPE integer USING round("current_quantity");
--   ALTER TABLE "inventory_movements" ALTER COLUMN "quantity_change"  TYPE integer USING round("quantity_change");
--   ALTER TABLE "inventory_waste"    ALTER COLUMN "quantity"          TYPE integer USING round("quantity");
--> statement-breakpoint
ALTER TABLE "inventory_batches" ALTER COLUMN "initial_quantity" SET DATA TYPE numeric(12, 4) USING "initial_quantity"::numeric;--> statement-breakpoint
ALTER TABLE "inventory_batches" ALTER COLUMN "current_quantity" SET DATA TYPE numeric(12, 4) USING "current_quantity"::numeric;--> statement-breakpoint
ALTER TABLE "inventory_movements" ALTER COLUMN "quantity_change" SET DATA TYPE numeric(12, 4) USING "quantity_change"::numeric;--> statement-breakpoint
ALTER TABLE "inventory_waste" ALTER COLUMN "quantity" SET DATA TYPE numeric(12, 4) USING "quantity"::numeric;
