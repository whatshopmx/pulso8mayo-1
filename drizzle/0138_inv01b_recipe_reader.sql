ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipe_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "unit_conversions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sale_inventory_catalog_tenant" ON "inventory_items" AS PERMISSIVE FOR SELECT TO public USING ("inventory_items"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sale_recipe_line_catalog_tenant" ON "recipe_items" AS PERMISSIVE FOR SELECT TO public USING (EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = "recipe_items"."recipe_id"
            AND r.company_id = nullif(current_setting('app.current_company_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sale_recipe_catalog_tenant" ON "recipes" AS PERMISSIVE FOR SELECT TO public USING ("recipes"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sale_conversion_catalog_tenant" ON "unit_conversions" AS PERMISSIVE FOR SELECT TO public USING ("unit_conversions"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- INV-01.b2a: only the columns required to build the server recipe snapshot.
-- No DML and no general SELECT. RLS applies to the NOBYPASSRLS runtime role;
-- owner connections retain compatibility until their context migration in SEC-05.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT USAGE ON SCHEMA public TO pulso_app;
    GRANT SELECT (id, company_id, base_yield, unit) ON public.recipes TO pulso_app;
    GRANT SELECT (id, recipe_id, item_id, quantity, unit, is_sub_recipe, yield_percent) ON public.recipe_items TO pulso_app;
    GRANT SELECT (id, company_id, unit) ON public.inventory_items TO pulso_app;
    GRANT SELECT (id, company_id, from_unit, to_unit, factor) ON public.unit_conversions TO pulso_app;
  END IF;
END $$;
