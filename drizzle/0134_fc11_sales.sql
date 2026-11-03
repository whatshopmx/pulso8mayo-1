CREATE TABLE "accounting_sales_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cut_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"original_id" uuid,
	"business_date" date NOT NULL,
	"shift" text NOT NULL,
	"channel" text NOT NULL,
	"total_cents" integer NOT NULL,
	"cash_cents" integer NOT NULL,
	"card_cents" integer NOT NULL,
	"platform_cents" integer NOT NULL,
	"other_cents" integer NOT NULL,
	"revenue_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"tax_cents" integer NOT NULL,
	"tips_cents" integer NOT NULL,
	"document_reference" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_sales_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "accounting_sales_kind_check" CHECK (("accounting_sales_documents"."kind" = 'SALE' AND "accounting_sales_documents"."version" >= 1
      AND (("accounting_sales_documents"."version" = 1) = ("accounting_sales_documents"."original_id" IS NULL)))
      OR ("accounting_sales_documents"."kind" = 'REFUND' AND "accounting_sales_documents"."version" = 1 AND "accounting_sales_documents"."original_id" IS NOT NULL)),
	CONSTRAINT "accounting_sales_scope_check" CHECK ("accounting_sales_documents"."shift" IN ('MATUTINO','VESPERTINO','COMPLETO')
      AND "accounting_sales_documents"."channel" IN ('TOTAL','SALON','DELIVERY','EVENTOS')),
	CONSTRAINT "accounting_sales_amounts_check" CHECK ("accounting_sales_documents"."total_cents" > 0 AND "accounting_sales_documents"."cash_cents" >= 0 AND "accounting_sales_documents"."card_cents" >= 0
      AND "accounting_sales_documents"."platform_cents" >= 0 AND "accounting_sales_documents"."other_cents" >= 0 AND "accounting_sales_documents"."revenue_cents" >= "accounting_sales_documents"."discount_cents"
      AND "accounting_sales_documents"."discount_cents" >= 0 AND "accounting_sales_documents"."tax_cents" >= 0 AND "accounting_sales_documents"."tips_cents" >= 0
      AND "accounting_sales_documents"."total_cents"::bigint = "accounting_sales_documents"."cash_cents"::bigint + "accounting_sales_documents"."card_cents" + "accounting_sales_documents"."platform_cents" + "accounting_sales_documents"."other_cents"
      AND "accounting_sales_documents"."total_cents"::bigint = "accounting_sales_documents"."revenue_cents"::bigint - "accounting_sales_documents"."discount_cents" + "accounting_sales_documents"."tax_cents" + "accounting_sales_documents"."tips_cents"),
	CONSTRAINT "accounting_sales_reference_check" CHECK (length(btrim("accounting_sales_documents"."document_reference")) BETWEEN 1 AND 200
      AND length(btrim("accounting_sales_documents"."reason")) BETWEEN 5 AND 500)
);
--> statement-breakpoint
ALTER TABLE "accounting_sales_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_events" DROP CONSTRAINT "accounting_events_source_check";--> statement-breakpoint
ALTER TABLE "accounting_events" DROP CONSTRAINT "accounting_events_version_check";--> statement-breakpoint
ALTER TABLE "accounting_sales_documents" ADD CONSTRAINT "accounting_sales_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sales_documents" ADD CONSTRAINT "accounting_sales_documents_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sales_documents" ADD CONSTRAINT "accounting_sales_documents_cut_id_daily_sales_cuts_id_fk" FOREIGN KEY ("cut_id") REFERENCES "public"."daily_sales_cuts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sales_documents" ADD CONSTRAINT "accounting_sales_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_sales_documents" ADD CONSTRAINT "accounting_sales_original_fk" FOREIGN KEY ("company_id","original_id") REFERENCES "public"."accounting_sales_documents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_sales_cut_version_unique" ON "accounting_sales_documents" USING btree ("company_id","cut_id","version") WHERE "accounting_sales_documents"."kind" = 'SALE';--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_sales_replacement_unique" ON "accounting_sales_documents" USING btree ("company_id","original_id") WHERE "accounting_sales_documents"."kind" = 'SALE';--> statement-breakpoint
CREATE INDEX "accounting_sales_scope_idx" ON "accounting_sales_documents" USING btree ("company_id","branch_id","business_date");--> statement-breakpoint
CREATE INDEX "accounting_sales_original_idx" ON "accounting_sales_documents" USING btree ("company_id","original_id");--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_source_check" CHECK (("accounting_events"."source_type" = 'OPERATING_EXPENSE' AND "accounting_events"."event_type" = 'EXPENSE_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'EXPENSE_PAYMENT' AND "accounting_events"."event_type" = 'EXPENSE_PAYMENT')
    OR ("accounting_events"."source_type" = 'DAILY_SALES_CUT' AND "accounting_events"."event_type" = 'SALE_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'SALES_REFUND' AND "accounting_events"."event_type" = 'SALE_REFUNDED'));--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_version_check" CHECK ("accounting_events"."source_version" >= 1
    AND ("accounting_events"."source_type" = 'DAILY_SALES_CUT' OR "accounting_events"."source_version" = 1));--> statement-breakpoint
