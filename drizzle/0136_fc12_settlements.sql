CREATE TABLE "accounting_gateway_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"gateway_acquirer" "terminal_acquirer" NOT NULL,
	"sales_destination" text NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_gateway_links_destination_check" CHECK ("accounting_gateway_links"."sales_destination" IN ('CARD','PLATFORM','OTHER'))
);
--> statement-breakpoint
ALTER TABLE "accounting_gateway_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_events" DROP CONSTRAINT "accounting_events_source_check";--> statement-breakpoint
ALTER TABLE "accounting_gateway_links" ADD CONSTRAINT "accounting_gateway_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_gateway_links" ADD CONSTRAINT "accounting_gateway_links_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_gateway_links" ADD CONSTRAINT "accounting_gateway_links_account_company_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."accounting_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_gateway_links_company_acquirer_unique" ON "accounting_gateway_links" USING btree ("company_id","gateway_acquirer");--> statement-breakpoint
CREATE INDEX "accounting_gateway_links_account_idx" ON "accounting_gateway_links" USING btree ("company_id","account_id");--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_source_check" CHECK (("accounting_events"."source_type" = 'OPERATING_EXPENSE' AND "accounting_events"."event_type" = 'EXPENSE_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'EXPENSE_PAYMENT' AND "accounting_events"."event_type" = 'EXPENSE_PAYMENT')
    OR ("accounting_events"."source_type" = 'DAILY_SALES_CUT' AND "accounting_events"."event_type" = 'SALE_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'SALES_REFUND' AND "accounting_events"."event_type" = 'SALE_REFUNDED')
    OR ("accounting_events"."source_type" = 'GATEWAY_SETTLEMENT' AND "accounting_events"."event_type" = 'SETTLEMENT_RECOGNIZED'));--> statement-breakpoint
CREATE POLICY "accounting_gateway_links_tenant" ON "accounting_gateway_links" AS PERMISSIVE FOR ALL TO public USING ("accounting_gateway_links"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_gateway_links"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);
--> statement-breakpoint
ALTER TABLE "public"."accounting_gateway_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The acquirer link is configuration, so it takes the same company configuration
-- lock as every other catalog change and enforces the same shape: an active,
-- postable account of the balance sheet. The destination is declared, never
-- derived from the account code or name.
CREATE FUNCTION "public"."accounting_gateway_links_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE target_kind text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Account link changes require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 505));
  IF TG_OP = 'UPDATE' AND (OLD.id, OLD.company_id, OLD.gateway_acquirer)
    IS DISTINCT FROM (NEW.id, NEW.company_id, NEW.gateway_acquirer) THEN
    RAISE EXCEPTION 'Gateway link identity is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT kind INTO target_kind FROM "public"."accounting_accounts"
    WHERE company_id = NEW.company_id AND id = NEW.account_id AND active AND postable;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link target must be an active postable account' USING ERRCODE = '23514';
  END IF;
  IF target_kind NOT IN ('ASSET','LIABILITY') THEN
    RAISE EXCEPTION 'El vínculo de un adquirente debe apuntar la cuenta por liquidar registrada en el balance' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_gateway_links_validate AFTER INSERT OR UPDATE ON "public"."accounting_gateway_links"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_gateway_links_guard"();
--> statement-breakpoint
-- FC-12: a gateway settlement only clears the "por liquidar" balance that sales
-- cuts actually recognized. Crediting more than the published cuts debited would
-- turn an unsupported deposit into income. Same-table triggers fire in name order,
-- so "capacity" precedes accounting_journals_validate and the company lock 601 is
-- taken before the 505 configuration lock.
CREATE FUNCTION "public"."accounting_capacity_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  line record;
  outstanding bigint;
BEGIN
  IF NEW.status <> 'POSTED' OR OLD.status <> 'DRAFT' OR NEW.source_type IS DISTINCT FROM 'GATEWAY_SETTLEMENT' THEN
    RETURN NEW;
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Las liquidaciones requieren READ COMMITTED para reservar el saldo por liquidar' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 601));
  FOR line IN
    SELECT l.account_id, a.code AS account_code
      FROM "public"."accounting_journal_lines" l
      JOIN "public"."accounting_accounts" a ON a.company_id = l.company_id AND a.id = l.account_id
      WHERE l.company_id = NEW.company_id AND l.journal_id = NEW.id
        AND l.memo = 'SETTLEMENT:RECEIVABLE' AND l.credit_cents > 0
  LOOP
    SELECT coalesce(sum(l.debit_cents::bigint - l.credit_cents::bigint), 0) INTO outstanding
      FROM "public"."accounting_journal_lines" l
      JOIN "public"."accounting_journals" j ON j.company_id = l.company_id AND j.id = l.journal_id
      WHERE l.company_id = NEW.company_id AND l.account_id = line.account_id
        AND (l.memo LIKE 'SALE:%\_RECEIVABLE' OR l.memo = 'SETTLEMENT:RECEIVABLE')
        AND (j.source_type IN ('DAILY_SALES_CUT','SALES_REFUND','GATEWAY_SETTLEMENT')
          OR EXISTS (SELECT 1 FROM "public"."accounting_journals" o
            WHERE o.company_id = j.company_id AND o.id = j.reversal_of_id
              AND o.source_type IN ('DAILY_SALES_CUT','SALES_REFUND','GATEWAY_SETTLEMENT')))
        AND (j.status = 'POSTED' OR j.id = NEW.id);
    IF outstanding < 0 THEN
      RAISE EXCEPTION 'La liquidación excede la cuenta por liquidar % registrada por los cortes', line.account_code
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_capacity_validate BEFORE UPDATE OF "status" ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_capacity_guard"();
--> statement-breakpoint
-- The runtime role writes the acquirer link and reads only the identity, amounts
-- and dates of the settlement fact. Account numbers, card data, descriptions and
-- third-party references stay out of the grant.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "public"."accounting_gateway_links" TO pulso_app;
    GRANT SELECT (id, company_id, branch_id, acquirer, external_id, transaction_date, settlement_date,
      gross_amount_cents, fee_amount_cents, fee_vat_cents, net_amount_cents,
      destination_bank_account_id, status, imported_by) ON "public"."gateway_transactions" TO pulso_app;
    GRANT SELECT (id, company_id, source_bank_account_id, value_date, amount_cents,
      match_status, matched_gateway_transaction_id) ON "public"."bank_transactions" TO pulso_app;
  END IF;
END $$;
