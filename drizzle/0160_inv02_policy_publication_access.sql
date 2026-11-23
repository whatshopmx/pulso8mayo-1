ALTER TABLE "config_change_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recipe_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "recipe_policy_audit_reader" ON "config_change_logs" AS PERMISSIVE FOR SELECT TO public USING ("config_change_logs"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
            AND "config_change_logs"."field_name" LIKE 'recipe_consumption_policy:%');--> statement-breakpoint
CREATE POLICY "recipe_policy_audit_writer" ON "config_change_logs" AS PERMISSIVE FOR INSERT TO public WITH CHECK (("config_change_logs"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
            AND "config_change_logs"."field_name" ~ '^recipe_consumption_policy:[0-9a-f-]{36}$'
            AND jsonb_typeof("config_change_logs"."new_value") = 'object'
            AND length(btrim("config_change_logs"."new_value"->>'auditReason')) BETWEEN 4 AND 1000) IS TRUE);--> statement-breakpoint
CREATE POLICY "recipe_version_reader_tenant" ON "recipe_versions" AS PERMISSIVE FOR SELECT TO public USING ("recipe_versions"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- Version records are snapshots; changing a definition creates a new version.
-- Deleting a published version is already blocked by the 0159 policy FK.
CREATE FUNCTION public.recipe_version_definition_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Recipe version snapshots cannot be rewritten' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER recipe_version_definition_immutable BEFORE UPDATE ON public.recipe_versions
FOR EACH ROW EXECUTE FUNCTION public.recipe_version_definition_immutable();
--> statement-breakpoint
CREATE FUNCTION public.recipe_policy_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.field_name LIKE 'recipe_consumption_policy:%' THEN
    RAISE EXCEPTION 'Recipe policy audit facts cannot be rewritten' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.field_name LIKE 'recipe_consumption_policy:%' THEN
      RAISE EXCEPTION 'Existing configuration logs cannot become recipe policy facts' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER recipe_policy_audit_immutable BEFORE UPDATE OR DELETE ON public.config_change_logs
FOR EACH ROW EXECUTE FUNCTION public.recipe_policy_audit_immutable();
--> statement-breakpoint
-- No FORCE on the existing shared tables: legacy owner writers keep their
-- current context contract. Runtime does not own these tables or bypass RLS.
REVOKE ALL ON TABLE public.recipe_versions, public.config_change_logs FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    REVOKE ALL ON TABLE public.recipe_versions, public.config_change_logs FROM pulso_app;
    GRANT SELECT (id, recipe_id, company_id, version_number, base_yield, unit, items_snapshot)
      ON TABLE public.recipe_versions TO pulso_app;
    GRANT INSERT (company_id, user_id, field_name, old_value, new_value)
      ON TABLE public.config_change_logs TO pulso_app;
    GRANT SELECT (id, company_id, field_name) ON TABLE public.config_change_logs TO pulso_app;
  END IF;
END $$;
