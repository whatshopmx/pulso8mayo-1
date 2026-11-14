ALTER TABLE "payment_run_items" ADD COLUMN "payroll_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payment_run_items" ADD CONSTRAINT "payment_run_items_payroll_snapshot_check" CHECK ("payment_run_items"."payroll_snapshot" IS NULL OR
    ("payment_run_items"."item_type" = 'PAYROLL' AND jsonb_typeof("payment_run_items"."payroll_snapshot") = 'object'
      AND "payment_run_items"."payroll_snapshot"->>'version' = '1'
      AND jsonb_typeof("payment_run_items"."payroll_snapshot"->'receipts') = 'array') IS TRUE);
--> statement-breakpoint
CREATE FUNCTION "public"."fc15_guard_payroll_snapshot"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  source_run record;
  expected_receipts jsonb;
  expected_snapshot jsonb;
  net_total bigint;
  receipt_count integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.payroll_snapshot IS DISTINCT FROM NEW.payroll_snapshot THEN
      RAISE EXCEPTION 'El reparto de nomina es inmutable; prepara una nueva partida' USING ERRCODE='23514';
    END IF;
    IF OLD.payroll_snapshot IS NOT NULL AND
      (OLD.payment_run_id,OLD.item_type,OLD.reference_id,OLD.amount_cents) IS DISTINCT FROM
      (NEW.payment_run_id,NEW.item_type,NEW.reference_id,NEW.amount_cents) THEN
      RAISE EXCEPTION 'La identidad y el importe de nomina estan congelados' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.item_type <> 'PAYROLL' THEN RETURN NEW; END IF;
  IF NEW.payroll_snapshot IS NULL THEN
    RAISE EXCEPTION 'La nueva partida de nomina requiere reparto documentado' USING ERRCODE='23514';
  END IF;
  SELECT p.id,p.company_id,p.period_start,p.period_end,p.status,r.status AS payment_status
    INTO source_run FROM payroll_runs p JOIN payment_runs r ON r.company_id=p.company_id
    WHERE p.id=NEW.reference_id::uuid AND r.id=NEW.payment_run_id FOR UPDATE OF p,r;
  IF NOT FOUND OR source_run.status <> 'COMPLETED' OR source_run.payment_status <> 'DRAFT'
    OR source_run.period_end < source_run.period_start OR NEW.amount_cents <= 0
    OR nullif(current_setting('app.current_company_id',true),'')::uuid IS DISTINCT FROM source_run.company_id THEN
    RAISE EXCEPTION 'Corrida de nomina no elegible en esta empresa' USING ERRCODE='23514';
  END IF;
  -- The parent lock also serializes receipt inserts through their run foreign key.
  PERFORM ps.id FROM payroll_payslips ps WHERE ps.run_id=source_run.id ORDER BY ps.id FOR SHARE;
  PERFORM u.id FROM users u JOIN payroll_payslips ps ON ps.user_id=u.id
    WHERE ps.run_id=source_run.id ORDER BY u.id FOR SHARE OF u;
  IF EXISTS (SELECT 1 FROM payroll_payslips ps LEFT JOIN users u ON u.id=ps.user_id
    LEFT JOIN branches b ON b.id=u.branch_id AND b.company_id=source_run.company_id
    WHERE ps.run_id=source_run.id AND (u.company_id IS DISTINCT FROM source_run.company_id
      OR (u.branch_id IS NOT NULL AND b.id IS NULL)
      OR ps.cfdi_status IS DISTINCT FROM 'TIMBRADO' OR ps.cfdi_uuid IS NULL
      OR ps.cfdi_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR least(ps.base_salary_cents,ps.holiday_pay_cents,ps.overtime_pay_cents,ps.aguinaldo_cents,
        ps.propinas_cents,ps.total_percepciones_cents,ps.total_deducciones_cents) < 0
      OR ps.total_percepciones_cents <= 0 OR ps.total_deducciones_cents > ps.total_percepciones_cents
      OR ps.base_salary_cents::bigint+ps.holiday_pay_cents+ps.overtime_pay_cents+ps.aguinaldo_cents+ps.propinas_cents
        <> ps.total_percepciones_cents)) THEN
    RAISE EXCEPTION 'Recibos de nomina sin confirmacion, pertenencia o importes consistentes' USING ERRCODE='23514';
  END IF;
  SELECT count(*),sum(ps.total_percepciones_cents::bigint-ps.total_deducciones_cents),
    jsonb_agg(jsonb_build_object('payslipId',ps.id,'employeeId',ps.user_id,'branchId',u.branch_id,
      'cfdiUuid',lower(ps.cfdi_uuid),'cfdiStatus',ps.cfdi_status,'baseSalaryCents',ps.base_salary_cents,
      'holidayPayCents',ps.holiday_pay_cents,'overtimePayCents',ps.overtime_pay_cents,
      'aguinaldoCents',ps.aguinaldo_cents,'propinasCents',ps.propinas_cents,
      'totalPercepcionesCents',ps.total_percepciones_cents,'totalDeduccionesCents',ps.total_deducciones_cents) ORDER BY ps.id)
    INTO receipt_count,net_total,expected_receipts
    FROM payroll_payslips ps JOIN users u ON u.id=ps.user_id WHERE ps.run_id=source_run.id;
  IF receipt_count=0 OR receipt_count <> (SELECT count(DISTINCT user_id) FROM payroll_payslips WHERE run_id=source_run.id)
    OR receipt_count <> (SELECT count(DISTINCT lower(cfdi_uuid)) FROM payroll_payslips WHERE run_id=source_run.id)
    OR net_total <> NEW.amount_cents THEN
    RAISE EXCEPTION 'La nomina contiene duplicados o un neto distinto al autorizado' USING ERRCODE='23514';
  END IF;
  expected_snapshot := jsonb_build_object('version',1,'companyId',source_run.company_id,
    'payrollRunId',source_run.id,'periodStart',source_run.period_start,'periodEnd',source_run.period_end,
    'netCents',net_total,'receipts',expected_receipts);
  IF NEW.payroll_snapshot IS DISTINCT FROM expected_snapshot THEN
    RAISE EXCEPTION 'El reparto declarado no coincide con los recibos actuales de nomina' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fc15_payroll_snapshot_guard BEFORE INSERT OR UPDATE ON "public"."payment_run_items"
FOR EACH ROW EXECUTE FUNCTION "public"."fc15_guard_payroll_snapshot"();
--> statement-breakpoint
CREATE FUNCTION "public"."fc15_guard_payroll_company"() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF OLD.company_id IS DISTINCT FROM NEW.company_id AND EXISTS (
    SELECT 1 FROM payment_run_items WHERE payment_run_id=OLD.id AND payroll_snapshot IS NOT NULL) THEN
    RAISE EXCEPTION 'La empresa del reparto de nomina es inmutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER fc15_payroll_company_guard BEFORE UPDATE OF company_id ON "public"."payment_runs"
FOR EACH ROW EXECUTE FUNCTION "public"."fc15_guard_payroll_company"();
