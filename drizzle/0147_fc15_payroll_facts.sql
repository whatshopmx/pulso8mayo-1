CREATE TABLE "accounting_payroll_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"payslip_id" uuid NOT NULL,
	"payment_run_item_id" uuid,
	"kind" text NOT NULL,
	"declared_by" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_payroll_kind_check" CHECK (("accounting_payroll_facts"."kind" = 'RECOGNITION' AND "accounting_payroll_facts"."payment_run_item_id" IS NULL)
    OR ("accounting_payroll_facts"."kind" = 'PAYMENT' AND "accounting_payroll_facts"."payment_run_item_id" IS NOT NULL)),
	CONSTRAINT "accounting_payroll_snapshot_check" CHECK (jsonb_typeof("accounting_payroll_facts"."snapshot") = 'object')
);
--> statement-breakpoint
ALTER TABLE "accounting_payroll_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_events" DROP CONSTRAINT "accounting_events_source_check";--> statement-breakpoint
ALTER TABLE "accounting_events" ALTER COLUMN "branch_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounting_payroll_facts" ADD CONSTRAINT "accounting_payroll_facts_event_id_accounting_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."accounting_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payroll_facts" ADD CONSTRAINT "accounting_payroll_facts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payroll_facts" ADD CONSTRAINT "accounting_payroll_facts_payroll_run_id_payroll_runs_id_fk" FOREIGN KEY ("payroll_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payroll_facts" ADD CONSTRAINT "accounting_payroll_facts_payslip_id_payroll_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payroll_payslips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payroll_facts" ADD CONSTRAINT "accounting_payroll_facts_payment_run_item_id_payment_run_items_id_fk" FOREIGN KEY ("payment_run_item_id") REFERENCES "public"."payment_run_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_payroll_facts" ADD CONSTRAINT "accounting_payroll_facts_declared_by_users_id_fk" FOREIGN KEY ("declared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_payroll_event_unique" ON "accounting_payroll_facts" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_payroll_recognition_unique" ON "accounting_payroll_facts" USING btree ("company_id","payslip_id") WHERE "accounting_payroll_facts"."kind" = 'RECOGNITION';--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_payroll_payment_unique" ON "accounting_payroll_facts" USING btree ("company_id","payment_run_item_id","payslip_id") WHERE "accounting_payroll_facts"."kind" = 'PAYMENT';--> statement-breakpoint
CREATE INDEX "accounting_payroll_run_idx" ON "accounting_payroll_facts" USING btree ("company_id","payroll_run_id");--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_branch_required_check" CHECK ("accounting_events"."branch_id" IS NOT NULL OR "accounting_events"."source_type" IN ('PAYROLL_PAYSLIP','PAYROLL_PAYMENT'));--> statement-breakpoint
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
    OR ("accounting_events"."source_type" = 'INVENTORY_MOVEMENT' AND "accounting_events"."event_type" IN
      ('INVENTORY_USED','INVENTORY_USAGE_RETURNED','INVENTORY_WASTED','INVENTORY_SHIPPED','INVENTORY_RECEIVED','INVENTORY_TRANSIT_WASTED')));--> statement-breakpoint
CREATE POLICY "accounting_payroll_tenant" ON "accounting_payroll_facts" AS PERMISSIVE FOR ALL TO public USING ("accounting_payroll_facts"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_payroll_facts"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);
--> statement-breakpoint
ALTER TABLE "public"."accounting_payroll_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Preserve the existing outbox contract; only payroll can explicitly be corporate.
CREATE OR REPLACE FUNCTION "public"."accounting_events_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "public"."branches" WHERE id=NEW.branch_id AND company_id=NEW.company_id) THEN
    RAISE EXCEPTION 'La sucursal no pertenece a la empresa del hecho' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Los hechos contables no se eliminan' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.id,NEW.company_id,NEW.branch_id,NEW.source_type,NEW.source_id,NEW.event_type,
    NEW.source_version,NEW.actor_id,NEW.accounting_date,NEW.created_at) IS DISTINCT FROM
    (OLD.id,OLD.company_id,OLD.branch_id,OLD.source_type,OLD.source_id,OLD.event_type,OLD.source_version,
    OLD.actor_id,OLD.accounting_date,OLD.created_at) OR (OLD.status='POSTED' AND NEW IS DISTINCT FROM OLD)) THEN
    RAISE EXCEPTION 'La identidad del hecho y su publicacion son inmutables' USING ERRCODE='23514';
  END IF;
  IF NEW.journal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "public"."accounting_journals" j
    WHERE j.company_id=NEW.company_id AND j.id=NEW.journal_id AND j.status='POSTED'
      AND j.source_type=NEW.source_type AND j.source_id=NEW.source_id::text
      AND j.event_type=NEW.event_type AND j.source_version=NEW.source_version) THEN
    RAISE EXCEPTION 'La poliza no corresponde al hecho publicado' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_payroll_receipt"(receipt_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('payslipId',p.id,'employeeId',p.user_id,'branchId',u.branch_id,
    'cfdiUuid',lower(p.cfdi_uuid),'cfdiStatus',p.cfdi_status,'baseSalaryCents',p.base_salary_cents,
    'holidayPayCents',p.holiday_pay_cents,'overtimePayCents',p.overtime_pay_cents,'aguinaldoCents',p.aguinaldo_cents,
    'propinasCents',p.propinas_cents,'totalPercepcionesCents',p.total_percepciones_cents,
    'totalDeduccionesCents',p.total_deducciones_cents)
  FROM "public"."payroll_payslips" p JOIN "public"."users" u ON u.id=p.user_id WHERE p.id=receipt_id
