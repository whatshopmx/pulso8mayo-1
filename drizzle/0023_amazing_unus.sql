CREATE TYPE "public"."food_production" AS ENUM('IN_SITU', 'COCINA_CENTRAL', 'MIXTO');--> statement-breakpoint
CREATE TYPE "public"."manager_autonomy" AS ENUM('ALTA', 'MEDIA', 'BAJA');--> statement-breakpoint
CREATE TYPE "public"."payroll_dispersion" AS ENUM('CONSOLIDADA', 'POR_RAZON_SOCIAL', 'MIXTO');--> statement-breakpoint
CREATE TYPE "public"."purchasing_structure" AS ENUM('CENTRALIZADA', 'POR_SUCURSAL', 'HIBRIDO');--> statement-breakpoint
CREATE TYPE "public"."supplier_payment_model" AS ENUM('CENTRALIZADO', 'POR_SUCURSAL', 'HIBRIDO');--> statement-breakpoint
CREATE TYPE "public"."tenant_type" AS ENUM('GRUPO_PROPIO', 'MIXTO_FRANQUICIAS');--> statement-breakpoint
CREATE TYPE "public"."treasury_model" AS ENUM('CUENTA_UNICA', 'CUENTA_POR_SUCURSAL', 'MIXTO');--> statement-breakpoint
CREATE TABLE "tenant_operating_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"purchasing_structure" "purchasing_structure" DEFAULT 'CENTRALIZADA' NOT NULL,
	"food_production" "food_production" DEFAULT 'IN_SITU' NOT NULL,
	"treasury_model" "treasury_model" DEFAULT 'CUENTA_UNICA' NOT NULL,
	"supplier_payment" "supplier_payment_model" DEFAULT 'CENTRALIZADO' NOT NULL,
	"manager_autonomy" "manager_autonomy" DEFAULT 'MEDIA' NOT NULL,
	"payroll_dispersion" "payroll_dispersion" DEFAULT 'CONSOLIDADA' NOT NULL,
	"tenant_type" "tenant_type" DEFAULT 'GRUPO_PROPIO' NOT NULL,
	"manager_auth_limit_cents" integer,
	"double_approval_threshold_cents" integer,
	"petty_cash_limit_cents" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_operating_config" ADD CONSTRAINT "tenant_operating_config_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_operating_config_company_unique" ON "tenant_operating_config" USING btree ("company_id");