-- Custom SQL migration file, put your code below! --
-- POS: contexto transaccional obligatorio para lectura/vínculo de archivos.
ALTER TABLE "daily_sales_cuts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "daily_sales_cut_tenant" ON "daily_sales_cuts" AS PERMISSIVE FOR ALL TO public
USING (
  company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
  AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
    OR branch_id = nullif(current_setting('app.current_branch_id', true), '')::uuid)
  AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = daily_sales_cuts.branch_id AND b.company_id = daily_sales_cuts.company_id)
)
WITH CHECK (
  company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
  AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
    OR branch_id = nullif(current_setting('app.current_branch_id', true), '')::uuid)
  AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = daily_sales_cuts.branch_id AND b.company_id = daily_sales_cuts.company_id)
);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (id, company_id, branch_id, business_date, raw_file_url) ON public.daily_sales_cuts TO pulso_app;
    GRANT UPDATE (raw_file_url, validation_notes, updated_at) ON public.daily_sales_cuts TO pulso_app;
    GRANT SELECT (id, company_id) ON public.branches TO pulso_app;
  END IF;
END $$;
