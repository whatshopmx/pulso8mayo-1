ALTER TABLE "supplier_items" ADD COLUMN "preference_rank" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_item_primary_unique" ON "supplier_items" USING btree ("company_id","item_id") WHERE "supplier_items"."preference_rank" = 1;--> statement-breakpoint
-- Backfill (loteprod §4): el "Proveedor Preferido" que ya vivía en
-- inventory_items.supplier_id es, de hecho, el proveedor principal. Se le da
-- fila en el catálogo si no la tenía y se marca rango 1, para que el modelo
-- nuevo arranque con la realidad capturada en vez de con todos los insumos
-- sin principal.
INSERT INTO "supplier_items" ("company_id", "supplier_id", "item_id", "preference_rank")
SELECT i."company_id", i."supplier_id", i."id", 1
FROM "inventory_items" i
WHERE i."supplier_id" IS NOT NULL
ON CONFLICT ("supplier_id", "item_id") DO NOTHING;--> statement-breakpoint
UPDATE "supplier_items" si
SET "preference_rank" = 1
FROM "inventory_items" i
WHERE si."item_id" = i."id"
  AND si."supplier_id" = i."supplier_id"
  AND si."preference_rank" IS DISTINCT FROM 1;
