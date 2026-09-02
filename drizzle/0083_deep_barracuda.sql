-- A2.1 · Congelar la cuenta bancaria en la partida de la corrida de pago.
--
-- Sin este snapshot, un proveedor que cambia de CLABE entre la aprobación de la
-- corrida y la dispersión cobra en la cuenta nueva sin que nadie la vuelva a
-- firmar: el layout resuelve la cuenta al momento de generarse, así que la
-- firma de la corrida no dice nada sobre a dónde va el dinero. Es exactamente
-- el fraude que la máquina de verificación de `supplier_bank_accounts` existe
-- para impedir.
--
-- Las dos columnas son NULLABLE y sin backfill a propósito: las corridas en
-- DRAFT ya creadas siguen funcionando, y el generador cae a la cuenta
-- verificada vigente cuando el snapshot no existe, declarándolo en la respuesta.
--
-- NOTA DE DERIVA: `drizzle-kit generate` incluyó aquí también
-- `invoices.recurring_contract_id` y su llave foránea. **Esa columna y esa
-- restricción ya existen en la base** —se aplicaron a mano y nunca entraron al
-- journal— así que sus sentencias se quitaron: dejarlas haría fallar la
-- migración entera con "column already exists". El snapshot 0083 sí las
-- registra, que es lo correcto: describen el estado real de la base.
-- Ver `scripts/check-migration-drift.ts` y la nota de CLAUDE.md sobre migraciones
-- commiteadas que no implican migraciones aplicadas.
ALTER TABLE "payment_run_items" ADD COLUMN "bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD COLUMN "clabe_last4_snapshot" text;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD CONSTRAINT "payment_run_items_bank_account_id_supplier_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."supplier_bank_accounts"("id") ON DELETE no action ON UPDATE no action;
