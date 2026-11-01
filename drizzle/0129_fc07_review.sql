ALTER TABLE "accounting_journals" ADD COLUMN "replacement_of_id" uuid;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD COLUMN "posting_reason" text;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_replacement_company_fk" FOREIGN KEY ("company_id","replacement_of_id") REFERENCES "public"."accounting_journals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_journals_reversal_unique" ON "accounting_journals" USING btree ("company_id","reversal_of_id") WHERE "accounting_journals"."reversal_of_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_journals_replacement_unique" ON "accounting_journals" USING btree ("company_id","replacement_of_id") WHERE "accounting_journals"."replacement_of_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_correction_check" CHECK (num_nonnulls("accounting_journals"."reversal_of_id", "accounting_journals"."replacement_of_id") <= 1
    AND ("accounting_journals"."replacement_of_id" IS NULL OR "accounting_journals"."replacement_of_id" <> "accounting_journals"."id"));--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_reason_check" CHECK ("accounting_journals"."posting_reason" IS NULL OR
    ("accounting_journals"."posting_reason" = btrim("accounting_journals"."posting_reason") AND length("accounting_journals"."posting_reason") BETWEEN 5 AND 500));
--> statement-breakpoint
-- Supplement FC-06 without changing already posted rows or backfilling motives.
CREATE FUNCTION "public"."accounting_journals_review_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE original "public"."accounting_journals"%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Journal changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,505));
  IF TG_OP = 'UPDATE' AND OLD.replacement_of_id IS DISTINCT FROM NEW.replacement_of_id THEN
    RAISE EXCEPTION 'Replacement link is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'POSTED' AND NEW.posting_reason IS NULL THEN
    RAISE EXCEPTION 'Posting requires an explicit reason' USING ERRCODE = '23514';
  END IF;
  IF coalesce(NEW.reversal_of_id,NEW.replacement_of_id) IS NOT NULL THEN
    SELECT * INTO original FROM "public"."accounting_journals"
      WHERE company_id=NEW.company_id AND id=coalesce(NEW.reversal_of_id,NEW.replacement_of_id);
    IF NOT FOUND OR original.status <> 'POSTED' OR original.reversal_of_id IS NOT NULL
      OR NEW.branch_id IS DISTINCT FROM original.branch_id OR NEW.accounting_date < original.accounting_date THEN
      RAISE EXCEPTION 'Correction requires a posted original in the same branch and a non-earlier date' USING ERRCODE = '23514';
    END IF;
    IF NEW.replacement_of_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "public"."accounting_journals" WHERE company_id=NEW.company_id
        AND reversal_of_id=original.id AND status='POSTED' AND accounting_date=NEW.accounting_date
    ) THEN
      RAISE EXCEPTION 'Replacement requires a posted reversal' USING ERRCODE = '23514';
    END IF;
    IF NEW.status='POSTED' AND NEW.reversal_of_id IS NOT NULL AND EXISTS (
      (SELECT account_id,cost_center_id,debit_cents,credit_cents FROM "public"."accounting_journal_lines"
        WHERE company_id=NEW.company_id AND journal_id=NEW.id
       EXCEPT ALL
       SELECT account_id,cost_center_id,credit_cents,debit_cents FROM "public"."accounting_journal_lines"
        WHERE company_id=NEW.company_id AND journal_id=original.id)
      UNION ALL
      (SELECT account_id,cost_center_id,credit_cents,debit_cents FROM "public"."accounting_journal_lines"
        WHERE company_id=NEW.company_id AND journal_id=original.id
       EXCEPT ALL
       SELECT account_id,cost_center_id,debit_cents,credit_cents FROM "public"."accounting_journal_lines"
        WHERE company_id=NEW.company_id AND journal_id=NEW.id)
    ) THEN
      RAISE EXCEPTION 'Reversal must exactly invert the original lines' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_journals_review_validate BEFORE INSERT OR UPDATE ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_journals_review_guard"();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (branch_id) ON "public"."users" TO pulso_app;
  END IF;
END $$;
