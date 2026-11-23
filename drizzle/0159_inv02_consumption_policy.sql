CREATE TABLE "recipe_consumption_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"recipe_version_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"mode" text NOT NULL,
	"inventory_item_id" uuid,
	"unit" text,
	"published_by" text NOT NULL,
	"reason" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_consumption_policy_start_unique" UNIQUE("company_id","recipe_id","effective_from"),
	CONSTRAINT "recipe_consumption_policy_version_unique" UNIQUE("recipe_version_id"),
	CONSTRAINT "recipe_consumption_policy_mode_check" CHECK ((
            ("recipe_consumption_policies"."mode" = 'INGREDIENTS_ON_SALE' AND "recipe_consumption_policies"."inventory_item_id" IS NULL AND "recipe_consumption_policies"."unit" IS NULL)
            OR ("recipe_consumption_policies"."mode" = 'FINISHED_PRODUCT_ON_SALE' AND "recipe_consumption_policies"."inventory_item_id" IS NOT NULL
                AND "recipe_consumption_policies"."unit" IS NOT NULL AND length("recipe_consumption_policies"."unit") > 0 AND "recipe_consumption_policies"."unit" = btrim("recipe_consumption_policies"."unit"))) IS TRUE),
	CONSTRAINT "recipe_consumption_policy_day_check" CHECK ("recipe_consumption_policies"."effective_from" BETWEEN '0001-01-01'::date AND '9999-12-31'::date),
	CONSTRAINT "recipe_consumption_policy_actor_check" CHECK ("recipe_consumption_policies"."published_by" = btrim("recipe_consumption_policies"."published_by") AND length("recipe_consumption_policies"."published_by") BETWEEN 1 AND 256),
	CONSTRAINT "recipe_consumption_policy_reason_check" CHECK ("recipe_consumption_policies"."reason" = btrim("recipe_consumption_policies"."reason") AND length("recipe_consumption_policies"."reason") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "recipe_consumption_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The generated foreign keys need these candidate keys to exist first.
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_item_identity_company_unique" UNIQUE("id","company_id");--> statement-breakpoint
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_version_identity_scope_unique" UNIQUE("id","recipe_id","company_id");--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipe_identity_company_unique" UNIQUE("id","company_id");--> statement-breakpoint
ALTER TABLE "recipe_consumption_policies" ADD CONSTRAINT "recipe_consumption_policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_consumption_policies" ADD CONSTRAINT "recipe_consumption_policy_recipe_scope_fk" FOREIGN KEY ("recipe_id","company_id") REFERENCES "public"."recipes"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_consumption_policies" ADD CONSTRAINT "recipe_consumption_policy_version_scope_fk" FOREIGN KEY ("recipe_version_id","recipe_id","company_id") REFERENCES "public"."recipe_versions"("id","recipe_id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_consumption_policies" ADD CONSTRAINT "recipe_consumption_policy_item_scope_fk" FOREIGN KEY ("inventory_item_id","company_id") REFERENCES "public"."inventory_items"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "recipe_consumption_policy_tenant" ON "recipe_consumption_policies" AS PERMISSIVE FOR ALL TO public USING ("recipe_consumption_policies"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid) WITH CHECK ("recipe_consumption_policies"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- INV-02: no historical backfill, no stock writes, and no mode enabled by DDL.
ALTER TABLE public.recipe_consumption_policies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION public.recipe_consumption_policy_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published recipe consumption policies are immutable' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER recipe_consumption_policy_immutable BEFORE UPDATE OR DELETE
ON public.recipe_consumption_policies FOR EACH ROW
EXECUTE FUNCTION public.recipe_consumption_policy_immutable();
--> statement-breakpoint
REVOKE ALL ON TABLE public.recipe_consumption_policies FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT ON TABLE public.recipe_consumption_policies TO pulso_app;
    REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.recipe_consumption_policies FROM pulso_app;
  END IF;
END $$;
