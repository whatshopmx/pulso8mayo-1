CREATE TABLE "sales_consumption_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"source" text NOT NULL,
	"product_key" text NOT NULL,
	"sale_day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_cons_identity_key_unique" UNIQUE("company_id","branch_id","source","product_key","sale_day"),
	CONSTRAINT "sale_cons_identity_scope_unique" UNIQUE("id","company_id","branch_id"),
	CONSTRAINT "sale_cons_identity_source_check" CHECK ("sales_consumption_identities"."source" ~ '^[a-z0-9][a-z0-9._:-]{0,63}$'),
	CONSTRAINT "sale_cons_identity_product_check" CHECK ("sales_consumption_identities"."product_key" = btrim("sales_consumption_identities"."product_key") AND length("sales_consumption_identities"."product_key") BETWEEN 1 AND 256),
	CONSTRAINT "sale_cons_identity_day_check" CHECK ("sales_consumption_identities"."sale_day" BETWEEN '0001-01-01'::date AND '9999-12-31'::date)
);
--> statement-breakpoint
ALTER TABLE "sales_consumption_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_consumption_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"previous_revision" integer,
	"previous_quantity_sold" numeric(10, 2) NOT NULL,
	"quantity_sold" numeric(10, 2) NOT NULL,
	"recipe_id" uuid NOT NULL,
	"recipe_snapshot" jsonb NOT NULL,
	"allocations" jsonb NOT NULL,
	"movement_refs" jsonb NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_cons_revision_unique" UNIQUE("identity_id","revision"),
	CONSTRAINT "sale_cons_revision_quantity_unique" UNIQUE("identity_id","revision","quantity_sold"),
	CONSTRAINT "sale_cons_revision_chain_check" CHECK ("sales_consumption_revisions"."revision" >= 1 AND (
            ("sales_consumption_revisions"."revision" = 1 AND "sales_consumption_revisions"."previous_revision" IS NULL AND "sales_consumption_revisions"."previous_quantity_sold" = 0)
            OR ("sales_consumption_revisions"."revision" > 1 AND "sales_consumption_revisions"."previous_revision" IS NOT NULL AND "sales_consumption_revisions"."previous_revision" = "sales_consumption_revisions"."revision" - 1))),
	CONSTRAINT "sale_cons_revision_quantity_check" CHECK ("sales_consumption_revisions"."quantity_sold" >= 0 AND "sales_consumption_revisions"."previous_quantity_sold" >= 0),
	CONSTRAINT "sale_cons_revision_actor_check" CHECK ("sales_consumption_revisions"."recorded_by" = btrim("sales_consumption_revisions"."recorded_by") AND length("sales_consumption_revisions"."recorded_by") > 0),
	CONSTRAINT "sale_cons_revision_snapshot_check" CHECK ((jsonb_typeof("sales_consumption_revisions"."recipe_snapshot") = 'object'
            AND "sales_consumption_revisions"."recipe_snapshot"->>'schemaVersion' = '1'
            AND "sales_consumption_revisions"."recipe_snapshot"->>'recipeId' = "sales_consumption_revisions"."recipe_id"::text
            AND length("sales_consumption_revisions"."recipe_snapshot"->>'versionKey') BETWEEN 1 AND 128
            AND jsonb_typeof("sales_consumption_revisions"."recipe_snapshot"->'definition') = 'object') IS TRUE),
	CONSTRAINT "sale_cons_revision_allocations_check" CHECK (jsonb_typeof("sales_consumption_revisions"."allocations") = 'array' AND jsonb_typeof("sales_consumption_revisions"."movement_refs") = 'array')
);
--> statement-breakpoint
ALTER TABLE "sales_consumption_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_consumption_identities" ADD CONSTRAINT "sales_consumption_identities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_consumption_identities" ADD CONSTRAINT "sales_consumption_identities_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_consumption_revisions" ADD CONSTRAINT "sales_consumption_revisions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_consumption_revisions" ADD CONSTRAINT "sale_cons_revision_identity_scope_fk" FOREIGN KEY ("identity_id","company_id","branch_id") REFERENCES "public"."sales_consumption_identities"("id","company_id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_consumption_revisions" ADD CONSTRAINT "sale_cons_revision_previous_fk" FOREIGN KEY ("identity_id","previous_revision","previous_quantity_sold") REFERENCES "public"."sales_consumption_revisions"("identity_id","revision","quantity_sold") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "sale_cons_identity_tenant" ON "sales_consumption_identities" AS PERMISSIVE FOR ALL TO public USING ("sales_consumption_identities"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
          OR "sales_consumption_identities"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid)) WITH CHECK ("sales_consumption_identities"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
          OR "sales_consumption_identities"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid) AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id = "sales_consumption_identities"."branch_id" AND b.company_id = "sales_consumption_identities"."company_id"));--> statement-breakpoint
CREATE POLICY "sale_cons_revision_tenant" ON "sales_consumption_revisions" AS PERMISSIVE FOR ALL TO public USING ("sales_consumption_revisions"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
          OR "sales_consumption_revisions"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid)) WITH CHECK ("sales_consumption_revisions"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
          OR "sales_consumption_revisions"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid) AND EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = "sales_consumption_revisions"."recipe_id" AND r.company_id = "sales_consumption_revisions"."company_id"));
--> statement-breakpoint
-- INV-01.a: append-only even for an ordinary table-owner connection. Stock
-- and legacy sales are untouched; there is deliberately no automatic backfill.
ALTER TABLE "public"."sales_consumption_identities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."sales_consumption_revisions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION "public"."sale_consumption_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sale consumption identity and applied revisions are immutable'
    USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER sale_consumption_identity_immutable BEFORE UPDATE OR DELETE
ON "public"."sales_consumption_identities" FOR EACH ROW
EXECUTE FUNCTION "public"."sale_consumption_immutable"();
--> statement-breakpoint
CREATE TRIGGER sale_consumption_revision_immutable BEFORE UPDATE OR DELETE
ON "public"."sales_consumption_revisions" FOR EACH ROW
EXECUTE FUNCTION "public"."sale_consumption_immutable"();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT USAGE ON SCHEMA public TO pulso_app;
    GRANT SELECT, INSERT ON public.sales_consumption_identities, public.sales_consumption_revisions TO pulso_app;
    GRANT SELECT (id, company_id) ON public.branches, public.recipes TO pulso_app;
  END IF;
END $$;
