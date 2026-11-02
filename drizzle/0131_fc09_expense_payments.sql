CREATE TYPE "public"."expense_payment_source" AS ENUM('MANUAL', 'TREASURY');--> statement-breakpoint
CREATE TYPE "public"."expense_payment_status" AS ENUM('PENDING', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TABLE "expense_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_at" date NOT NULL,
	"payment_method" "expense_payment_method",
	"status" "expense_payment_status" DEFAULT 'PENDING' NOT NULL,
	"source" "expense_payment_source" NOT NULL,
	"payment_run_item_id" uuid,
	"accounting_journal_id" uuid,
	"pending_reason" text,
	"reference" text,
	"failure_reason" text,
	"created_by" text NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expense_payments_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "expense_payments_amount_check" CHECK ("expense_payments"."amount_cents" > 0 AND "expense_payments"."amount_cents" <= 2147483647),
	CONSTRAINT "expense_payments_status_check" CHECK ("expense_payments"."status" IN ('PENDING','CONFIRMED','FAILED')),
	CONSTRAINT "expense_payments_source_check" CHECK ("expense_payments"."source" IN ('MANUAL','TREASURY')),
	CONSTRAINT "expense_payments_settlement_check" CHECK (
        ("expense_payments"."status" = 'PENDING' AND "expense_payments"."confirmed_by" IS NULL AND "expense_payments"."confirmed_at" IS NULL
          AND "expense_payments"."failure_reason" IS NULL)
        OR ("expense_payments"."status" = 'CONFIRMED' AND "expense_payments"."confirmed_by" IS NOT NULL AND "expense_payments"."confirmed_at" IS NOT NULL
          AND "expense_payments"."failure_reason" IS NULL)
        OR ("expense_payments"."status" = 'FAILED' AND "expense_payments"."confirmed_by" IS NULL AND "expense_payments"."confirmed_at" IS NULL
          AND "expense_payments"."failure_reason" IS NOT NULL)),
	CONSTRAINT "expense_payments_source_link_check" CHECK (
        ("expense_payments"."source" = 'TREASURY') = ("expense_payments"."payment_run_item_id" IS NOT NULL)),
	CONSTRAINT "expense_payments_reference_check" CHECK ("expense_payments"."reference" IS NULL OR
        ("expense_payments"."reference" = btrim("expense_payments"."reference") AND length("expense_payments"."reference") BETWEEN 1 AND 200)),
	CONSTRAINT "expense_payments_pending_reason_check" CHECK ("expense_payments"."pending_reason" IS NULL OR
        ("expense_payments"."pending_reason" = btrim("expense_payments"."pending_reason") AND length("expense_payments"."pending_reason") BETWEEN 1 AND 500)),
	CONSTRAINT "expense_payments_failure_reason_check" CHECK ("expense_payments"."failure_reason" IS NULL OR
        ("expense_payments"."failure_reason" = btrim("expense_payments"."failure_reason") AND length("expense_payments"."failure_reason") BETWEEN 1 AND 500)),
	CONSTRAINT "expense_payments_journal_link_check" CHECK (
        "expense_payments"."accounting_journal_id" IS NULL OR "expense_payments"."status" = 'CONFIRMED')
);
--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_payment_run_item_id_payment_run_items_id_fk" FOREIGN KEY ("payment_run_item_id") REFERENCES "public"."payment_run_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_company_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_expense_fk" FOREIGN KEY ("company_id","expense_id") REFERENCES "public"."operating_expenses"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_journal_fk" FOREIGN KEY ("company_id","accounting_journal_id") REFERENCES "public"."accounting_journals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_payments_run_item_unique" ON "expense_payments" USING btree ("company_id","payment_run_item_id") WHERE "expense_payments"."payment_run_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "expense_payments_expense_idx" ON "expense_payments" USING btree ("company_id","expense_id","status");--> statement-breakpoint
-- FC-09: las aplicaciones de pago son append-only, verifican que el gasto y la
-- rama sean de la misma empresa, y solo la transición PENDING → CONFIRMED/FAILED
-- es válida. La suma confirmada nunca excede el importe del gasto (trigger
-- diferido, para registrar varios abonos en una misma transacción).
ALTER TABLE "public"."expense_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."expense_payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "expense_payments_tenant" ON "public"."expense_payments" AS PERMISSIVE FOR ALL TO public
USING ("expense_payments"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid)
WITH CHECK ("expense_payments"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE FUNCTION "public"."expense_payments_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  expense "public"."operating_expenses"%ROWTYPE;
  item "public"."payment_run_items"%ROWTYPE;
  run_company uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Expense payments require READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Expense payments are append-only; settle with a new application' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.id, OLD.company_id, OLD.branch_id, OLD.expense_id, OLD.amount_cents,
        OLD.source, OLD.payment_run_item_id, OLD.created_by, OLD.created_at)
      IS DISTINCT FROM
       (NEW.id, NEW.company_id, NEW.branch_id, NEW.expense_id, NEW.amount_cents,
        NEW.source, NEW.payment_run_item_id, NEW.created_by, NEW.created_at) THEN
      RAISE EXCEPTION 'Expense payment identity and amount are immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'CONFIRMED' THEN
      -- A confirmed fact is immutable. Only recovery metadata may advance:
      -- linking its posted journal and clearing/updating the pending reason.
      IF (OLD.status, OLD.paid_at, OLD.payment_method, OLD.reference, OLD.failure_reason,
          OLD.confirmed_by, OLD.confirmed_at) IS DISTINCT FROM
         (NEW.status, NEW.paid_at, NEW.payment_method, NEW.reference, NEW.failure_reason,
          NEW.confirmed_by, NEW.confirmed_at)
        OR (OLD.accounting_journal_id IS NOT NULL AND
          OLD.accounting_journal_id IS DISTINCT FROM NEW.accounting_journal_id) THEN
        RAISE EXCEPTION 'Confirmed expense payments are immutable' USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.status <> 'PENDING' THEN
      RAISE EXCEPTION 'Only a pending expense payment can be settled' USING ERRCODE = '23514';
    ELSIF NEW.status = 'PENDING' THEN
      RAISE EXCEPTION 'A settled payment cannot return to pending' USING ERRCODE = '23514';
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 509));
  SELECT * INTO expense FROM "public"."operating_expenses" e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.expense_id FOR UPDATE;
  IF expense.id IS NULL THEN
    RAISE EXCEPTION 'Expense payment requires an expense in this company' USING ERRCODE = '23503';
  END IF;
  IF NEW.branch_id <> expense.branch_id THEN
    RAISE EXCEPTION 'Expense payment branch must match the expense branch' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."financial_periods" p WHERE p.company_id = NEW.company_id
    AND p.year = extract(year FROM NEW.paid_at) AND p.month = extract(month FROM NEW.paid_at) AND p.status = 'CLOSED') THEN
    RAISE EXCEPTION 'Expense payment period is closed' USING ERRCODE = '23514';
  END IF;
  IF NEW.paid_at < expense.business_date THEN
    RAISE EXCEPTION 'Expense payment cannot precede expense recognition' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "public"."users" u WHERE u.id = NEW.created_by
    AND u.company_id = NEW.company_id AND u.active AND u.deleted_at IS NULL)
    OR (NEW.confirmed_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "public"."users" u
      WHERE u.id = NEW.confirmed_by AND u.company_id = NEW.company_id AND u.active AND u.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'Expense payment actor must be active in this company' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "public"."branches" b
    WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id AND coalesce(b.active, true)) THEN
    RAISE EXCEPTION 'Expense payment branch must be active in this company' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'CONFIRMED' AND expense.status NOT IN ('APPROVED', 'PAID') THEN
    RAISE EXCEPTION 'Only an approved expense can be paid' USING ERRCODE = '23514';
  END IF;
  IF NEW.source = 'TREASURY' THEN
    SELECT i.id, i.payment_run_id, i.item_type, i.reference_id, i.amount_cents, i.settlement_status
      INTO item.id, item.payment_run_id, item.item_type, item.reference_id, item.amount_cents, item.settlement_status
      FROM "public"."payment_run_items" i
      WHERE i.id = NEW.payment_run_item_id;
    SELECT r.company_id INTO run_company FROM "public"."payment_runs" r WHERE r.id = item.payment_run_id;
    IF item.id IS NULL THEN
      RAISE EXCEPTION 'Expense payment requires its treasury item' USING ERRCODE = '23503';
    END IF;
    IF run_company <> NEW.company_id OR item.item_type <> 'OPERATING_EXPENSE'
      OR item.reference_id <> NEW.expense_id::text THEN
      RAISE EXCEPTION 'Treasury item does not pay this expense in this company' USING ERRCODE = '23514';
    END IF;
    IF item.amount_cents <> NEW.amount_cents THEN
      RAISE EXCEPTION 'Expense payment amount must match its treasury item' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'CONFIRMED' AND item.settlement_status <> 'CONFIRMED' THEN
      RAISE EXCEPTION 'Treasury item must be confirmed before its application' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.accounting_journal_id IS NOT NULL THEN
    IF NEW.status <> 'CONFIRMED' THEN
      RAISE EXCEPTION 'Only a confirmed payment links its journal' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "public"."accounting_journals" j
      WHERE j.company_id = NEW.company_id AND j.id = NEW.accounting_journal_id
        AND j.status = 'POSTED' AND j.source_type = 'EXPENSE_PAYMENT'
        AND j.source_id = NEW.id::text) THEN
      RAISE EXCEPTION 'Expense payment journal must be posted from this application' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER expense_payments_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."expense_payments"
