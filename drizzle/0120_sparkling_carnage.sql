CREATE TABLE "payroll_aguinaldo_dispersiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"run_id" uuid,
	"source" text DEFAULT 'RUN' NOT NULL,
	"user_id" text NOT NULL,
	"anio_fiscal" integer NOT NULL,
	"monto_cents" integer NOT NULL,
	"motivo" text NOT NULL,
	"fecha_dispersion" timestamp DEFAULT now() NOT NULL,
	"performed_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_aguinaldo_dispersiones" ADD CONSTRAINT "payroll_aguinaldo_dispersiones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_aguinaldo_dispersiones" ADD CONSTRAINT "payroll_aguinaldo_dispersiones_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_aguinaldo_dispersiones" ADD CONSTRAINT "payroll_aguinaldo_dispersiones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_aguinaldo_dispersiones_company_year_idx" ON "payroll_aguinaldo_dispersiones" USING btree ("company_id","anio_fiscal","user_id");