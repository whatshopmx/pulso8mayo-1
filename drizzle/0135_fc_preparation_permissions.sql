-- Read only the operational labels required by accounting preparation.
-- Account numbers, fingerprints, encrypted data and bank balances stay private.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (code, name, accounting_line) ON "public"."cost_centers" TO pulso_app;
    GRANT SELECT (label, account_last_four, purpose) ON "public"."company_bank_accounts" TO pulso_app;
  END IF;
END $$;
