CREATE TABLE "accounting_opening_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"opening_id" uuid NOT NULL,
	"label" text NOT NULL,
	"reference" text NOT NULL,
	"amount_cents" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_opening_documents_label_unique" UNIQUE("company_id","opening_id","label"),
	CONSTRAINT "accounting_opening_documents_label_check" CHECK ("accounting_opening_documents"."label" = btrim("accounting_opening_documents"."label") AND length("accounting_opening_documents"."label") BETWEEN 1 AND 120),
	CONSTRAINT "accounting_opening_documents_reference_check" CHECK ("accounting_opening_documents"."reference" = btrim("accounting_opening_documents"."reference") AND length("accounting_opening_documents"."reference") BETWEEN 1 AND 200),
	CONSTRAINT "accounting_opening_documents_amount_check" CHECK ("accounting_opening_documents"."amount_cents" IS NULL OR ("accounting_opening_documents"."amount_cents" >= 0 AND "accounting_opening_documents"."amount_cents" <= 9007199254740991))
);
--> statement-breakpoint
ALTER TABLE "accounting_opening_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"opening_date" date NOT NULL,
	"memo" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_openings_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "accounting_openings_memo_check" CHECK ("accounting_openings"."memo" IS NULL OR ("accounting_openings"."memo" = btrim("accounting_openings"."memo") AND length("accounting_openings"."memo") BETWEEN 1 AND 500))
);
--> statement-breakpoint
ALTER TABLE "accounting_openings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_rule_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"role" text NOT NULL,
	"account_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_rule_entries_role_unique" UNIQUE("company_id","rule_id","role"),
	CONSTRAINT "accounting_rule_entries_role_check" CHECK ("accounting_rule_entries"."role" ~ '^[A-Z][A-Z0-9_]{2,39}$')
);
--> statement-breakpoint
ALTER TABLE "accounting_rule_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"event_type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"supersedes_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_rules_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "accounting_rules_code_check" CHECK ("accounting_rules"."code" ~ '^[A-Z][A-Z0-9_]{2,31}$'),
	CONSTRAINT "accounting_rules_event_type_check" CHECK ("accounting_rules"."event_type" ~ '^[A-Z][A-Z0-9_]{2,39}$'),
	CONSTRAINT "accounting_rules_name_check" CHECK ("accounting_rules"."name" = btrim("accounting_rules"."name") AND length("accounting_rules"."name") BETWEEN 1 AND 160),
	CONSTRAINT "accounting_rules_version_check" CHECK ("accounting_rules"."version" >= 1),
	CONSTRAINT "accounting_rules_supersedes_self_check" CHECK ("accounting_rules"."supersedes_id" IS NULL OR "accounting_rules"."supersedes_id" <> "accounting_rules"."id"),
	CONSTRAINT "accounting_rules_notes_check" CHECK ("accounting_rules"."notes" IS NULL OR ("accounting_rules"."notes" = btrim("accounting_rules"."notes") AND length("accounting_rules"."notes") BETWEEN 1 AND 500))
);
--> statement-breakpoint
ALTER TABLE "accounting_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_journals" DROP CONSTRAINT "accounting_journals_source_check";--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD COLUMN "rule_id" uuid;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD COLUMN "rule_version" integer;--> statement-breakpoint
ALTER TABLE "accounting_opening_documents" ADD CONSTRAINT "accounting_opening_documents_opening_fk" FOREIGN KEY ("company_id","opening_id") REFERENCES "public"."accounting_openings"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_openings" ADD CONSTRAINT "accounting_openings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_openings" ADD CONSTRAINT "accounting_openings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_openings" ADD CONSTRAINT "accounting_openings_journal_fk" FOREIGN KEY ("company_id","journal_id") REFERENCES "public"."accounting_journals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rule_entries" ADD CONSTRAINT "accounting_rule_entries_rule_fk" FOREIGN KEY ("company_id","rule_id") REFERENCES "public"."accounting_rules"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rule_entries" ADD CONSTRAINT "accounting_rule_entries_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."accounting_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rule_entries" ADD CONSTRAINT "accounting_rule_entries_cost_center_fk" FOREIGN KEY ("company_id","cost_center_id") REFERENCES "public"."cost_centers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rules" ADD CONSTRAINT "accounting_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rules" ADD CONSTRAINT "accounting_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rules" ADD CONSTRAINT "accounting_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_rules" ADD CONSTRAINT "accounting_rules_supersedes_company_fk" FOREIGN KEY ("company_id","supersedes_id") REFERENCES "public"."accounting_rules"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounting_opening_documents_opening_idx" ON "accounting_opening_documents" USING btree ("company_id","opening_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_openings_company_unique" ON "accounting_openings" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_openings_journal_unique" ON "accounting_openings" USING btree ("company_id","journal_id");--> statement-breakpoint
CREATE INDEX "accounting_rule_entries_rule_idx" ON "accounting_rule_entries" USING btree ("company_id","rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_rules_company_code_version_unique" ON "accounting_rules" USING btree ("company_id","code","version");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_rules_company_code_from_unique" ON "accounting_rules" USING btree ("company_id","code","effective_from");--> statement-breakpoint
CREATE INDEX "accounting_rules_effective_idx" ON "accounting_rules" USING btree ("company_id","event_type","effective_from");--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_rule_company_fk" FOREIGN KEY ("company_id","rule_id") REFERENCES "public"."accounting_rules"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_rule_check" CHECK (num_nonnulls("accounting_journals"."rule_id", "accounting_journals"."rule_version") IN (0, 2)
    AND ("accounting_journals"."rule_version" IS NULL OR "accounting_journals"."rule_version" >= 1));--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_source_check" CHECK (
    num_nonnulls("accounting_journals"."source_type", "accounting_journals"."source_id", "accounting_journals"."source_version", "accounting_journals"."event_type") IN (0, 4)
    OR ("accounting_journals"."source_type" = 'OPENING' AND "accounting_journals"."source_id" IS NOT NULL
      AND "accounting_journals"."source_version" IS NOT NULL AND "accounting_journals"."event_type" IS NULL));--> statement-breakpoint
CREATE POLICY "accounting_opening_documents_tenant" ON "accounting_opening_documents" AS PERMISSIVE FOR ALL TO public USING ("accounting_opening_documents"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_opening_documents"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_openings_tenant" ON "accounting_openings" AS PERMISSIVE FOR ALL TO public USING ("accounting_openings"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_openings"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_rule_entries_tenant" ON "accounting_rule_entries" AS PERMISSIVE FOR ALL TO public USING ("accounting_rule_entries"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_rule_entries"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_rules_tenant" ON "accounting_rules" AS PERMISSIVE FOR ALL TO public USING ("accounting_rules"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_rules"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);-- FC-08: rules are append-only versions, the opening is single and frozen, and
-- a posted fact must freeze the rule that produced it. No data backfill.
ALTER TABLE "public"."accounting_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."accounting_rule_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."accounting_openings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."accounting_opening_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A revision is a new row: version grows by one, effective date advances and the
-- event type cannot change. Editing or deleting a rule would silently rewrite
-- history, so both are rejected.
CREATE FUNCTION "public"."accounting_rules_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  previous "public"."accounting_rules"%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Rule changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Recognition rules are append-only; create a new version with its own effective date'
      USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 507));
  SELECT * INTO previous FROM "public"."accounting_rules" r
    WHERE r.company_id = NEW.company_id AND r.code = NEW.code
    ORDER BY r.version DESC LIMIT 1;
  IF previous.id IS NOT NULL THEN
    IF NEW.supersedes_id IS NULL OR NEW.supersedes_id <> previous.id THEN
      RAISE EXCEPTION 'A new rule version must supersede the current one' USING ERRCODE = '23514';
    END IF;
    IF NEW.version <> previous.version + 1 THEN
      RAISE EXCEPTION 'Rule version must increase by exactly one' USING ERRCODE = '23514';
    END IF;
    IF NEW.effective_from <= previous.effective_from THEN
      RAISE EXCEPTION 'A rule version needs a later effective date' USING ERRCODE = '23514';
    END IF;
    IF NEW.event_type <> previous.event_type THEN
      RAISE EXCEPTION 'Rule event type is immutable across versions' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.supersedes_id IS NOT NULL THEN
      RAISE EXCEPTION 'The first rule version cannot supersede another' USING ERRCODE = '23514';
    END IF;
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'The first rule version must be 1' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER accounting_rules_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_rules"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_rules_guard"();--> statement-breakpoint
-- Entries of a version are immutable and must map to accounts usable at the
-- rule effective date. Missing accounts are caught again on posting.
CREATE FUNCTION "public"."accounting_rule_entries_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  target "public"."accounting_rules"%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Rule changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Rule entries are immutable; create a new rule version' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 507));
  SELECT * INTO target FROM "public"."accounting_rules" r
    WHERE r.company_id = NEW.company_id AND r.id = NEW.rule_id;
  IF target.id IS NULL THEN
    RAISE EXCEPTION 'Rule not found in this company' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "public"."accounting_accounts" a
    WHERE a.company_id = NEW.company_id AND a.id = NEW.account_id
      AND a.active AND a.postable AND a.valid_from <= target.effective_from
      AND (a.valid_to IS NULL OR a.valid_to >= target.effective_from)) THEN
    RAISE EXCEPTION 'Rule account must be active, postable and valid at the rule effective date'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.cost_center_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "public"."cost_centers" c
      WHERE c.company_id = NEW.company_id AND c.id = NEW.cost_center_id AND c.active) THEN
    RAISE EXCEPTION 'Rule cost center must be active in this company' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER accounting_rule_entries_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_rule_entries"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_rule_entries_guard"();--> statement-breakpoint
-- Posting freezes the applied rule: version must match, the rule must be
-- effective at the accounting date, retired versions are rejected, and every
-- required role must still map to a usable account. A fact without a rule
-- cannot be posted, so a missing rule is visible instead of silently posting.
CREATE FUNCTION "public"."accounting_journals_rule_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  selected "public"."accounting_rules"%ROWTYPE;
  missing_role text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Journal changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF NEW.rule_id IS NULL THEN
    IF NEW.status = 'POSTED' AND NEW.event_type IS NOT NULL THEN
      RAISE EXCEPTION 'A posted fact requires a recognition rule' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO selected FROM "public"."accounting_rules" r
    WHERE r.company_id = NEW.company_id AND r.id = NEW.rule_id;
  IF selected.id IS NULL THEN
    RAISE EXCEPTION 'Rule not found in this company' USING ERRCODE = '23503';
  END IF;
  IF NEW.rule_version IS DISTINCT FROM selected.version THEN
    RAISE EXCEPTION 'Journal rule version does not match the selected rule' USING ERRCODE = '23514';
  END IF;
  IF selected.effective_from > NEW.accounting_date THEN
    RAISE EXCEPTION 'The selected rule is not effective at the accounting date' USING ERRCODE = '23514';
  END IF;
  IF NEW.event_type IS NOT NULL AND NEW.event_type <> selected.event_type THEN
    RAISE EXCEPTION 'Journal fact and rule event type differ' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'POSTED' THEN
    IF NOT selected.active THEN
      RAISE EXCEPTION 'The selected rule version is retired' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "public"."accounting_rule_entries" e
      WHERE e.company_id = NEW.company_id AND e.rule_id = NEW.rule_id) THEN
      RAISE EXCEPTION 'The selected rule has no account mapping' USING ERRCODE = '23514';
    END IF;
    SELECT e.role INTO missing_role FROM "public"."accounting_rule_entries" e
      WHERE e.company_id = NEW.company_id AND e.rule_id = NEW.rule_id AND e.required
        AND NOT EXISTS (SELECT 1 FROM "public"."accounting_accounts" a
          WHERE a.company_id = e.company_id AND a.id = e.account_id
            AND a.active AND a.postable AND a.valid_from <= NEW.accounting_date
            AND (a.valid_to IS NULL OR a.valid_to >= NEW.accounting_date))
      ORDER BY e.role LIMIT 1;
    IF missing_role IS NOT NULL THEN
      RAISE EXCEPTION 'Rule account for role % is not usable at the accounting date', missing_role
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER accounting_journals_rule_validate BEFORE INSERT OR UPDATE ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_journals_rule_guard"();--> statement-breakpoint
-- One opening per company, immutable, dated and sourced as the opening, with no
-- posted history on or before its date.
CREATE FUNCTION "public"."accounting_openings_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  linked "public"."accounting_journals"%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Opening changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'The opening is immutable; correct it with a journal reversal' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 508));
  SELECT * INTO linked FROM "public"."accounting_journals" j
    WHERE j.company_id = NEW.company_id AND j.id = NEW.journal_id;
  IF linked.id IS NULL THEN
    RAISE EXCEPTION 'Opening journal not found in this company' USING ERRCODE = '23503';
  END IF;
  IF linked.source_type IS DISTINCT FROM 'OPENING' OR linked.accounting_date <> NEW.opening_date THEN
    RAISE EXCEPTION 'The opening needs a journal sourced as OPENING and dated as the opening'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."accounting_journals" j
    WHERE j.company_id = NEW.company_id AND j.id <> NEW.journal_id AND j.status = 'POSTED'
      AND j.accounting_date <= NEW.opening_date) THEN
    RAISE EXCEPTION 'The opening cannot overlap posted journals on or before its date'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER accounting_openings_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_openings"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_openings_guard"();--> statement-breakpoint
