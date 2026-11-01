-- FC-06: database boundary for journals. Drafts stay editable; the DRAFT ->
-- POSTED transition re-checks balance, line count, account validity and
-- overflow inside PostgreSQL, so a caller bug cannot publish a bad journal.
-- No data backfill; no journal is created here.
ALTER TABLE "public"."accounting_journals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."accounting_journal_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Atomicity: BEFORE triggers run inside the same statement as the status
-- change, so a rejected posting leaves the draft untouched. Identity, source
-- and reversal links are frozen; version only grows.
CREATE FUNCTION "public"."accounting_journals_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  debit_total numeric;
  credit_total numeric;
  line_count integer;
  invalid_account text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Journal changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  -- Same lock as account changes: validate against committed account state.
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.company_id::text, 505));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 505));
    IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "public"."branches" b
      WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id AND coalesce(b.active, true)
    ) THEN
      RAISE EXCEPTION 'Journal branch must be active in this company' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "public"."financial_periods" p
      WHERE p.company_id = NEW.company_id AND p.year = extract(year FROM NEW.accounting_date)
      AND p.month = extract(month FROM NEW.accounting_date) AND p.status = 'CLOSED') THEN
      RAISE EXCEPTION 'Financial period is closed' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM "public"."financial_periods" p
    WHERE p.company_id = OLD.company_id AND p.year = extract(year FROM OLD.accounting_date)
    AND p.month = extract(month FROM OLD.accounting_date) AND p.status = 'CLOSED') THEN
    RAISE EXCEPTION 'Financial period is closed' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Journals must be created as drafts' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Posted journals cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF (OLD.id, OLD.company_id) IS DISTINCT FROM (NEW.id, NEW.company_id) THEN
    RAISE EXCEPTION 'Journal identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF (OLD.source_type, OLD.source_id, OLD.source_version, OLD.event_type)
    IS DISTINCT FROM (NEW.source_type, NEW.source_id, NEW.source_version, NEW.event_type) THEN
    RAISE EXCEPTION 'Journal source is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.reversal_of_id IS DISTINCT FROM NEW.reversal_of_id THEN
    RAISE EXCEPTION 'Journal reversal link is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'Journal version must grow on every edit' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted journals are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'POSTED' THEN
    IF NEW.number IS NULL OR NEW.posted_at IS NULL OR NEW.posted_by IS NULL THEN
      RAISE EXCEPTION 'Posted journal requires number, actor and timestamp' USING ERRCODE = '23514';
    END IF;
    SELECT count(*), coalesce(sum(l.debit_cents), 0), coalesce(sum(l.credit_cents), 0)
      INTO line_count, debit_total, credit_total
      FROM "public"."accounting_journal_lines" l
      WHERE l.company_id = NEW.company_id AND l.journal_id = NEW.id;
    IF line_count < 2 THEN
      RAISE EXCEPTION 'Journal needs at least two lines to post' USING ERRCODE = '23514';
    END IF;
    IF debit_total <> credit_total THEN
      RAISE EXCEPTION 'Journal debits and credits differ' USING ERRCODE = '23514';
    END IF;
    IF debit_total > 9007199254740991 THEN
      RAISE EXCEPTION 'Journal total exceeds the safe integer range' USING ERRCODE = '23514';
    END IF;
    SELECT a.code INTO invalid_account
      FROM "public"."accounting_accounts" a
      WHERE a.company_id = NEW.company_id
        AND a.id IN (SELECT l.account_id FROM "public"."accounting_journal_lines" l
          WHERE l.company_id = NEW.company_id AND l.journal_id = NEW.id)
        AND (NOT a.active OR NOT a.postable
          OR a.valid_from > NEW.accounting_date
          OR (a.valid_to IS NOT NULL AND a.valid_to < NEW.accounting_date))
      LIMIT 1;
    IF invalid_account IS NOT NULL THEN
      RAISE EXCEPTION 'Journal account % is not active, postable or valid at the accounting date', invalid_account
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_journals_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_journals_guard"();
--> statement-breakpoint
-- Lines: only drafts accept changes, and the account/center must live in the
-- same company. Deleting a journal cascades lines after the parent row is gone,
-- so a missing parent is accepted on DELETE only.
CREATE FUNCTION "public"."accounting_journal_lines_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  parent_status text;
  parent_date date;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Journal changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.id, OLD.company_id, OLD.journal_id)
    IS DISTINCT FROM (NEW.id, NEW.company_id, NEW.journal_id) THEN
    RAISE EXCEPTION 'Journal line identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.company_id::text, 505));
    SELECT j.status, j.accounting_date INTO parent_status, parent_date FROM "public"."accounting_journals" j
      WHERE j.company_id = OLD.company_id AND j.id = OLD.journal_id FOR UPDATE;
    IF FOUND AND parent_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Posted journal lines are immutable' USING ERRCODE = '23514';
    END IF;
    IF FOUND AND EXISTS (SELECT 1 FROM "public"."financial_periods" p
      WHERE p.company_id = OLD.company_id AND p.year = extract(year FROM parent_date)
      AND p.month = extract(month FROM parent_date) AND p.status = 'CLOSED') THEN
      RAISE EXCEPTION 'Financial period is closed' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 505));
  SELECT j.status, j.accounting_date INTO parent_status, parent_date FROM "public"."accounting_journals" j
    WHERE j.company_id = NEW.company_id AND j.id = NEW.journal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal line requires its journal in the same company' USING ERRCODE = '23503';
  END IF;
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Posted journal lines are immutable' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."financial_periods" p
    WHERE p.company_id = NEW.company_id AND p.year = extract(year FROM parent_date)
    AND p.month = extract(month FROM parent_date) AND p.status = 'CLOSED') THEN
    RAISE EXCEPTION 'Financial period is closed' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "public"."accounting_accounts" a
    WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id AND a.active AND a.postable) THEN
    RAISE EXCEPTION 'Journal line account must be active and postable' USING ERRCODE = '23514';
  END IF;
  IF NEW.cost_center_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "public"."cost_centers" c
      WHERE c.company_id = NEW.company_id AND c.id = NEW.cost_center_id AND c.active
  ) THEN
    RAISE EXCEPTION 'Journal line cost center must be active in this company' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_journal_lines_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_journal_lines"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_journal_lines_guard"();
--> statement-breakpoint
-- Reuse the existing runtime DB role. DELETE is needed for drafts only and the
-- triggers above reject it on posted journals.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."accounting_journals", "public"."accounting_journal_lines" TO pulso_app;
    GRANT SELECT (id, company_id, active) ON "public"."branches" TO pulso_app;
    GRANT SELECT (company_id, year, month, status) ON "public"."financial_periods" TO pulso_app;
  END IF;
END $$;