$$;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_payroll_fact_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e record; r record; p record; payment record; receipt jsonb; expected jsonb; net bigint;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'El hecho de nomina es inmutable' USING ERRCODE='23514'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Nomina requiere READ COMMITTED' USING ERRCODE='0A000'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,616));
  SELECT * INTO e FROM "public"."accounting_events" WHERE id=NEW.event_id AND company_id=NEW.company_id;
  SELECT * INTO r FROM "public"."payroll_runs" WHERE id=NEW.payroll_run_id AND company_id=NEW.company_id FOR UPDATE;
  SELECT * INTO p FROM "public"."payroll_payslips" WHERE id=NEW.payslip_id AND run_id=r.id FOR SHARE;
  IF e.id IS NULL OR r.id IS NULL OR p.id IS NULL OR e.actor_id<>NEW.declared_by OR e.source_version<>1
    OR NOT EXISTS(SELECT 1 FROM "public"."users" WHERE id=NEW.declared_by AND company_id=NEW.company_id AND active AND deleted_at IS NULL)
    OR (NEW.kind,e.source_type,e.event_type) NOT IN
      (('RECOGNITION','PAYROLL_PAYSLIP','PAYROLL_RECOGNIZED'),('PAYMENT','PAYROLL_PAYMENT','PAYROLL_PAID')) THEN
    RAISE EXCEPTION 'El recibo no corresponde al hecho y empresa' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='RECOGNITION' THEN
    receipt:="public"."accounting_payroll_receipt"(NEW.payslip_id);
    IF r.status<>'COMPLETED' OR p.cfdi_status IS DISTINCT FROM 'TIMBRADO' OR p.cfdi_uuid IS NULL
      OR p.cfdi_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR e.source_id<>p.id OR e.accounting_date IS DISTINCT FROM r.period_end
      OR NOT EXISTS(SELECT 1 FROM "public"."users" WHERE id=p.user_id AND company_id=NEW.company_id)
      OR (SELECT count(*) FROM "public"."payroll_payslips" WHERE run_id=r.id AND
        (user_id=p.user_id OR lower(cfdi_uuid)=lower(p.cfdi_uuid)))<>1
      OR least(p.base_salary_cents,p.holiday_pay_cents,p.overtime_pay_cents,p.aguinaldo_cents,
        p.propinas_cents,p.total_percepciones_cents,p.total_deducciones_cents)<0
      OR p.total_percepciones_cents<=0 OR p.total_deducciones_cents>p.total_percepciones_cents
      OR p.base_salary_cents::bigint+p.holiday_pay_cents+p.overtime_pay_cents+p.aguinaldo_cents+p.propinas_cents<>p.total_percepciones_cents THEN
      RAISE EXCEPTION 'La nomina no esta confirmada con importes consistentes' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM "public"."accounting_payroll_facts" f JOIN "public"."payroll_runs" old_run ON old_run.id=f.payroll_run_id
      WHERE f.company_id=NEW.company_id AND f.kind='RECOGNITION' AND f.snapshot->'receipt'->>'employeeId'=p.user_id
        AND f.payroll_run_id<>r.id AND (old_run.aguinaldo_fiscal_year IS NULL)=(r.aguinaldo_fiscal_year IS NULL)
        AND old_run.period_start<=r.period_end AND old_run.period_end>=r.period_start) THEN
      RAISE EXCEPTION 'Otro recibo ya reconoce este empleado y periodo; requiere revision de solapamiento' USING ERRCODE='23514';
    END IF;
    net:=p.total_percepciones_cents::bigint-p.total_deducciones_cents;
    expected:=jsonb_build_object('kind',NEW.kind,'periodStart',r.period_start,'periodEnd',r.period_end,
      'receipt',receipt,'amountCents',net,'bankAccountId',NULL);
  ELSE
    SELECT i.id,i.settlement_status,i.settled_at,i.settlement_reference,i.payroll_snapshot,pr.source_bank_account_id
      INTO payment FROM "public"."payment_run_items" i
      JOIN "public"."payment_runs" pr ON pr.id=i.payment_run_id AND pr.company_id=NEW.company_id
      WHERE i.id=NEW.payment_run_item_id AND i.item_type='PAYROLL' AND i.reference_id=r.id::text;
    SELECT value INTO receipt FROM jsonb_array_elements(payment.payroll_snapshot->'receipts')
      WHERE value->>'payslipId'=NEW.payslip_id::text;
    net:=(receipt->>'totalPercepcionesCents')::bigint-(receipt->>'totalDeduccionesCents')::bigint;
    IF payment.id IS NULL OR receipt IS NULL OR payment.settlement_status<>'CONFIRMED'
      OR payment.settled_at IS NULL OR nullif(btrim(payment.settlement_reference),'') IS NULL
      OR payment.payroll_snapshot->>'companyId'<>NEW.company_id::text OR e.source_id<>NEW.id
      OR e.accounting_date IS DISTINCT FROM payment.settled_at::date OR net<=0 THEN
      RAISE EXCEPTION 'La aplicacion de nomina no esta confirmada contra el reparto autorizado' USING ERRCODE='23514';
    END IF;
    expected:=jsonb_build_object('kind',NEW.kind,'periodStart',payment.payroll_snapshot->>'periodStart',
      'periodEnd',payment.payroll_snapshot->>'periodEnd','receipt',receipt,'amountCents',net,'bankAccountId',payment.source_bank_account_id);
  END IF;
  IF e.branch_id IS DISTINCT FROM (receipt->>'branchId')::uuid OR NEW.snapshot IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'La valoracion no corresponde al recibo y fecha congelados' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_payroll_fact_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_payroll_facts"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_payroll_fact_guard"();
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_payroll_expected_lines"(s jsonb)
RETURNS TABLE(role text,debit bigint,credit bigint) LANGUAGE sql IMMUTABLE AS $$
  SELECT v.role,greatest(v.amount,0),greatest(-v.amount,0) FROM (
    SELECT 'PAYROLL_EXPENSE' role,(s->'receipt'->>'totalPercepcionesCents')::bigint-(s->'receipt'->>'propinasCents')::bigint amount WHERE s->>'kind'='RECOGNITION'
    UNION ALL SELECT 'TIPS_PAYABLE',(s->'receipt'->>'propinasCents')::bigint WHERE s->>'kind'='RECOGNITION'
    UNION ALL SELECT 'PAYROLL_PAYABLE',-(s->>'amountCents')::bigint WHERE s->>'kind'='RECOGNITION'
    UNION ALL SELECT 'PAYROLL_DEDUCTIONS',-(s->'receipt'->>'totalDeduccionesCents')::bigint WHERE s->>'kind'='RECOGNITION'
    UNION ALL SELECT 'PAYROLL_PAYABLE',(s->>'amountCents')::bigint WHERE s->>'kind'='PAYMENT'
    UNION ALL SELECT 'PAYMENT_SOURCE',-(s->>'amountCents')::bigint WHERE s->>'kind'='PAYMENT'
  ) v WHERE v.amount<>0
