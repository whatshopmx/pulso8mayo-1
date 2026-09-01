-- V1.1 — Ligar la factura a SU contrato recurrente, no al proveedor.
--
-- Hasta aquí la única llave entre una factura y un contrato era `supplier_id`,
-- y un proveedor puede tener varios contratos: un arrendador que además cobra
-- el mantenimiento, o CFE con dos medidores. La detección de sobrecosto cruzaba
-- cada factura contra TODOS los contratos del proveedor, así que toda factura
-- disparaba excepción contra el de base menor.
--
-- Nullable a propósito: las facturas ya capturadas no tienen con qué llenarla,
-- y no se infiere en la migración. Cuando falta, la detección resuelve por
-- (proveedor, sucursal) y sólo compara si el candidato es único — una factura
-- sin contrato claro no produce hallazgo, que es preferible a producir el falso.
--
-- ON DELETE SET NULL: borrar un contrato no debe borrar la factura, que es un
-- CFDI y existe con independencia del contrato al que lo hayamos ligado.
ALTER TABLE "invoices" ADD COLUMN "recurring_contract_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurring_contract_id_recurring_contracts_id_fk"
  FOREIGN KEY ("recurring_contract_id") REFERENCES "public"."recurring_contracts"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
-- La detección recorre las facturas de un contrato dentro de una ventana; sin
-- índice esa consulta es un seq scan sobre toda la tabla de CFDI del tenant.
CREATE INDEX IF NOT EXISTS "idx_invoices_recurring_contract" ON "invoices" ("recurring_contract_id");