-- The opening must carry at least one supporting document; checked at commit so
-- the service can insert the opening and its documents in one statement.
CREATE FUNCTION "public"."accounting_openings_documents_check"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "public"."accounting_opening_documents" d
    WHERE d.company_id = NEW.company_id AND d.opening_id = NEW.id) THEN
    RAISE EXCEPTION 'The opening requires at least one supporting document' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER accounting_openings_documents_required AFTER INSERT ON "public"."accounting_openings"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."accounting_openings_documents_check"();--> statement-breakpoint
-- The opening defines the start of the ledger: nothing may be dated on or
-- before it, and posting the opening journal re-checks committed history.
CREATE FUNCTION "public"."accounting_journals_opening_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  opening "public"."accounting_openings"%ROWTYPE;
BEGIN
  SELECT * INTO opening FROM "public"."accounting_openings" o
    WHERE o.company_id = NEW.company_id AND o.journal_id = NEW.id;
  IF opening.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM "public"."accounting_openings" o
      WHERE o.company_id = NEW.company_id AND o.opening_date >= NEW.accounting_date) THEN
      RAISE EXCEPTION 'Journals cannot be dated on or before the opening' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> 'POSTED' THEN
    RETURN NEW;
  END IF;
  IF opening.opening_date <> NEW.accounting_date THEN
    RAISE EXCEPTION 'The opening journal date must match the opening date' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."accounting_journals" j
    WHERE j.company_id = NEW.company_id AND j.id <> NEW.id AND j.status = 'POSTED'
      AND j.accounting_date <= opening.opening_date) THEN
    RAISE EXCEPTION 'The opening cannot overlap posted journals on or before its date'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER accounting_journals_opening_validate BEFORE INSERT OR UPDATE ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_journals_opening_guard"();--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT ON "public"."accounting_rules", "public"."accounting_rule_entries",
      "public"."accounting_openings", "public"."accounting_opening_documents" TO pulso_app;
  END IF;
END $$;