FOR EACH ROW EXECUTE FUNCTION "public"."expense_payments_guard"();--> statement-breakpoint
CREATE FUNCTION "public"."expense_payments_total_guard"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  expense_amount integer;
  confirmed_total bigint;
BEGIN
  IF NEW.status <> 'CONFIRMED' THEN
    RETURN NEW;
  END IF;
  SELECT e.amount INTO expense_amount FROM "public"."operating_expenses" e
    WHERE e.company_id = NEW.company_id AND e.id = NEW.expense_id;
  IF expense_amount IS NULL THEN
    RAISE EXCEPTION 'Expense payment requires an expense in this company' USING ERRCODE = '23503';
  END IF;
  SELECT coalesce(sum(p.amount_cents), 0) INTO confirmed_total
    FROM "public"."expense_payments" p
    WHERE p.company_id = NEW.company_id AND p.expense_id = NEW.expense_id AND p.status = 'CONFIRMED';
  IF confirmed_total > expense_amount THEN
    RAISE EXCEPTION 'Confirmed payments exceed the expense amount' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expense_payments_total_check AFTER INSERT OR UPDATE ON "public"."expense_payments"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."expense_payments_total_guard"();--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "public"."expense_payments" TO pulso_app;
    -- The adapter reads the expense row and locks it before checking the balance.
    -- Only settlement fields may be changed; no INSERT/DELETE or amount edits.
    GRANT SELECT ON "public"."operating_expenses" TO pulso_app;
    GRANT UPDATE (status, paid_at, paid_by, payment_method, updated_at) ON "public"."operating_expenses" TO pulso_app;
    GRANT SELECT (id) ON "public"."financial_periods" TO pulso_app;
    GRANT SELECT (id, payment_run_id, item_type, reference_id, amount_cents, settlement_status) ON "public"."payment_run_items" TO pulso_app;
    GRANT SELECT (id, company_id, status) ON "public"."payment_runs" TO pulso_app;
  END IF;
END $$;
