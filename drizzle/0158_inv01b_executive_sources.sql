ALTER TABLE "inventory_waste" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_instances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "executive_waste_reader" ON "inventory_waste" AS PERMISSIVE FOR SELECT TO public USING ("inventory_waste"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
            AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = "inventory_waste"."branch_id" AND b.company_id = "inventory_waste"."company_id")
            AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
                OR "inventory_waste"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "executive_count_instance_reader" ON "workflow_instances" AS PERMISSIVE FOR SELECT TO public USING (EXISTS (SELECT 1 FROM public.branches b
        WHERE b.id = "workflow_instances"."branch_id"
        AND b.company_id = nullif(current_setting('app.current_company_id', true), '')::uuid)
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
            OR "workflow_instances"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid)
        AND EXISTS (SELECT 1 FROM public.workflow_templates t
            WHERE t.id = "workflow_instances"."workflow_template_id" AND t.name = 'Conteo de Inventario'));--> statement-breakpoint
CREATE POLICY "executive_template_catalog_reader" ON "workflow_templates" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.current_company_id', true), '') IS NOT NULL
        AND ("workflow_templates"."company_id" IS NULL
            OR "workflow_templates"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid)
        AND ("workflow_templates"."branch_id" IS NULL OR EXISTS (SELECT 1 FROM public.branches b
            WHERE b.id = "workflow_templates"."branch_id"
            AND b.company_id = nullif(current_setting('app.current_company_id', true), '')::uuid))
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
            OR "workflow_templates"."branch_id" IS NULL
            OR "workflow_templates"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid));
--> statement-breakpoint
-- Read-only projections required by the executive KPIs. Owner writers retain
-- compatibility; enabling runtime DML belongs to the domain security tickets.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (id, name) ON public.workflow_templates TO pulso_app;
    GRANT SELECT (branch_id, workflow_template_id, status, completed_at, data)
      ON public.workflow_instances TO pulso_app;
    GRANT SELECT (branch_id, recorded_at, reason, approval_status, total_loss)
      ON public.inventory_waste TO pulso_app;
  END IF;
END $$;
