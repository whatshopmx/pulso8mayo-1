CREATE TABLE "accounting_purchase_facts" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"receiving_report_id" uuid NOT NULL,
	"invoice_id" uuid,
	"kind" text NOT NULL,
	"document_reference" text NOT NULL,
	"declared_by" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_purchase_facts_kind_check" CHECK ("accounting_purchase_facts"."kind" IN ('RECEIPT','INVOICE','CREDIT','PAYMENT')),
	CONSTRAINT "accounting_purchase_facts_reference_check" CHECK (length(btrim("accounting_purchase_facts"."document_reference")) BETWEEN 1 AND 200),
	CONSTRAINT "accounting_purchase_facts_snapshot_check" CHECK (jsonb_typeof("accounting_purchase_facts"."snapshot") = 'object')
);
--> statement-breakpoint
ALTER TABLE "accounting_purchase_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_events" DROP CONSTRAINT "accounting_events_source_check";--> statement-breakpoint
ALTER TABLE "accounting_purchase_facts" ADD CONSTRAINT "accounting_purchase_facts_event_id_accounting_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."accounting_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_purchase_facts" ADD CONSTRAINT "accounting_purchase_facts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_purchase_facts" ADD CONSTRAINT "accounting_purchase_facts_declared_by_users_id_fk" FOREIGN KEY ("declared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounting_purchase_facts_receipt_idx" ON "accounting_purchase_facts" USING btree ("company_id","receiving_report_id");--> statement-breakpoint
CREATE INDEX "accounting_purchase_facts_invoice_idx" ON "accounting_purchase_facts" USING btree ("company_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_purchase_facts_one_invoice_idx" ON "accounting_purchase_facts" USING btree ("company_id","receiving_report_id") WHERE "accounting_purchase_facts"."kind" = 'INVOICE';--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_source_check" CHECK (("accounting_events"."source_type" = 'OPERATING_EXPENSE' AND "accounting_events"."event_type" = 'EXPENSE_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'EXPENSE_PAYMENT' AND "accounting_events"."event_type" = 'EXPENSE_PAYMENT')
    OR ("accounting_events"."source_type" = 'DAILY_SALES_CUT' AND "accounting_events"."event_type" = 'SALE_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'SALES_REFUND' AND "accounting_events"."event_type" = 'SALE_REFUNDED')
    OR ("accounting_events"."source_type" = 'GATEWAY_SETTLEMENT' AND "accounting_events"."event_type" = 'SETTLEMENT_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'RECEIVING_REPORT' AND "accounting_events"."event_type" = 'PURCHASE_RECEIVED')
    OR ("accounting_events"."source_type" = 'PURCHASE_INVOICE' AND "accounting_events"."event_type" = 'PURCHASE_INVOICED')
    OR ("accounting_events"."source_type" = 'PURCHASE_CREDIT' AND "accounting_events"."event_type" = 'PURCHASE_CREDITED')
    OR ("accounting_events"."source_type" = 'INVOICE_PAYMENT' AND "accounting_events"."event_type" = 'INVOICE_PAID'));--> statement-breakpoint
CREATE POLICY "accounting_purchase_facts_tenant" ON "accounting_purchase_facts" AS PERMISSIVE FOR ALL TO public USING ("accounting_purchase_facts"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_purchase_facts"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);
--> statement-breakpoint
ALTER TABLE "public"."accounting_purchase_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_purchase_fact_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e record; r record; i record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'La valoración documentada es inmutable' USING ERRCODE='23514';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Compras requieren READ COMMITTED' USING ERRCODE='0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 614));
  SELECT * INTO e FROM "public"."accounting_events" WHERE id=NEW.event_id AND company_id=NEW.company_id;
  SELECT * INTO r FROM "public"."receiving_reports" WHERE id=NEW.receiving_report_id AND company_id=NEW.company_id;
  IF e.id IS NULL OR r.id IS NULL OR e.branch_id<>r.branch_id OR e.accounting_date IS NULL
    OR NEW.kind IS DISTINCT FROM NEW.snapshot->>'kind'
    OR NOT EXISTS (SELECT 1 FROM "public"."users" WHERE id=NEW.declared_by AND company_id=NEW.company_id AND active AND deleted_at IS NULL)
    OR (NEW.kind, e.source_type, e.event_type) NOT IN (
      ('RECEIPT','RECEIVING_REPORT','PURCHASE_RECEIVED'), ('INVOICE','PURCHASE_INVOICE','PURCHASE_INVOICED'),
      ('CREDIT','PURCHASE_CREDIT','PURCHASE_CREDITED'), ('PAYMENT','INVOICE_PAYMENT','INVOICE_PAID')) THEN
    RAISE EXCEPTION 'El documento no corresponde al hecho o a su empresa/sucursal' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='RECEIPT' THEN
    IF e.source_id<>r.id OR NEW.invoice_id IS NOT NULL THEN
      RAISE EXCEPTION 'Origen de recepción inválido' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT id,receiving_report_id,branch_id,supplier_id,subtotal,tax_amount,total INTO i FROM "public"."invoices" WHERE id=NEW.invoice_id AND company_id=NEW.company_id;
    IF i.id IS NULL OR i.receiving_report_id IS DISTINCT FROM r.id OR i.branch_id IS DISTINCT FROM r.branch_id
      OR i.supplier_id IS DISTINCT FROM r.supplier_id THEN
      RAISE EXCEPTION 'Factura y recepción no corresponden' USING ERRCODE='23514';
    END IF;
    IF NEW.kind='INVOICE' AND e.source_id<>i.id THEN
      RAISE EXCEPTION 'Origen de factura inválido' USING ERRCODE='23514';
    ELSIF NEW.kind='CREDIT' AND NOT EXISTS (
      SELECT 1 FROM "public"."credit_notes" c WHERE c.id=e.source_id AND c.company_id=NEW.company_id AND c.invoice_id=i.id) THEN
      RAISE EXCEPTION 'La nota de crédito no corresponde a la factura' USING ERRCODE='23514';
    ELSIF NEW.kind='PAYMENT' AND NOT EXISTS (
      SELECT 1 FROM "public"."payment_run_items" p JOIN "public"."payment_runs" pr ON pr.id=p.payment_run_id
      WHERE p.id=e.source_id AND pr.company_id=NEW.company_id AND p.item_type='INVOICE' AND p.reference_id=i.id::text
        AND p.settlement_status='CONFIRMED' AND p.amount_cents=(NEW.snapshot->>'amountCents')::bigint) THEN
      RAISE EXCEPTION 'El pago no está confirmado para esta factura' USING ERRCODE='23514';
    END IF;
    IF NEW.kind='INVOICE' AND ((NEW.snapshot->>'netCents')::bigint IS DISTINCT FROM i.subtotal::bigint
      OR (NEW.snapshot->>'taxCents')::bigint IS DISTINCT FROM i.tax_amount::bigint
      OR (NEW.snapshot->>'totalCents')::bigint IS DISTINCT FROM i.total::bigint) THEN
      RAISE EXCEPTION 'Los importes congelados no corresponden a la factura' USING ERRCODE='23514';
    END IF;
    IF NEW.kind='CREDIT' AND ((NEW.snapshot->>'creditTreatment') IS NULL
      OR (NEW.snapshot->>'creditTreatment') NOT IN ('RETURN','PRICE_ADJUSTMENT')
      OR ((NEW.snapshot->>'creditTreatment')='RETURN' AND jsonb_array_length(coalesce(NEW.snapshot->'returnMovementIds','[]'))=0)
      OR ((NEW.snapshot->>'creditTreatment')='PRICE_ADJUSTMENT' AND jsonb_array_length(coalesce(NEW.snapshot->'returnMovementIds','[]'))<>0)) THEN
      RAISE EXCEPTION 'La nota requiere clasificación explícita y movimientos de devolución cuando corresponda' USING ERRCODE='23514';
    END IF;
    IF NEW.kind='CREDIT' AND NOT EXISTS (SELECT 1 FROM "public"."credit_notes" c WHERE c.id=e.source_id AND c.company_id=NEW.company_id
      AND c.subtotal=(NEW.snapshot->>'netCents')::bigint AND c.tax_amount=(NEW.snapshot->>'taxCents')::bigint
      AND c.total=(NEW.snapshot->>'totalCents')::bigint) THEN
      RAISE EXCEPTION 'Los importes congelados no corresponden a la nota de crédito' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.kind='CREDIT' AND EXISTS (
    SELECT 1 FROM "public"."accounting_purchase_facts" f,
      jsonb_array_elements_text(coalesce(f.snapshot->'returnMovementIds','[]')) old_id,
      jsonb_array_elements_text(coalesce(NEW.snapshot->'returnMovementIds','[]')) new_id
    WHERE f.company_id=NEW.company_id AND f.event_id<>NEW.event_id AND old_id.value=new_id.value) THEN
    RAISE EXCEPTION 'La devolución física ya respalda otra nota de crédito' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_purchase_fact_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_purchase_facts"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_purchase_fact_guard"();
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_purchase_expected_lines"(s jsonb)
RETURNS TABLE(role text,debit bigint,credit bigint) LANGUAGE sql IMMUTABLE AS $$
  SELECT v.role,greatest(v.amount,0),greatest(-v.amount,0) FROM (
    SELECT 'INVENTORY'::text AS role,(s->>'receivedCents')::bigint AS amount WHERE s->>'kind'='RECEIPT'
    UNION ALL SELECT 'RECEIVING_PENDING',-(s->>'receivedCents')::bigint WHERE s->>'kind'='RECEIPT'
    UNION ALL SELECT 'RECEIVING_PENDING',(s->>'receivedCents')::bigint WHERE s->>'kind'='INVOICE'
    UNION ALL SELECT 'PURCHASE_VARIANCE',(s->>'netCents')::bigint-(s->>'receivedCents')::bigint WHERE s->>'kind'='INVOICE'
    UNION ALL SELECT 'RECOVERABLE_TAX',(s->>'taxCents')::bigint WHERE s->>'kind'='INVOICE'
    UNION ALL SELECT 'PAYABLE',-(s->>'totalCents')::bigint WHERE s->>'kind'='INVOICE'
    UNION ALL SELECT 'PAYABLE',(s->>'totalCents')::bigint WHERE s->>'kind'='CREDIT'
    UNION ALL SELECT 'INVENTORY',-(s->>'returnedCents')::bigint WHERE s->>'kind'='CREDIT'
    UNION ALL SELECT 'PURCHASE_VARIANCE',(s->>'returnedCents')::bigint-(s->>'netCents')::bigint WHERE s->>'kind'='CREDIT'
    UNION ALL SELECT 'RECOVERABLE_TAX',-(s->>'taxCents')::bigint WHERE s->>'kind'='CREDIT'
    UNION ALL SELECT 'PAYABLE',(s->>'amountCents')::bigint WHERE s->>'kind'='PAYMENT'
    UNION ALL SELECT 'PAYMENT_SOURCE',-(s->>'amountCents')::bigint WHERE s->>'kind'='PAYMENT'
  ) v WHERE v.amount<>0
$$;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_purchase_capacity_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f record; original record; used_total bigint; used_net bigint; used_tax bigint; used_return bigint; cash_paid bigint;
BEGIN
  IF NEW.status<>'POSTED' OR OLD.status<>'DRAFT' THEN RETURN NEW; END IF;
  IF NEW.reversal_of_id IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."accounting_journals" j
    WHERE j.id=NEW.reversal_of_id AND j.company_id=NEW.company_id
      AND j.source_type IN ('RECEIVING_REPORT','PURCHASE_INVOICE','PURCHASE_CREDIT','INVOICE_PAYMENT')) THEN
    RAISE EXCEPTION 'La corrección de compras requiere revisar documentos, devoluciones y pagos vinculados' USING ERRCODE='23514';
  END IF;
  IF NEW.source_type IS NULL OR NEW.source_type NOT IN ('RECEIVING_REPORT','PURCHASE_INVOICE','PURCHASE_CREDIT','INVOICE_PAYMENT') THEN RETURN NEW; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Compras requieren READ COMMITTED' USING ERRCODE='0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,614));
  SELECT p.* INTO f FROM "public"."accounting_purchase_facts" p JOIN "public"."accounting_events" e ON e.id=p.event_id
    WHERE p.company_id=NEW.company_id AND e.source_type=NEW.source_type AND e.source_id::text=NEW.source_id
      AND e.event_type=NEW.event_type AND e.source_version=NEW.source_version
      AND e.branch_id=NEW.branch_id AND e.accounting_date=NEW.accounting_date;
  IF f.event_id IS NULL THEN RAISE EXCEPTION 'Falta la valoración documentada del hecho' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "public"."accounting_rules" r WHERE r.id=NEW.rule_id AND r.company_id=NEW.company_id
      AND r.event_type=NEW.event_type AND r.version=NEW.rule_version AND r.effective_from<=NEW.accounting_date AND r.active)
    OR (SELECT count(*) FROM "public"."accounting_journal_lines" l WHERE l.company_id=NEW.company_id AND l.journal_id=NEW.id)
      <> (SELECT count(*) FROM "public"."accounting_purchase_expected_lines"(f.snapshot))
    OR EXISTS (SELECT 1 FROM "public"."accounting_purchase_expected_lines"(f.snapshot) x WHERE NOT EXISTS (
      SELECT 1 FROM "public"."accounting_journal_lines" l
      JOIN "public"."accounting_accounts" a ON a.company_id=l.company_id AND a.id=l.account_id
      WHERE l.company_id=NEW.company_id AND l.journal_id=NEW.id AND l.memo='PURCHASE:'||x.role
        AND l.debit_cents=x.debit AND l.credit_cents=x.credit
        AND a.kind=CASE WHEN x.role IN ('PAYABLE','RECEIVING_PENDING') THEN 'LIABILITY'
          WHEN x.role='PURCHASE_VARIANCE' THEN 'EXPENSE' ELSE 'ASSET' END
        AND (CASE WHEN f.kind='PAYMENT' AND x.role='PAYMENT_SOURCE' THEN EXISTS (
          SELECT 1 FROM "public"."accounting_source_links" b
          JOIN "public"."company_bank_accounts" ba ON ba.id=b.bank_account_id AND ba.company_id=b.company_id
          WHERE b.company_id=NEW.company_id AND b.bank_account_id=(f.snapshot->>'bankAccountId')::uuid
            AND b.account_id=l.account_id AND ba.active AND ba.currency='MXN' AND l.cost_center_id IS NULL)
        ELSE EXISTS (SELECT 1 FROM "public"."accounting_rule_entries" re WHERE re.company_id=NEW.company_id
          AND re.rule_id=NEW.rule_id AND re.role=x.role AND re.account_id=l.account_id AND re.cost_center_id IS NOT DISTINCT FROM l.cost_center_id) END))) THEN
    RAISE EXCEPTION 'Los renglones de compra no corresponden al documento y regla congelados' USING ERRCODE='23514';
  END IF;
  IF f.kind<>'RECEIPT' AND NOT EXISTS (
    SELECT 1 FROM "public"."accounting_purchase_facts" p JOIN "public"."accounting_events" e ON e.id=p.event_id
    WHERE p.company_id=NEW.company_id AND p.receiving_report_id=f.receiving_report_id AND p.kind='RECEIPT' AND e.status='POSTED') THEN
    RAISE EXCEPTION 'Falta la recepción original publicada' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."accounting_journal_lines" l WHERE l.company_id=NEW.company_id AND l.journal_id=NEW.id
    AND ((f.kind='INVOICE' AND l.memo='PURCHASE:RECEIVING_PENDING')
      OR (f.kind='CREDIT' AND l.memo IN ('PURCHASE:PAYABLE','PURCHASE:RECOVERABLE_TAX','PURCHASE:INVENTORY'))
      OR (f.kind='PAYMENT' AND l.memo='PURCHASE:PAYABLE'))
    AND NOT EXISTS (SELECT 1 FROM "public"."accounting_purchase_facts" p
      JOIN "public"."accounting_events" e ON e.id=p.event_id AND e.status='POSTED'
      JOIN "public"."accounting_journal_lines" old_line ON old_line.journal_id=e.journal_id AND old_line.company_id=NEW.company_id
      WHERE p.company_id=NEW.company_id AND p.receiving_report_id=f.receiving_report_id
        AND ((p.kind='RECEIPT' AND l.memo IN ('PURCHASE:RECEIVING_PENDING','PURCHASE:INVENTORY'))
          OR (p.kind='INVOICE' AND p.invoice_id=f.invoice_id AND l.memo IN ('PURCHASE:PAYABLE','PURCHASE:RECOVERABLE_TAX')))
        AND old_line.memo=l.memo AND old_line.account_id=l.account_id AND old_line.cost_center_id IS NOT DISTINCT FROM l.cost_center_id)) THEN
    RAISE EXCEPTION 'Las cuentas de la compra no coinciden con la obligación original' USING ERRCODE='23514';
  END IF;
  IF f.kind IN ('CREDIT','PAYMENT') THEN
    SELECT p.* INTO original FROM "public"."accounting_purchase_facts" p
      JOIN "public"."accounting_events" e ON e.id=p.event_id
      JOIN "public"."accounting_journals" j ON j.id=e.journal_id AND j.status='POSTED'
      WHERE p.company_id=NEW.company_id AND p.invoice_id=f.invoice_id AND p.kind='INVOICE';
    IF original.event_id IS NULL THEN RAISE EXCEPTION 'Falta la obligación original publicada' USING ERRCODE='23514'; END IF;
    SELECT coalesce(sum(CASE WHEN p.kind='PAYMENT' THEN (p.snapshot->>'amountCents')::bigint ELSE (p.snapshot->>'totalCents')::bigint END),0),
      coalesce(sum(CASE WHEN p.kind='CREDIT' THEN (p.snapshot->>'netCents')::bigint ELSE 0 END),0),
      coalesce(sum(CASE WHEN p.kind='CREDIT' THEN (p.snapshot->>'taxCents')::bigint ELSE 0 END),0),
      coalesce(sum(CASE WHEN p.kind='CREDIT' THEN (p.snapshot->>'returnedCents')::bigint ELSE 0 END),0)
      INTO used_total,used_net,used_tax,used_return
      FROM "public"."accounting_purchase_facts" p JOIN "public"."accounting_events" e ON e.id=p.event_id
      JOIN "public"."accounting_journals" j ON j.id=e.journal_id AND j.status='POSTED'
      WHERE p.company_id=NEW.company_id AND p.invoice_id=f.invoice_id AND p.kind IN ('CREDIT','PAYMENT');
    used_total:=used_total+CASE WHEN f.kind='PAYMENT' THEN (f.snapshot->>'amountCents')::bigint ELSE (f.snapshot->>'totalCents')::bigint END;
    IF f.kind='CREDIT' THEN
      used_net:=used_net+(f.snapshot->>'netCents')::bigint;
      used_tax:=used_tax+(f.snapshot->>'taxCents')::bigint;
      used_return:=used_return+(f.snapshot->>'returnedCents')::bigint;
      SELECT coalesce(sum(p.amount_cents::bigint),0) INTO cash_paid FROM "public"."payment_run_items" p
        JOIN "public"."payment_runs" r ON r.id=p.payment_run_id AND r.company_id=NEW.company_id
        WHERE p.item_type='INVOICE' AND p.reference_id=f.invoice_id::text AND p.settlement_status='CONFIRMED';
      IF cash_paid+used_net+used_tax>(original.snapshot->>'totalCents')::bigint THEN
        RAISE EXCEPTION 'El crédito excede el saldo después de pagos confirmados' USING ERRCODE='23514';
      END IF;
    END IF;
    IF used_total>(original.snapshot->>'totalCents')::bigint OR used_net>(original.snapshot->>'netCents')::bigint
      OR used_tax>(original.snapshot->>'taxCents')::bigint OR used_return>(original.snapshot->>'receivedCents')::bigint THEN
      RAISE EXCEPTION 'El pago o devolución excede la obligación original' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_purchase_capacity_validate BEFORE UPDATE OF status ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_purchase_capacity_guard"();
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_purchase_source_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE captured boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(OLD.company_id::text,614));
  IF TG_TABLE_NAME='invoices' THEN
    SELECT EXISTS(SELECT 1 FROM "public"."accounting_purchase_facts" p
      WHERE p.company_id=OLD.company_id AND p.invoice_id=OLD.id) INTO captured;
    IF captured AND (TG_OP='DELETE' OR (OLD.company_id,OLD.branch_id,OLD.supplier_id,OLD.receiving_report_id,
      OLD.fecha,OLD.subtotal,OLD.tax_amount,OLD.total,OLD.currency) IS DISTINCT FROM
      (NEW.company_id,NEW.branch_id,NEW.supplier_id,NEW.receiving_report_id,NEW.fecha,NEW.subtotal,NEW.tax_amount,NEW.total,NEW.currency)) THEN
      RAISE EXCEPTION 'La factura contabilizada conserva identidad e importes; requiere corrección auditada' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='credit_notes' THEN
    SELECT EXISTS(SELECT 1 FROM "public"."accounting_purchase_facts" p JOIN "public"."accounting_events" e ON e.id=p.event_id
      WHERE p.company_id=OLD.company_id AND p.kind='CREDIT' AND e.source_id=OLD.id) INTO captured;
    IF captured AND (TG_OP='DELETE' OR (OLD.company_id,OLD.invoice_id,OLD.fecha,OLD.subtotal,OLD.tax_amount,OLD.total,OLD.currency)
      IS DISTINCT FROM (NEW.company_id,NEW.invoice_id,NEW.fecha,NEW.subtotal,NEW.tax_amount,NEW.total,NEW.currency)) THEN
      RAISE EXCEPTION 'La nota de crédito contabilizada conserva identidad e importes' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_purchase_invoice_freeze BEFORE UPDATE OR DELETE ON "public"."invoices"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_purchase_source_guard"();
