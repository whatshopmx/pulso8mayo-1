CREATE TYPE "public"."imss_file_status" AS ENUM('GENERADO', 'ENVIADO', 'ACEPTADO', 'RECHAZADO');--> statement-breakpoint
CREATE TYPE "public"."imss_movement_status" AS ENUM('PENDIENTE', 'EN_ARCHIVO', 'CONFIRMADO', 'RECHAZADO');--> statement-breakpoint
CREATE TYPE "public"."imss_movement_type" AS ENUM('ALTA', 'BAJA', 'MOD_SALARIO');--> statement-breakpoint
CREATE TABLE "imss_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"layout" text NOT NULL,
	"layout_version" text NOT NULL,
	"movement_type" "imss_movement_type",
	"fecha_movimiento" date NOT NULL,
	"file_name" text NOT NULL,
	"content_sha256" text NOT NULL,
	"line_count" integer NOT NULL,
	"status" "imss_file_status" DEFAULT 'GENERADO' NOT NULL,
	"acuse_folio" text,
	"acuse_received_at" timestamp with time zone,
	"rejection_reason" text,
	"storage_key" text,
	"content_unavailable" boolean DEFAULT false NOT NULL,
	"generated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imss_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"file_id" uuid,
	"movement_type" "imss_movement_type" NOT NULL,
	"movement_code" text NOT NULL,
	"effective_date" date NOT NULL,
	"registro_patronal" text,
	"base_salary_cents" integer,
	"sdi_cents" integer,
	"status" "imss_movement_status" DEFAULT 'PENDIENTE' NOT NULL,
	"blocked_reason" text,
	"confirmed_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "imss_registro_patronal" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "imss_prima_riesgo_trabajo" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "imss_files" ADD CONSTRAINT "imss_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imss_files" ADD CONSTRAINT "imss_files_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imss_movements" ADD CONSTRAINT "imss_movements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imss_movements" ADD CONSTRAINT "imss_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imss_movements" ADD CONSTRAINT "imss_movements_file_id_imss_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."imss_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "imss_files_company_sha_unique" ON "imss_files" USING btree ("company_id","content_sha256");--> statement-breakpoint
CREATE INDEX "imss_files_company_created_idx" ON "imss_files" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "imss_files_company_fecha_idx" ON "imss_files" USING btree ("company_id","fecha_movimiento");--> statement-breakpoint
CREATE UNIQUE INDEX "imss_movements_idempotency_unique" ON "imss_movements" USING btree ("company_id","user_id","movement_type","effective_date");--> statement-breakpoint
CREATE INDEX "imss_movements_company_user_idx" ON "imss_movements" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "imss_movements_company_status_idx" ON "imss_movements" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "imss_movements_company_effective_date_idx" ON "imss_movements" USING btree ("company_id","effective_date");
