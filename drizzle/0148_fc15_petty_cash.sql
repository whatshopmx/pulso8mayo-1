CREATE TABLE "accounting_petty_cash_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"payment_run_item_id" uuid,
	"kind" text NOT NULL,
	"voucher_key" text,
	"declared_by" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_petty_cash_kind_check" CHECK (("accounting_petty_cash_facts"."kind" = 'OUT' AND "accounting_petty_cash_facts"."payment_run_item_id" IS NULL AND "accounting_petty_cash_facts"."voucher_key" IS NOT NULL)
    OR ("accounting_petty_cash_facts"."kind" = 'REPLENISHMENT' AND "accounting_petty_cash_facts"."payment_run_item_id" IS NOT NULL AND "accounting_petty_cash_facts"."voucher_key" IS NULL)),
	CONSTRAINT "accounting_petty_cash_voucher_check" CHECK ("accounting_petty_cash_facts"."voucher_key" IS NULL OR ("accounting_petty_cash_facts"."voucher_key" = upper(btrim("accounting_petty_cash_facts"."voucher_key"))
    AND length("accounting_petty_cash_facts"."voucher_key") BETWEEN 3 AND 160
    AND "accounting_petty_cash_facts"."voucher_key" !~* '^(https?|s3|file|blob|data)://'
    AND left("accounting_petty_cash_facts"."voucher_key", 1) <> '/'
    AND "accounting_petty_cash_facts"."voucher_key" !~* '\.(png|jpe?g|webp|gif|pdf)(\?.*)?$')),
	CONSTRAINT "accounting_petty_cash_snapshot_check" CHECK (jsonb_typeof("accounting_petty_cash_facts"."snapshot") = 'object')
);
--> statement-breakpoint
ALTER TABLE "accounting_petty_cash_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_events" DROP CONSTRAINT "accounting_events_source_check";--> statement-breakpoint
ALTER TABLE "operating_expenses" ADD COLUMN "voucher_reference" text;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "voucher_reference" text;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "tax_amount" integer;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "business_date" date;--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD COLUMN "payment_run_item_id" uuid;--> statement-breakpoint
ALTER TABLE "accounting_petty_cash_facts" ADD CONSTRAINT "accounting_petty_cash_facts_event_id_accounting_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."accounting_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_petty_cash_facts" ADD CONSTRAINT "accounting_petty_cash_facts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_petty_cash_facts" ADD CONSTRAINT "accounting_petty_cash_facts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_petty_cash_facts" ADD CONSTRAINT "accounting_petty_cash_facts_fund_id_petty_cash_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."petty_cash_funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_petty_cash_facts" ADD CONSTRAINT "accounting_petty_cash_facts_transaction_id_petty_cash_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."petty_cash_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_petty_cash_facts" ADD CONSTRAINT "accounting_petty_cash_facts_payment_run_item_id_payment_run_items_id_fk" FOREIGN KEY ("payment_run_item_id") REFERENCES "public"."payment_run_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_petty_cash_facts" ADD CONSTRAINT "accounting_petty_cash_facts_declared_by_users_id_fk" FOREIGN KEY ("declared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_petty_cash_event_unique" ON "accounting_petty_cash_facts" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_petty_cash_tx_unique" ON "accounting_petty_cash_facts" USING btree ("company_id","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_petty_cash_item_unique" ON "accounting_petty_cash_facts" USING btree ("company_id","payment_run_item_id") WHERE "accounting_petty_cash_facts"."payment_run_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "accounting_petty_cash_voucher_idx" ON "accounting_petty_cash_facts" USING btree ("company_id","voucher_key");--> statement-breakpoint
ALTER TABLE "petty_cash_transactions" ADD CONSTRAINT "petty_cash_transactions_payment_run_item_id_payment_run_items_id_fk" FOREIGN KEY ("payment_run_item_id") REFERENCES "public"."payment_run_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_source_check" CHECK (("accounting_events"."source_type" = 'OPERATING_EXPENSE' AND "accounting_events"."event_type" = 'EXPENSE_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'EXPENSE_PAYMENT' AND "accounting_events"."event_type" = 'EXPENSE_PAYMENT')
    OR ("accounting_events"."source_type" = 'DAILY_SALES_CUT' AND "accounting_events"."event_type" = 'SALE_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'SALES_REFUND' AND "accounting_events"."event_type" = 'SALE_REFUNDED')
    OR ("accounting_events"."source_type" = 'GATEWAY_SETTLEMENT' AND "accounting_events"."event_type" = 'SETTLEMENT_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'RECEIVING_REPORT' AND "accounting_events"."event_type" = 'PURCHASE_RECEIVED')
    OR ("accounting_events"."source_type" = 'PURCHASE_INVOICE' AND "accounting_events"."event_type" = 'PURCHASE_INVOICED')
    OR ("accounting_events"."source_type" = 'PURCHASE_CREDIT' AND "accounting_events"."event_type" = 'PURCHASE_CREDITED')
    OR ("accounting_events"."source_type" = 'INVOICE_PAYMENT' AND "accounting_events"."event_type" = 'INVOICE_PAID')
    OR ("accounting_events"."source_type" = 'PAYROLL_PAYSLIP' AND "accounting_events"."event_type" = 'PAYROLL_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'PAYROLL_PAYMENT' AND "accounting_events"."event_type" = 'PAYROLL_PAID')
    OR ("accounting_events"."source_type" = 'PETTY_CASH_OUT' AND "accounting_events"."event_type" = 'PETTY_CASH_EXPENSE')
    OR ("accounting_events"."source_type" = 'PETTY_CASH_REPLENISHMENT' AND "accounting_events"."event_type" = 'PETTY_CASH_REPLENISHED')
    OR ("accounting_events"."source_type" = 'INVENTORY_MOVEMENT' AND "accounting_events"."event_type" IN
      ('INVENTORY_USED','INVENTORY_USAGE_RETURNED','INVENTORY_WASTED','INVENTORY_SHIPPED','INVENTORY_RECEIVED','INVENTORY_TRANSIT_WASTED')));--> statement-breakpoint
CREATE POLICY "accounting_petty_cash_tenant" ON "accounting_petty_cash_facts" AS PERMISSIVE FOR ALL TO public USING ("accounting_petty_cash_facts"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_petty_cash_facts"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);
--> statement-breakpoint
ALTER TABLE "public"."accounting_petty_cash_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_normalize_voucher_key"(raw text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN raw IS NULL THEN NULL ELSE upper(btrim(regexp_replace(raw, '\s+', ' ', 'g'))) END
$$;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_petty_cash_fact_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e record; fund record; tx_row record; payment record; expected jsonb; normalized_key text; concept_key text;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'El hecho de caja chica es inmutable' USING ERRCODE='23514'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Caja chica requiere READ COMMITTED' USING ERRCODE='0A000'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,617));
  SELECT * INTO e FROM "public"."accounting_events" WHERE id=NEW.event_id AND company_id=NEW.company_id;
  SELECT * INTO fund FROM "public"."petty_cash_funds" WHERE id=NEW.fund_id AND company_id=NEW.company_id FOR UPDATE;
  SELECT * INTO tx_row FROM "public"."petty_cash_transactions" WHERE id=NEW.transaction_id AND fund_id=fund.id FOR SHARE;
  IF e.id IS NULL OR fund.id IS NULL OR tx_row.id IS NULL
    OR fund.branch_id<>NEW.branch_id OR e.branch_id IS DISTINCT FROM NEW.branch_id
    OR e.source_id<>tx_row.id OR e.actor_id<>NEW.declared_by OR e.source_version<>1
    OR NOT EXISTS(SELECT 1 FROM "public"."users" WHERE id=NEW.declared_by AND company_id=NEW.company_id AND active AND deleted_at IS NULL)
    OR (NEW.kind,tx_row.type::text,e.source_type,e.event_type) NOT IN
      (('OUT','OUT','PETTY_CASH_OUT','PETTY_CASH_EXPENSE'),('REPLENISHMENT','REPLENISHMENT','PETTY_CASH_REPLENISHMENT','PETTY_CASH_REPLENISHED')) THEN
    RAISE EXCEPTION 'El movimiento de caja chica no corresponde al hecho y empresa' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='OUT' THEN
    normalized_key:="public"."accounting_normalize_voucher_key"(tx_row.voucher_reference);
    IF tx_row.amount<=0 OR tx_row.tax_amount IS NULL OR tx_row.tax_amount<0 OR tx_row.tax_amount>=tx_row.amount
      OR tx_row.business_date IS NULL OR e.accounting_date IS DISTINCT FROM tx_row.business_date
      OR normalized_key IS NULL OR normalized_key IS DISTINCT FROM NEW.voucher_key THEN
      RAISE EXCEPTION 'La salida de caja chica requiere fecha, comprobante e impuesto documentados' USING ERRCODE='23514';
    END IF;
    expected:=jsonb_build_object('kind','OUT','transactionId',tx_row.id,'fundId',fund.id,'branchId',fund.branch_id,
      'amountCents',tx_row.amount,'taxCents',tx_row.tax_amount,'costCenterId',tx_row.cost_center_id,
      'voucherKey',NEW.voucher_key,'accountingDate',tx_row.business_date);
  ELSE
    concept_key:=lower(btrim(regexp_replace(coalesce(tx_row.concept,''), '\s+', ' ', 'g')));
    IF concept_key IN ('apertura del fondo de caja chica','reapertura del fondo de caja chica') THEN
      RAISE EXCEPTION 'La apertura o reapertura del fondo no se contabiliza como reposicion' USING ERRCODE='23514';
    END IF;
    SELECT i.id,i.amount_cents,i.settlement_status,i.settled_at,i.settlement_reference,pr.source_bank_account_id
      INTO payment FROM "public"."payment_run_items" i
      JOIN "public"."payment_runs" pr ON pr.id=i.payment_run_id AND pr.company_id=NEW.company_id
      WHERE i.id=NEW.payment_run_item_id AND i.item_type='PETTY_CASH_REIMBURSEMENT' AND i.reference_id=fund.id::text;
    IF payment.id IS NULL OR tx_row.payment_run_item_id IS DISTINCT FROM payment.id
      OR payment.settlement_status<>'CONFIRMED' OR payment.settled_at IS NULL
      OR nullif(btrim(payment.settlement_reference),'') IS NULL
      OR payment.amount_cents<>tx_row.amount OR tx_row.amount<=0
      OR e.accounting_date IS DISTINCT FROM coalesce(tx_row.business_date,payment.settled_at::date) THEN
      RAISE EXCEPTION 'La reposicion de caja chica no esta confirmada contra su partida de tesoreria' USING ERRCODE='23514';
    END IF;
    expected:=jsonb_build_object('kind','REPLENISHMENT','transactionId',tx_row.id,'fundId',fund.id,'branchId',fund.branch_id,
      'paymentRunItemId',payment.id,'amountCents',tx_row.amount,'bankAccountId',payment.source_bank_account_id,
      'accountingDate',e.accounting_date);
  END IF;
  IF NEW.snapshot IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'El snapshot de caja chica no coincide con el movimiento y fecha congelados' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_petty_cash_fact_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_petty_cash_facts"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_petty_cash_fact_guard"();
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_petty_cash_expected_lines"(s jsonb)
RETURNS TABLE(role text,debit bigint,credit bigint) LANGUAGE sql IMMUTABLE AS $$
  SELECT v.role,greatest(v.amount,0),greatest(-v.amount,0) FROM (
    SELECT 'EXPENSE' role,(s->>'amountCents')::bigint-(s->>'taxCents')::bigint amount WHERE s->>'kind'='OUT'
    UNION ALL SELECT 'RECOVERABLE_TAX',(s->>'taxCents')::bigint WHERE s->>'kind'='OUT'
    UNION ALL SELECT 'PETTY_CASH',-(s->>'amountCents')::bigint WHERE s->>'kind'='OUT'
    UNION ALL SELECT 'PETTY_CASH',(s->>'amountCents')::bigint WHERE s->>'kind'='REPLENISHMENT'
    UNION ALL SELECT 'PAYMENT_SOURCE',-(s->>'amountCents')::bigint WHERE s->>'kind'='REPLENISHMENT'
  ) v WHERE v.amount<>0
$$;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_petty_cash_post_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f record; exp_key text;
BEGIN
  IF NEW.status<>'POSTED' OR OLD.status<>'DRAFT' THEN RETURN NEW; END IF;
  IF NEW.reversal_of_id IS NOT NULL AND EXISTS(SELECT 1 FROM "public"."accounting_journals"
    WHERE id=NEW.reversal_of_id AND company_id=NEW.company_id AND source_type IN ('PETTY_CASH_OUT','PETTY_CASH_REPLENISHMENT')) THEN
    RAISE EXCEPTION 'La correccion de caja chica requiere revisar el movimiento y su comprobante' USING ERRCODE='23514'; END IF;
  IF NEW.source_type='OPERATING_EXPENSE' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,617));
    SELECT "public"."accounting_normalize_voucher_key"(e.voucher_reference) INTO exp_key
      FROM "public"."operating_expenses" e WHERE e.company_id=NEW.company_id AND e.id::text=NEW.source_id;
    IF exp_key IS NOT NULL THEN
      IF length(exp_key) NOT BETWEEN 3 AND 160 OR exp_key ~* '^(https?|s3|file|blob|data)://'
        OR left(exp_key,1)='/' OR exp_key ~* '\.(png|jpe?g|webp|gif|pdf)(\?.*)?$' THEN
        RAISE EXCEPTION 'Una URL o ruta no es clave documental suficiente para el comprobante' USING ERRCODE='23514';
      END IF;
      IF EXISTS(SELECT 1 FROM "public"."operating_expenses" o WHERE o.company_id=NEW.company_id
          AND o.id::text<>NEW.source_id AND o.status<>'REJECTED'
          AND "public"."accounting_normalize_voucher_key"(o.voucher_reference)=exp_key)
        OR EXISTS(SELECT 1 FROM "public"."petty_cash_transactions" pt JOIN "public"."petty_cash_funds" pf ON pf.id=pt.fund_id
          WHERE pf.company_id=NEW.company_id AND pt.type='OUT'
          AND "public"."accounting_normalize_voucher_key"(pt.voucher_reference)=exp_key)
        OR EXISTS(SELECT 1 FROM "public"."accounting_petty_cash_facts" pcf WHERE pcf.company_id=NEW.company_id AND pcf.voucher_key=exp_key) THEN
        RAISE EXCEPTION 'El comprobante esta duplicado entre gastos operativos y caja chica' USING ERRCODE='23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_type IS NULL OR NEW.source_type NOT IN ('PETTY_CASH_OUT','PETTY_CASH_REPLENISHMENT') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,617));
  SELECT fact.* INTO f FROM "public"."accounting_petty_cash_facts" fact JOIN "public"."accounting_events" e ON e.id=fact.event_id
    WHERE fact.company_id=NEW.company_id AND e.source_type=NEW.source_type AND e.source_id::text=NEW.source_id
      AND e.event_type=NEW.event_type AND e.source_version=NEW.source_version AND e.branch_id IS NOT DISTINCT FROM NEW.branch_id
      AND e.accounting_date=NEW.accounting_date;
  IF f.id IS NULL OR NOT EXISTS(SELECT 1 FROM "public"."users" WHERE id=NEW.posted_by AND company_id=NEW.company_id
    AND active AND deleted_at IS NULL AND role IN ('OWNER','ADMIN','SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'Falta el hecho de caja chica y un publicador autorizado' USING ERRCODE='23514'; END IF;
  IF f.kind='OUT' AND (
    EXISTS(SELECT 1 FROM "public"."operating_expenses" o WHERE o.company_id=NEW.company_id AND o.status<>'REJECTED'
      AND "public"."accounting_normalize_voucher_key"(o.voucher_reference)=f.voucher_key)
    OR EXISTS(SELECT 1 FROM "public"."petty_cash_transactions" pt JOIN "public"."petty_cash_funds" pf ON pf.id=pt.fund_id
      WHERE pf.company_id=NEW.company_id AND pt.id<>f.transaction_id AND pt.type='OUT'
      AND "public"."accounting_normalize_voucher_key"(pt.voucher_reference)=f.voucher_key)
    OR EXISTS(SELECT 1 FROM "public"."accounting_petty_cash_facts" pcf WHERE pcf.company_id=NEW.company_id
      AND pcf.id<>f.id AND pcf.voucher_key=f.voucher_key)
  ) THEN
    RAISE EXCEPTION 'El comprobante esta duplicado entre gastos operativos y caja chica' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM "public"."accounting_journal_lines" WHERE company_id=NEW.company_id AND journal_id=NEW.id)
    <> (SELECT count(*) FROM "public"."accounting_petty_cash_expected_lines"(f.snapshot)) OR EXISTS (
    SELECT 1 FROM "public"."accounting_petty_cash_expected_lines"(f.snapshot) x WHERE NOT EXISTS (
      SELECT 1 FROM "public"."accounting_journal_lines" l JOIN "public"."accounting_accounts" a ON a.id=l.account_id AND a.company_id=l.company_id
      WHERE l.company_id=NEW.company_id AND l.journal_id=NEW.id AND l.memo='PETTY_CASH:'||x.role
        AND l.debit_cents=x.debit AND l.credit_cents=x.credit
        AND CASE WHEN x.role='EXPENSE' AND f.snapshot->>'costCenterId' IS NOT NULL THEN
          a.kind IN ('EXPENSE','ASSET') AND EXISTS(SELECT 1 FROM "public"."accounting_source_links" link
            JOIN "public"."cost_centers" cc ON cc.company_id=link.company_id AND cc.id=link.cost_center_id
            WHERE link.company_id=NEW.company_id AND link.cost_center_id=(f.snapshot->>'costCenterId')::uuid
              AND link.account_id=l.account_id AND cc.active AND l.cost_center_id=link.cost_center_id)
        WHEN x.role='EXPENSE' THEN
          a.kind='EXPENSE' AND EXISTS(SELECT 1 FROM "public"."accounting_rule_entries" re WHERE re.company_id=NEW.company_id
            AND re.rule_id=NEW.rule_id AND re.role=x.role AND re.account_id=l.account_id AND re.cost_center_id IS NOT DISTINCT FROM l.cost_center_id)
        WHEN x.role='PAYMENT_SOURCE' THEN
          a.kind='ASSET' AND EXISTS(SELECT 1 FROM "public"."accounting_source_links" link
            JOIN "public"."company_bank_accounts" bank ON bank.company_id=link.company_id AND bank.id=link.bank_account_id
            WHERE link.company_id=NEW.company_id AND link.bank_account_id=(f.snapshot->>'bankAccountId')::uuid
              AND link.account_id=l.account_id AND bank.active AND bank.currency='MXN' AND l.cost_center_id IS NULL)
        ELSE
          a.kind='ASSET' AND EXISTS(SELECT 1 FROM "public"."accounting_rule_entries" re WHERE re.company_id=NEW.company_id
            AND re.rule_id=NEW.rule_id AND re.role=x.role AND re.account_id=l.account_id AND re.cost_center_id IS NOT DISTINCT FROM l.cost_center_id)
        END)) THEN
    RAISE EXCEPTION 'Los renglones de caja chica no corresponden al movimiento y regla congelados' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_petty_cash_post_validate BEFORE UPDATE OF status ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_petty_cash_post_guard"();
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_petty_cash_source_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE captured boolean;
BEGIN
  IF TG_TABLE_NAME='petty_cash_transactions' THEN
    SELECT EXISTS(SELECT 1 FROM "public"."accounting_petty_cash_facts" WHERE transaction_id=OLD.id) INTO captured;
    IF captured AND (TG_OP='DELETE' OR (OLD.id,OLD.fund_id,OLD.type,OLD.amount,OLD.concept,OLD.category,
      OLD.cost_center_id,OLD.voucher_reference,OLD.tax_amount,OLD.business_date,OLD.payment_run_item_id) IS DISTINCT FROM
      (NEW.id,NEW.fund_id,NEW.type,NEW.amount,NEW.concept,NEW.category,NEW.cost_center_id,
      NEW.voucher_reference,NEW.tax_amount,NEW.business_date,NEW.payment_run_item_id)) THEN
      RAISE EXCEPTION 'El movimiento de caja chica capturado es inmutable' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='petty_cash_funds' THEN
    SELECT EXISTS(SELECT 1 FROM "public"."accounting_petty_cash_facts" WHERE fund_id=OLD.id) INTO captured;
    IF captured AND (TG_OP='DELETE' OR (OLD.id,OLD.company_id,OLD.branch_id) IS DISTINCT FROM (NEW.id,NEW.company_id,NEW.branch_id)) THEN
      RAISE EXCEPTION 'El fondo de caja chica con hechos contables conserva empresa y sucursal' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT EXISTS(SELECT 1 FROM "public"."accounting_petty_cash_facts" WHERE payment_run_item_id=OLD.id) INTO captured;
    IF captured AND (TG_OP='DELETE' OR (OLD.payment_run_id,OLD.item_type,OLD.reference_id,OLD.amount_cents,
      OLD.settlement_status,OLD.settled_at,OLD.settled_by,OLD.settlement_reference) IS DISTINCT FROM
      (NEW.payment_run_id,NEW.item_type,NEW.reference_id,NEW.amount_cents,NEW.settlement_status,
      NEW.settled_at,NEW.settled_by,NEW.settlement_reference)) THEN
      RAISE EXCEPTION 'La partida de reposicion de caja chica capturada es inmutable' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_petty_cash_tx_freeze BEFORE UPDATE OR DELETE ON "public"."petty_cash_transactions"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_petty_cash_source_guard"();
--> statement-breakpoint
CREATE TRIGGER accounting_petty_cash_fund_freeze BEFORE UPDATE OR DELETE ON "public"."petty_cash_funds"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_petty_cash_source_guard"();
--> statement-breakpoint
CREATE TRIGGER accounting_petty_cash_item_freeze BEFORE UPDATE OR DELETE ON "public"."payment_run_items"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_petty_cash_source_guard"();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pulso_app') THEN
    GRANT SELECT,INSERT ON "public"."accounting_petty_cash_facts" TO pulso_app;
    GRANT SELECT,INSERT,UPDATE(id,current_balance,updated_at) ON "public"."petty_cash_funds" TO pulso_app;
    GRANT SELECT,INSERT,UPDATE(id,tax_amount,voucher_reference,business_date,payment_run_item_id) ON "public"."petty_cash_transactions" TO pulso_app;
    GRANT UPDATE(voucher_reference) ON "public"."operating_expenses" TO pulso_app;
    GRANT SELECT ON "public"."tenant_operating_config" TO pulso_app;
  END IF;
END $$;