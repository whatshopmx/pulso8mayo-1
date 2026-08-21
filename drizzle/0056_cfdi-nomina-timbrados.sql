CREATE TYPE "public"."cfdi_timbrado_status" AS ENUM('TIMBRADO', 'PENDIENTE', 'RECHAZADO', 'ERROR');--> statement-breakpoint
CREATE TABLE "cfdi_nomina_timbrados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"empleado_rfc" text NOT NULL,
	"empleado_nombre" text NOT NULL,
	"periodo" text NOT NULL,
	"uuid" text,
	"status" "cfdi_timbrado_status" NOT NULL,
	"cadena_original" text,
	"sello_digital" text,
	"total_percepciones_cents" integer NOT NULL,
	"total_deducciones_cents" integer NOT NULL,
	"raw_response" jsonb,
	"timbrado_por" text,
	"fecha_timbrado" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "petty_cash_funds" ALTER COLUMN "fund_amount" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "petty_cash_funds" ALTER COLUMN "current_balance" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "petty_cash_funds" ALTER COLUMN "low_threshold" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "cfdi_nomina_timbrados" ADD CONSTRAINT "cfdi_nomina_timbrados_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cfdi_nomina_timbrados" ADD CONSTRAINT "cfdi_nomina_timbrados_timbrado_por_users_id_fk" FOREIGN KEY ("timbrado_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cfdi_nomina_timbrados_company_rfc_periodo_unique" ON "cfdi_nomina_timbrados" USING btree ("company_id","empleado_rfc","periodo");--> statement-breakpoint
CREATE INDEX "cfdi_nomina_timbrados_company_idx" ON "cfdi_nomina_timbrados" USING btree ("company_id");