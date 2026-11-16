ALTER TABLE "invoices" ADD COLUMN "payee_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "destination" text DEFAULT 'UNCLASSIFIED' NOT NULL;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "classified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "classified_by" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "classification_reason" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "classification_source" text;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_classified_by_users_id_fk" FOREIGN KEY ("classified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_company_id_unique" UNIQUE("company_id","id");
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payee_company_fk" FOREIGN KEY ("company_id","payee_id") REFERENCES "public"."payees"("company_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "invoices_payee_destination_idx" ON "invoices" USING btree ("company_id","payee_id","destination");
--> statement-breakpoint
CREATE INDEX "operating_expenses_invoice_idx" ON "operating_expenses" USING btree ("invoice_id");
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_destination_check" CHECK ("invoices"."destination" IN ('UNCLASSIFIED','INVENTORY_PURCHASE','OPERATING_EXPENSE'));
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_classification_check" CHECK (
        ("invoices"."destination" = 'UNCLASSIFIED' AND "invoices"."classified_at" IS NULL AND "invoices"."classified_by" IS NULL
            AND "invoices"."classification_reason" IS NULL AND "invoices"."classification_source" IS NULL)
        OR ("invoices"."classified_at" IS NOT NULL AND "invoices"."classified_by" IS NOT NULL
            AND "invoices"."classification_reason" IS NOT NULL AND length(btrim("invoices"."classification_reason")) BETWEEN 5 AND 500
            AND "invoices"."classification_source" IS NOT NULL AND "invoices"."classification_source" IN ('CAPTURE','MANUAL','BACKFILL')));
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_operating_destination_check" CHECK ("invoices"."destination" <> 'OPERATING_EXPENSE'
        OR ("invoices"."payee_id" IS NOT NULL AND "invoices"."branch_id" IS NOT NULL AND "invoices"."currency" = 'MXN'
            AND "invoices"."purchase_order_id" IS NULL AND "invoices"."receiving_report_id" IS NULL));
--> statement-breakpoint
-- Validación diferida: factura y gasto pueden guardarse en cualquier orden
-- dentro de la misma transacción. No se infiere ni corrige metadata histórica.
CREATE FUNCTION "public"."validate_invoice_destination"(target_invoice_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  doc public.invoices%ROWTYPE;
  supplier_company uuid;
  supplier_payee uuid;
  linked_count integer;
BEGIN
  SELECT * INTO doc FROM public.invoices WHERE id = target_invoice_id FOR NO KEY UPDATE;
  IF NOT FOUND OR doc.destination = 'UNCLASSIFIED' THEN RETURN; END IF;
  -- El bloqueo serializa validaciones concurrentes; las consultas siguientes
  -- necesitan ver el commit que pudo completarse mientras esperábamos.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Valida documentos clasificados en una transacción READ COMMITTED' USING ERRCODE = '0A000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = doc.classified_by AND company_id = doc.company_id) THEN
    RAISE EXCEPTION 'El actor de clasificación no pertenece a la empresa' USING ERRCODE = '23514';
  END IF;
  IF doc.branch_id IS NOT NULL THEN
    PERFORM 1 FROM public.branches WHERE id = doc.branch_id AND company_id = doc.company_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La sucursal de la factura no pertenece a la empresa' USING ERRCODE = '23514'; END IF;
  END IF;
  IF doc.supplier_id IS NOT NULL THEN
    SELECT company_id, payee_id INTO supplier_company, supplier_payee FROM public.suppliers WHERE id = doc.supplier_id FOR SHARE;
    IF NOT FOUND OR supplier_company IS DISTINCT FROM doc.company_id
      OR (doc.payee_id IS NOT NULL AND supplier_payee IS DISTINCT FROM doc.payee_id) THEN
      RAISE EXCEPTION 'El proveedor y la contraparte de la factura son incompatibles' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT count(*) INTO linked_count FROM public.operating_expenses WHERE invoice_id = doc.id;
  IF doc.destination = 'INVENTORY_PURCHASE' AND linked_count > 0 THEN
    RAISE EXCEPTION 'Una compra de inventario no puede respaldar un gasto operativo' USING ERRCODE = '23514';
  END IF;
  IF doc.destination = 'OPERATING_EXPENSE' THEN
    IF linked_count > 1 OR EXISTS (SELECT 1 FROM public.operating_expenses e WHERE e.invoice_id = doc.id
      AND (e.company_id IS DISTINCT FROM doc.company_id OR e.branch_id IS DISTINCT FROM doc.branch_id
        OR e.payee_id IS DISTINCT FROM doc.payee_id OR e.amount IS DISTINCT FROM doc.total)) THEN
      RAISE EXCEPTION 'La factura operativa requiere una sola relación coherente con su gasto' USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "public"."check_invoice_destination"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.validate_invoice_destination(NEW.id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "invoices_destination_relations_guard"
AFTER INSERT OR UPDATE ON "public"."invoices" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."check_invoice_destination"();
--> statement-breakpoint
CREATE FUNCTION "public"."check_expense_invoice_destination"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.invoice_id IS NOT NULL THEN
    -- También impide enlazar desde un tenant cuya RLS no permite ver la factura.
    PERFORM 1 FROM public.invoices WHERE id = NEW.invoice_id AND company_id = NEW.company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'La factura no está disponible en la empresa del gasto' USING ERRCODE = '23514'; END IF;
    PERFORM public.validate_invoice_destination(NEW.invoice_id);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "expenses_invoice_destination_guard"
AFTER INSERT OR UPDATE ON "public"."operating_expenses" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."check_expense_invoice_destination"();
--> statement-breakpoint
-- Las identidades del catálogo tampoco pueden invalidar documentos ya clasificados.
CREATE FUNCTION "public"."check_invoice_identity_change"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE doc_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'suppliers' THEN
    FOR doc_id IN SELECT id FROM public.invoices WHERE supplier_id = NEW.id AND destination <> 'UNCLASSIFIED'
    LOOP PERFORM public.validate_invoice_destination(doc_id); END LOOP;
  ELSE
    FOR doc_id IN SELECT id FROM public.invoices WHERE branch_id = NEW.id AND destination <> 'UNCLASSIFIED'
    LOOP PERFORM public.validate_invoice_destination(doc_id); END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "suppliers_invoice_identity_guard"
AFTER UPDATE OF company_id, payee_id ON "public"."suppliers" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."check_invoice_identity_change"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "branches_invoice_identity_guard"
AFTER UPDATE OF company_id ON "public"."branches" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."check_invoice_identity_change"();
