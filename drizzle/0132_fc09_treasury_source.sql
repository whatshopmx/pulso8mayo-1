ALTER TABLE "payment_runs" ADD COLUMN "source_bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_runs" ADD CONSTRAINT "payment_runs_source_bank_company_fk" FOREIGN KEY ("company_id","source_bank_account_id") REFERENCES "public"."company_bank_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- No backfill: a legacy account number is not a verified bank identity.
-- Freeze both the selected identity and the number used by the signed layout.
CREATE FUNCTION "public"."payment_runs_source_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.company_id, OLD.source_bank_account_id, OLD.source_account, OLD.currency)
      IS NOT DISTINCT FROM (NEW.company_id, NEW.source_bank_account_id, NEW.source_account, NEW.currency) THEN
      RETURN NEW;
    END IF;
    IF OLD.source_bank_account_id IS NOT NULL OR OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'The treasury source identity and number are frozen; prepare a new run'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.source_bank_account_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "public"."company_bank_accounts" b
      WHERE b.company_id = NEW.company_id AND b.id = NEW.source_bank_account_id) THEN
      RAISE EXCEPTION 'Treasury source must belong to this company' USING ERRCODE = '23503';
    END IF;
    IF NEW.currency <> 'MXN' OR NOT EXISTS (SELECT 1 FROM "public"."company_bank_accounts" b
      WHERE b.company_id = NEW.company_id AND b.id = NEW.source_bank_account_id AND b.active AND b.currency = 'MXN')
      OR nullif(btrim(NEW.source_account), '') IS NULL THEN
      RAISE EXCEPTION 'Treasury source requires an active MXN own bank account and its number'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER payment_runs_source_validate BEFORE INSERT OR UPDATE OF company_id, source_bank_account_id, source_account, currency
ON "public"."payment_runs" FOR EACH ROW EXECUTE FUNCTION "public"."payment_runs_source_guard"();--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (source_bank_account_id) ON "public"."payment_runs" TO pulso_app;
  END IF;
END $$;
