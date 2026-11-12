ALTER TABLE "inventory_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_consumption_revisions" ADD COLUMN "total_revenue" integer;--> statement-breakpoint
ALTER TABLE "sales_consumption_revisions" ADD CONSTRAINT "sale_cons_revision_revenue_check" CHECK ("sales_consumption_revisions"."total_revenue" IS NULL OR "sales_consumption_revisions"."total_revenue" >= 0);--> statement-breakpoint
CREATE POLICY "sale_batch_application_tenant" ON "inventory_batches" AS PERMISSIVE FOR ALL TO public USING (EXISTS (SELECT 1 FROM public.branches b JOIN public.inventory_items i ON i.id = "inventory_batches"."item_id"
        WHERE b.id = "inventory_batches"."branch_id" AND b.company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
        AND i.company_id = b.company_id)
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
            OR "inventory_batches"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid)) WITH CHECK (EXISTS (SELECT 1 FROM public.branches b JOIN public.inventory_items i ON i.id = "inventory_batches"."item_id"
        WHERE b.id = "inventory_batches"."branch_id" AND b.company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
        AND i.company_id = b.company_id)
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
            OR "inventory_batches"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sale_movement_application_tenant" ON "inventory_movements" AS PERMISSIVE FOR ALL TO public USING (EXISTS (SELECT 1 FROM public.branches b JOIN public.inventory_items i ON i.id = "inventory_movements"."item_id"
            WHERE b.id = "inventory_movements"."branch_id" AND b.company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
            AND i.company_id = b.company_id)
            AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
                OR "inventory_movements"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid)) WITH CHECK (EXISTS (SELECT 1 FROM public.branches b JOIN public.inventory_items i ON i.id = "inventory_movements"."item_id"
            WHERE b.id = "inventory_movements"."branch_id" AND b.company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
            AND i.company_id = b.company_id)
            AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
                OR "inventory_movements"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid)
            AND ("inventory_movements"."batch_id" IS NULL OR EXISTS (SELECT 1 FROM public.inventory_batches batch
                WHERE batch.id = "inventory_movements"."batch_id" AND batch.item_id = "inventory_movements"."item_id" AND batch.branch_id = "inventory_movements"."branch_id")));--> statement-breakpoint
CREATE POLICY "sale_entry_application_tenant" ON "sales_entries" AS PERMISSIVE FOR ALL TO public USING ("sales_entries"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
            AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
                OR "sales_entries"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid)) WITH CHECK ("sales_entries"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
            AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
                OR "sales_entries"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid)
            AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id="sales_entries"."branch_id" AND b.company_id="sales_entries"."company_id")
            AND EXISTS (SELECT 1 FROM public.recipes r WHERE r.id="sales_entries"."recipe_id" AND r.company_id="sales_entries"."company_id"));
--> statement-breakpoint
-- Scoped runtime application only: no batch creation/deletion, movement rewrite,
-- or sale deletion. Existing owner writers remain compatible until SEC-05.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (id, item_id, branch_id, status, current_quantity, unit_cost, expiration_date, received_at, created_at)
      ON public.inventory_batches TO pulso_app;
    GRANT UPDATE (current_quantity, updated_at) ON public.inventory_batches TO pulso_app;
    GRANT SELECT (id, branch_id, item_id, batch_id, type, quantity_change, reference_id, performed_by, timestamp)
      ON public.inventory_movements TO pulso_app;
    GRANT INSERT (id, branch_id, item_id, batch_id, type, quantity_change, reference_id, performed_by, reason)
      ON public.inventory_movements TO pulso_app;
    GRANT SELECT (id, company_id, branch_id, recipe_id, quantity_sold, sale_date, total_revenue, created_at, updated_at)
      ON public.sales_entries TO pulso_app;
    GRANT INSERT (company_id, branch_id, recipe_id, quantity_sold, sale_date, total_revenue)
      ON public.sales_entries TO pulso_app;
    GRANT UPDATE (quantity_sold, total_revenue, updated_at) ON public.sales_entries TO pulso_app;
  END IF;
END $$;
