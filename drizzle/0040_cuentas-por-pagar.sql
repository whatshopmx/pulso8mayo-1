CREATE TYPE "public"."invoice_payment_status" AS ENUM('PENDING', 'PAID', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_status" "invoice_payment_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_at" timestamp;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_by" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_notes" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "payment_terms_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Backfill del vencimiento de las facturas ya capturadas.
--
-- `invoices.fecha` es `text` con la fecha del CFDI (ISO). El vencimiento es esa
-- fecha más los días de crédito del proveedor, que arrancan en 0 (contado)
-- hasta que se capturen los términos reales de cada proveedor.
--
-- Las facturas sin proveedor asociado (`supplier_id IS NULL`) también reciben
-- vencimiento: se deben igual, y dejarlas en NULL las escondería de la vista
-- de cuentas por pagar, que es justo donde alguien las descubriría.
--
-- El CAST va protegido: `fecha` es texto libre y una fila con formato inválido
-- no debe abortar la migración completa. Esas quedan en NULL y la UI las
-- muestra como "sin vencimiento" para captura manual.
UPDATE "invoices" i
SET "due_date" = (
    substring(i."fecha" from 1 for 10)::date
    + COALESCE(s."payment_terms_days", 0)
)
FROM "suppliers" s
WHERE i."supplier_id" = s."id"
  AND i."due_date" IS NULL
  AND substring(i."fecha" from 1 for 10) ~ '^\d{4}-\d{2}-\d{2}$';--> statement-breakpoint
UPDATE "invoices" i
SET "due_date" = substring(i."fecha" from 1 for 10)::date
WHERE i."supplier_id" IS NULL
  AND i."due_date" IS NULL
  AND substring(i."fecha" from 1 for 10) ~ '^\d{4}-\d{2}-\d{2}$';