--> statement-breakpoint
CREATE TRIGGER accounting_purchase_credit_freeze BEFORE UPDATE OR DELETE ON "public"."credit_notes"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_purchase_source_guard"();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pulso_app') THEN
    GRANT SELECT,INSERT ON "public"."accounting_purchase_facts" TO pulso_app;
    GRANT SELECT ON "public"."receiving_reports", "public"."receiving_report_items", "public"."invoice_lines", "public"."inventory_movements" TO pulso_app;
    GRANT SELECT (id,company_id,branch_id,supplier_id,receiving_report_id,purchase_order_id,fecha,subtotal,tax_amount,total,currency,
      match_status,payment_status,sat_status,exception_approved_by,exception_approved_at,exception_reason) ON "public"."invoices" TO pulso_app;
    GRANT SELECT (id,company_id,invoice_id,subtotal,tax_amount,total,currency,fecha,reason) ON "public"."credit_notes" TO pulso_app;
    GRANT SELECT (id,item_id,branch_id,initial_quantity,unit_cost,status,supplier_batch_info) ON "public"."inventory_batches" TO pulso_app;
    GRANT SELECT (id,company_id) ON "public"."suppliers" TO pulso_app;
    GRANT SELECT (id,company_id) ON "public"."inventory_items" TO pulso_app;
    GRANT UPDATE (payment_status,paid_at,paid_by) ON "public"."invoices" TO pulso_app;
  END IF;
END $$;