$$;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_payroll_post_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f record; original record; paid bigint; tips_balance numeric;
BEGIN
  IF NEW.status<>'POSTED' OR OLD.status<>'DRAFT' THEN RETURN NEW; END IF;
  IF NEW.reversal_of_id IS NOT NULL AND EXISTS(SELECT 1 FROM "public"."accounting_journals"
    WHERE id=NEW.reversal_of_id AND company_id=NEW.company_id AND source_type IN ('PAYROLL_PAYSLIP','PAYROLL_PAYMENT')) THEN
    RAISE EXCEPTION 'La correccion de nomina requiere revisar recibos y pagos vinculados' USING ERRCODE='23514'; END IF;
  IF NEW.source_type IS NULL OR NEW.source_type NOT IN ('PAYROLL_PAYSLIP','PAYROLL_PAYMENT') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,616));
  SELECT fact.* INTO f FROM "public"."accounting_payroll_facts" fact JOIN "public"."accounting_events" e ON e.id=fact.event_id
    WHERE fact.company_id=NEW.company_id AND e.source_type=NEW.source_type AND e.source_id::text=NEW.source_id
      AND e.event_type=NEW.event_type AND e.source_version=NEW.source_version AND e.branch_id IS NOT DISTINCT FROM NEW.branch_id
      AND e.accounting_date=NEW.accounting_date;
  IF f.id IS NULL OR NOT EXISTS(SELECT 1 FROM "public"."users" WHERE id=NEW.posted_by AND company_id=NEW.company_id
    AND active AND deleted_at IS NULL AND role IN ('OWNER','ADMIN','SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'Falta el hecho de nomina y un publicador autorizado' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM "public"."accounting_journal_lines" WHERE company_id=NEW.company_id AND journal_id=NEW.id)
    <> (SELECT count(*) FROM "public"."accounting_payroll_expected_lines"(f.snapshot)) OR EXISTS (
    SELECT 1 FROM "public"."accounting_payroll_expected_lines"(f.snapshot) x WHERE NOT EXISTS (
      SELECT 1 FROM "public"."accounting_journal_lines" l JOIN "public"."accounting_accounts" a ON a.id=l.account_id AND a.company_id=l.company_id
      WHERE l.company_id=NEW.company_id AND l.journal_id=NEW.id AND l.memo='PAYROLL:'||x.role
        AND l.debit_cents=x.debit AND l.credit_cents=x.credit
        AND a.kind=CASE WHEN x.role='PAYROLL_EXPENSE' THEN 'EXPENSE' WHEN x.role='PAYMENT_SOURCE' THEN 'ASSET' ELSE 'LIABILITY' END
        AND CASE WHEN x.role='PAYMENT_SOURCE' THEN EXISTS(SELECT 1 FROM "public"."accounting_source_links" link
          JOIN "public"."company_bank_accounts" bank ON bank.company_id=link.company_id AND bank.id=link.bank_account_id
          WHERE link.company_id=NEW.company_id AND link.bank_account_id=(f.snapshot->>'bankAccountId')::uuid
            AND link.account_id=l.account_id AND bank.active AND bank.currency='MXN' AND l.cost_center_id IS NULL)
        ELSE EXISTS(SELECT 1 FROM "public"."accounting_rule_entries" re WHERE re.company_id=NEW.company_id
          AND re.rule_id=NEW.rule_id AND re.role=x.role AND re.account_id=l.account_id AND re.cost_center_id IS NOT DISTINCT FROM l.cost_center_id) END)) THEN
    RAISE EXCEPTION 'Los renglones de nomina no corresponden al recibo y regla congelados' USING ERRCODE='23514';
  END IF;
  IF f.kind='PAYMENT' THEN
    SELECT pf.* INTO original FROM "public"."accounting_payroll_facts" pf JOIN "public"."accounting_events" e ON e.id=pf.event_id AND e.status='POSTED'
      WHERE pf.company_id=NEW.company_id AND pf.payslip_id=f.payslip_id AND pf.kind='RECOGNITION';
    SELECT coalesce(sum((pf.snapshot->>'amountCents')::bigint),0) INTO paid FROM "public"."accounting_payroll_facts" pf
      JOIN "public"."accounting_events" e ON e.id=pf.event_id AND e.status='POSTED'
      WHERE pf.company_id=NEW.company_id AND pf.payslip_id=f.payslip_id AND pf.kind='PAYMENT';
    IF original.id IS NULL OR original.snapshot->'receipt' IS DISTINCT FROM f.snapshot->'receipt'
      OR paid+(f.snapshot->>'amountCents')::bigint>(original.snapshot->>'amountCents')::bigint OR NOT EXISTS (
      SELECT 1 FROM "public"."accounting_events" e JOIN "public"."accounting_journal_lines" old_line ON old_line.journal_id=e.journal_id
      JOIN "public"."accounting_journal_lines" new_line ON new_line.journal_id=NEW.id AND new_line.company_id=NEW.company_id
      WHERE e.id=original.event_id AND old_line.company_id=NEW.company_id AND old_line.memo='PAYROLL:PAYROLL_PAYABLE'
        AND new_line.memo=old_line.memo AND new_line.account_id=old_line.account_id AND new_line.cost_center_id IS NOT DISTINCT FROM old_line.cost_center_id) THEN
      RAISE EXCEPTION 'El pago excede o no coincide con la obligacion original de nomina' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT coalesce(sum(l.credit_cents-l.debit_cents),0) INTO tips_balance FROM "public"."accounting_journal_lines" l
      JOIN "public"."accounting_journals" j ON j.id=l.journal_id AND j.company_id=l.company_id AND j.status='POSTED' AND j.accounting_date<=NEW.accounting_date
      WHERE l.company_id=NEW.company_id AND l.account_id IN (SELECT account_id FROM "public"."accounting_journal_lines"
        WHERE journal_id=NEW.id AND memo='PAYROLL:TIPS_PAYABLE');
    IF tips_balance<(f.snapshot->'receipt'->>'propinasCents')::bigint THEN
      RAISE EXCEPTION 'Falta el pasivo original de propinas; no se crea otro gasto' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_payroll_post_validate BEFORE UPDATE OF status ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_payroll_post_guard"();
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_payroll_source_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE captured boolean;
BEGIN
  IF TG_TABLE_NAME='payroll_payslips' THEN
    SELECT EXISTS(SELECT 1 FROM "public"."accounting_payroll_facts" WHERE payslip_id=OLD.id) INTO captured;
    IF captured AND (TG_OP='DELETE' OR (OLD.id,OLD.run_id,OLD.user_id,OLD.base_salary_cents,OLD.holiday_pay_cents,
      OLD.overtime_pay_cents,OLD.aguinaldo_cents,OLD.propinas_cents,OLD.total_percepciones_cents,OLD.total_deducciones_cents,OLD.cfdi_uuid)
      IS DISTINCT FROM (NEW.id,NEW.run_id,NEW.user_id,NEW.base_salary_cents,NEW.holiday_pay_cents,NEW.overtime_pay_cents,
      NEW.aguinaldo_cents,NEW.propinas_cents,NEW.total_percepciones_cents,NEW.total_deducciones_cents,NEW.cfdi_uuid)) THEN
      RAISE EXCEPTION 'El recibo capturado conserva identidad e importes; requiere correccion auditada' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='payroll_runs' THEN
    SELECT EXISTS(SELECT 1 FROM "public"."accounting_payroll_facts" WHERE payroll_run_id=OLD.id) OR EXISTS (
      SELECT 1 FROM "public"."payment_run_items" WHERE item_type='PAYROLL' AND reference_id=OLD.id::text AND payroll_snapshot IS NOT NULL) INTO captured;
    IF captured AND (TG_OP='DELETE' OR (OLD.id,OLD.company_id,OLD.period_start,OLD.period_end,OLD.aguinaldo_fiscal_year)
      IS DISTINCT FROM (NEW.id,NEW.company_id,NEW.period_start,NEW.period_end,NEW.aguinaldo_fiscal_year)) THEN
      RAISE EXCEPTION 'La corrida capturada conserva empresa y periodo' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT EXISTS(SELECT 1 FROM "public"."accounting_payroll_facts" WHERE payment_run_item_id=OLD.id) INTO captured;
    IF captured AND (TG_OP='DELETE' OR (OLD.payment_run_id,OLD.item_type,OLD.reference_id,OLD.amount_cents,
      OLD.settlement_status,OLD.settled_at,OLD.settled_by,OLD.settlement_reference,OLD.payroll_snapshot) IS DISTINCT FROM
      (NEW.payment_run_id,NEW.item_type,NEW.reference_id,NEW.amount_cents,NEW.settlement_status,
      NEW.settled_at,NEW.settled_by,NEW.settlement_reference,NEW.payroll_snapshot)) THEN
      RAISE EXCEPTION 'El pago de nomina capturado es inmutable' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_payroll_receipt_freeze BEFORE UPDATE OR DELETE ON "public"."payroll_payslips"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_payroll_source_guard"();
--> statement-breakpoint
CREATE TRIGGER accounting_payroll_run_freeze BEFORE UPDATE OR DELETE ON "public"."payroll_runs"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_payroll_source_guard"();
--> statement-breakpoint
CREATE TRIGGER accounting_payroll_payment_freeze BEFORE UPDATE OR DELETE ON "public"."payment_run_items"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_payroll_source_guard"();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pulso_app') THEN
    GRANT SELECT,INSERT ON "public"."accounting_payroll_facts" TO pulso_app;
    GRANT SELECT ON "public"."payroll_runs","public"."payroll_payslips" TO pulso_app;
    -- Row locks need UPDATE on a column, not permission to rewrite salary fields.
    GRANT UPDATE(id) ON "public"."payroll_runs","public"."payroll_payslips" TO pulso_app;
    GRANT SELECT(settled_at,settlement_reference,payroll_snapshot),INSERT(payroll_snapshot) ON "public"."payment_run_items" TO pulso_app;
  END IF;
END $$;