CREATE POLICY "accounting_sales_tenant" ON "accounting_sales_documents" AS PERMISSIVE FOR ALL TO public USING ("accounting_sales_documents"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_sales_documents"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);
--> statement-breakpoint
ALTER TABLE "public"."accounting_sales_documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_sales_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source "public"."daily_sales_cuts"%ROWTYPE;
  original "public"."accounting_sales_documents"%ROWTYPE;
  amount_column text;
  returned bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'El documento contable de venta es inmutable' USING ERRCODE = '23514';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Las declaraciones requieren READ COMMITTED para reservar saldos actuales' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 601));
  IF NOT EXISTS (SELECT 1 FROM "public"."branches" b WHERE b.id = NEW.branch_id
    AND b.company_id = NEW.company_id AND b.active AND b.ownership_type = 'OWNED')
    OR NOT EXISTS (SELECT 1 FROM "public"."users" u WHERE u.id = NEW.created_by
      AND u.company_id = NEW.company_id AND u.active AND u.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Empresa, sucursal o actor inválidos' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."financial_periods" p WHERE p.company_id=NEW.company_id
    AND p.year=extract(year from NEW.business_date) AND p.month=extract(month from NEW.business_date) AND p.status='CLOSED') THEN
    RAISE EXCEPTION 'El periodo está cerrado' USING ERRCODE='23514';
  END IF;
  SELECT * INTO source FROM "public"."daily_sales_cuts" c WHERE c.id = NEW.cut_id AND c.company_id = NEW.company_id;
  IF NOT FOUND OR source.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'El corte no pertenece a esta empresa y sucursal' USING ERRCODE = '23514';
  END IF;
  IF NEW.original_id IS NOT NULL THEN
    SELECT * INTO original FROM "public"."accounting_sales_documents" d
      WHERE d.id = NEW.original_id AND d.company_id = NEW.company_id;
    IF NOT FOUND OR original.kind <> 'SALE' OR original.branch_id <> NEW.branch_id OR original.cut_id <> NEW.cut_id
      OR (NEW.kind = 'SALE' AND NEW.version <> original.version + 1)
      OR (NEW.kind = 'REFUND' AND (NEW.business_date < original.business_date
        OR NEW.shift <> original.shift OR NEW.channel <> original.channel)) THEN
      RAISE EXCEPTION 'La corrección no corresponde a la venta original' USING ERRCODE = '23514';
    END IF;
    FOREACH amount_column IN ARRAY ARRAY['total_cents','cash_cents','card_cents','platform_cents',
      'other_cents','revenue_cents','discount_cents','tax_cents','tips_cents'] LOOP
      IF NEW.kind = 'REFUND' THEN
        SELECT coalesce(sum((to_jsonb(d)->>amount_column)::bigint),0) INTO returned
          FROM "public"."accounting_sales_documents" d
          WHERE d.company_id = NEW.company_id AND d.original_id = original.id AND d.kind = 'REFUND';
        IF returned + (to_jsonb(NEW)->>amount_column)::bigint > (to_jsonb(original)->>amount_column)::bigint THEN
          RAISE EXCEPTION 'La devolución excede el saldo del componente %', amount_column USING ERRCODE = '23514';
        END IF;
      ELSIF amount_column NOT IN ('revenue_cents','discount_cents') THEN
        SELECT coalesce(sum((to_jsonb(d)->>amount_column)::bigint),0) INTO returned
          FROM "public"."accounting_sales_documents" d
          JOIN "public"."accounting_events" e ON e.company_id = d.company_id AND e.source_id = d.id
            AND e.source_type = 'SALES_REFUND' AND e.event_type = 'SALE_REFUNDED' AND e.status = 'POSTED'
          WHERE d.company_id = NEW.company_id AND d.original_id = original.id AND d.kind = 'REFUND';
        IF returned <> (to_jsonb(original)->>amount_column)::bigint THEN
          RAISE EXCEPTION 'El reemplazo requiere devolución total publicada' USING ERRCODE = '23514';
        END IF;
      END IF;
    END LOOP;
    SELECT coalesce(sum(d.revenue_cents::bigint-d.discount_cents),0) INTO returned
      FROM "public"."accounting_sales_documents" d
      WHERE d.company_id=NEW.company_id AND d.original_id=original.id AND d.kind='REFUND'
        AND (NEW.kind='REFUND' OR EXISTS (SELECT 1 FROM "public"."accounting_events" e
          WHERE e.company_id=d.company_id AND e.source_id=d.id AND e.source_type='SALES_REFUND' AND e.status='POSTED'));
    IF (NEW.kind='REFUND' AND returned+NEW.revenue_cents::bigint-NEW.discount_cents > original.revenue_cents::bigint-original.discount_cents)
      OR (NEW.kind='SALE' AND returned <> original.revenue_cents::bigint-original.discount_cents) THEN
      RAISE EXCEPTION 'La corrección no respeta el ingreso neto original' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.kind = 'SALE' AND (source.status <> 'VALIDATED' OR source.business_date <> NEW.business_date
    OR source.shift::text <> NEW.shift OR source.channel::text <> NEW.channel OR source.total_sales <> NEW.total_cents
    OR (source.tax_amount IS NOT NULL AND source.tax_amount <> NEW.tax_cents)
    OR (source.cash_sales IS NOT NULL AND source.cash_sales <> NEW.cash_cents)
    OR (source.card_sales IS NOT NULL AND source.card_sales <> NEW.card_cents)
    OR (source.other_payments IS NOT NULL AND source.other_payments::bigint <> NEW.platform_cents::bigint + NEW.other_cents)) THEN
    RAISE EXCEPTION 'La declaración no coincide con el corte validado' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_sales_guard BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_sales_documents"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_sales_guard"();
--> statement-breakpoint
-- These sources use linked, component-limited refunds, rather than an untracked
-- manual reversal that could repay the same sale twice.
CREATE FUNCTION "public"."accounting_sales_reversal_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reversal_of_id IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."accounting_journals" j
    WHERE j.company_id = NEW.company_id AND j.id = NEW.reversal_of_id
      AND j.source_type IN ('DAILY_SALES_CUT','SALES_REFUND')) THEN
    RAISE EXCEPTION 'Utiliza una devolución vinculada a la venta' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_sales_reversal_guard BEFORE INSERT OR UPDATE ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_sales_reversal_guard"();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT ON "public"."accounting_sales_documents" TO pulso_app;
    GRANT SELECT, INSERT ON "public"."daily_sales_cuts" TO pulso_app;
    GRANT SELECT (ownership_type) ON "public"."branches" TO pulso_app;
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_capture_sales_cut"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('app.accounting_posting_enabled', true),'') <> '1' THEN RETURN NEW; END IF;
  IF NEW.company_id::text IS DISTINCT FROM nullif(current_setting('app.current_company_id',true),'')
    OR NEW.received_by IS DISTINCT FROM nullif(current_setting('app.current_actor_id',true),'') THEN
    RAISE EXCEPTION 'El corte requiere contexto de empresa y actor' USING ERRCODE='23514';
  END IF;
  INSERT INTO "public"."accounting_events" (company_id,branch_id,source_type,source_id,event_type,source_version,actor_id,accounting_date)
    VALUES (NEW.company_id,NEW.branch_id,'DAILY_SALES_CUT',NEW.id,'SALE_RECOGNIZED',1,NEW.received_by,NEW.business_date)
    ON CONFLICT (company_id,source_type,source_id,event_type,source_version) DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_capture_sales_cut AFTER INSERT ON "public"."daily_sales_cuts"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_capture_sales_cut"();
