-- FC-05: no data backfill or automatic mappings. The application already sets
-- app.current_company_id transaction-locally through withCompanyContext.
ALTER TABLE "public"."accounting_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."accounting_source_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- VOLATILE uses a fresh snapshot for each query at READ COMMITTED. Serialize
-- validation per company so concurrent reparenting cannot create write skew.
-- Other isolation levels are rejected rather than silently using stale reads.
CREATE FUNCTION "public"."accounting_accounts_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Account changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 505));
  IF TG_OP = 'UPDATE' AND (OLD.id, OLD.company_id, OLD.code, OLD.kind, OLD.normal_balance)
    IS DISTINCT FROM (NEW.id, NEW.company_id, NEW.code, NEW.kind, NEW.normal_balance) THEN
    RAISE EXCEPTION 'Account identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM "public"."accounting_accounts"
        WHERE company_id = NEW.company_id AND id = NEW.parent_id
      UNION
      SELECT p.id, p.parent_id FROM "public"."accounting_accounts" p JOIN ancestors a ON p.id = a.parent_id
        WHERE p.company_id = NEW.company_id
    ) SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Account hierarchy cycle' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."accounting_accounts" p
    WHERE p.company_id = NEW.company_id AND p.id = NEW.parent_id AND (p.kind <> NEW.kind OR p.postable)) THEN
    RAISE EXCEPTION 'Parent must be a non-postable account of the same kind' USING ERRCODE = '23514';
  END IF;
  IF NEW.postable AND EXISTS (SELECT 1 FROM "public"."accounting_accounts" c
    WHERE c.company_id = NEW.company_id AND c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'An account with children cannot be postable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_accounts_validate AFTER INSERT OR UPDATE ON "public"."accounting_accounts"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_accounts_guard"();
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_source_links_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE target_kind text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Account link changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 505));
  IF TG_OP = 'UPDATE' AND (OLD.id, OLD.company_id) IS DISTINCT FROM (NEW.id, NEW.company_id) THEN
    RAISE EXCEPTION 'Link identity is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT kind INTO target_kind FROM "public"."accounting_accounts"
    WHERE company_id = NEW.company_id AND id = NEW.account_id AND active AND postable;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link target must be an active postable account' USING ERRCODE = '23514';
  END IF;
  IF NEW.bank_account_id IS NOT NULL THEN
    IF target_kind <> 'ASSET' OR NOT EXISTS (
      SELECT 1 FROM "public"."company_bank_accounts" WHERE company_id = NEW.company_id
        AND id = NEW.bank_account_id AND active AND currency = 'MXN'
    ) THEN
      RAISE EXCEPTION 'Bank link requires an active MXN own bank account and an asset account' USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM "public"."cost_centers"
    WHERE company_id = NEW.company_id AND id = NEW.cost_center_id AND active) THEN
    RAISE EXCEPTION 'Cost center must be active in this company' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_source_links_validate AFTER INSERT OR UPDATE ON "public"."accounting_source_links"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_source_links_guard"();
--> statement-breakpoint
-- Reuse the existing runtime DB role. No elevated role or DELETE privilege.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT USAGE ON SCHEMA "public" TO pulso_app;
    GRANT SELECT, INSERT, UPDATE ON "public"."accounting_accounts", "public"."accounting_source_links" TO pulso_app;
    GRANT SELECT (id, company_id, role, active, deleted_at) ON "public"."users" TO pulso_app;
    GRANT SELECT (id, company_id, active) ON "public"."cost_centers" TO pulso_app;
    GRANT SELECT (id, company_id, active, currency) ON "public"."company_bank_accounts" TO pulso_app;
  END IF;
END $$;
