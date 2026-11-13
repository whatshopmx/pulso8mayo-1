-- FC-14: additive, no historical backfill. Capture physical facts before any posting.
CREATE TABLE "accounting_inventory_valuations" (
	"movement_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid,
	"reference_id" text,
	"kind" text NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"unit_cost_cents" bigint,
	"amount_cents" bigint,
	"costing_method" text NOT NULL,
	"original_movement_id" uuid,
	"accounting_date" date NOT NULL,
	"actor_id" text,
	"pending_reason" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_inventory_kind_check" CHECK ("accounting_inventory_valuations"."kind" IN ('USAGE','USAGE_RETURN','WASTE','TRANSFER_OUT','TRANSFER_IN','TRANSFER_WASTE')),
	CONSTRAINT "accounting_inventory_quantity_check" CHECK ("accounting_inventory_valuations"."quantity" <> 0),
	CONSTRAINT "accounting_inventory_amount_check" CHECK ("accounting_inventory_valuations"."amount_cents" IS NULL OR "accounting_inventory_valuations"."amount_cents" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "accounting_inventory_cost_check" CHECK ("accounting_inventory_valuations"."unit_cost_cents" IS NULL OR "accounting_inventory_valuations"."unit_cost_cents" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "accounting_inventory_pending_check" CHECK ("accounting_inventory_valuations"."amount_cents" IS NOT NULL OR "accounting_inventory_valuations"."pending_reason" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "accounting_inventory_valuations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_events" DROP CONSTRAINT "accounting_events_source_check";--> statement-breakpoint
ALTER TABLE "accounting_inventory_valuations" ADD CONSTRAINT "accounting_inventory_valuations_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_inventory_valuations" ADD CONSTRAINT "accounting_inventory_valuations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_inventory_valuations" ADD CONSTRAINT "accounting_inventory_valuations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_inventory_valuations" ADD CONSTRAINT "accounting_inventory_valuations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounting_inventory_company_idx" ON "accounting_inventory_valuations" USING btree ("company_id","branch_id","accounting_date","movement_id");--> statement-breakpoint
CREATE INDEX "accounting_inventory_original_idx" ON "accounting_inventory_valuations" USING btree ("company_id","original_movement_id");--> statement-breakpoint
CREATE INDEX "accounting_inventory_reference_idx" ON "accounting_inventory_valuations" USING btree ("company_id","reference_id","item_id");--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_source_check" CHECK (("accounting_events"."source_type" = 'OPERATING_EXPENSE' AND "accounting_events"."event_type" = 'EXPENSE_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'EXPENSE_PAYMENT' AND "accounting_events"."event_type" = 'EXPENSE_PAYMENT')
    OR ("accounting_events"."source_type" = 'DAILY_SALES_CUT' AND "accounting_events"."event_type" = 'SALE_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'SALES_REFUND' AND "accounting_events"."event_type" = 'SALE_REFUNDED')
    OR ("accounting_events"."source_type" = 'GATEWAY_SETTLEMENT' AND "accounting_events"."event_type" = 'SETTLEMENT_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'RECEIVING_REPORT' AND "accounting_events"."event_type" = 'PURCHASE_RECEIVED')
    OR ("accounting_events"."source_type" = 'PURCHASE_INVOICE' AND "accounting_events"."event_type" = 'PURCHASE_INVOICED')
    OR ("accounting_events"."source_type" = 'PURCHASE_CREDIT' AND "accounting_events"."event_type" = 'PURCHASE_CREDITED')
    OR ("accounting_events"."source_type" = 'INVOICE_PAYMENT' AND "accounting_events"."event_type" = 'INVOICE_PAID')
    OR ("accounting_events"."source_type" = 'INVENTORY_MOVEMENT' AND "accounting_events"."event_type" IN
      ('INVENTORY_USED','INVENTORY_USAGE_RETURNED','INVENTORY_WASTED','INVENTORY_SHIPPED','INVENTORY_RECEIVED','INVENTORY_TRANSIT_WASTED')));--> statement-breakpoint
CREATE POLICY "accounting_inventory_tenant" ON "accounting_inventory_valuations" AS PERMISSIVE FOR ALL TO public USING ("accounting_inventory_valuations"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_inventory_valuations"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);
--> statement-breakpoint
ALTER TABLE "public"."accounting_inventory_valuations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_inventory_immutable"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='accounting_inventory_valuations' THEN
    IF TG_OP<>'INSERT' OR pg_trigger_depth()<2 THEN
      RAISE EXCEPTION 'La valoración solo se captura con el movimiento y es inmutable' USING ERRCODE='23514';
    END IF;
  ELSIF EXISTS(SELECT 1 FROM "public"."accounting_inventory_valuations" WHERE movement_id=OLD.id) THEN
    RAISE EXCEPTION 'El movimiento valorado requiere una corrección vinculada; no se modifica ni elimina' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_inventory_fact_immutable BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_inventory_valuations"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_inventory_immutable"();
--> statement-breakpoint
CREATE TRIGGER accounting_inventory_source_immutable BEFORE UPDATE OR DELETE ON "public"."inventory_movements"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_inventory_immutable"();
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_inventory_prorate"(total_quantity numeric,total_cents bigint,
  prior_quantity numeric,prior_cents bigint,delta numeric) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
BEGIN
  IF total_quantity<=0 OR prior_quantity<0 OR delta<=0 OR prior_quantity+delta>total_quantity
    OR total_cents<0 OR prior_cents<0 OR total_cents>9007199254740991
    OR round(total_cents*prior_quantity/total_quantity)<>prior_cents THEN
    RAISE EXCEPTION 'La cantidad o valoración aplicada excede o no corresponde al original congelado' USING ERRCODE='23514';
  END IF;
  RETURN round(total_cents*(prior_quantity+delta)/total_quantity)::bigint-prior_cents;
END $$;
--> statement-breakpoint
-- SECURITY DEFINER captures the fact even for a scoped stock writer. No runtime
-- INSERT grant on valuations; all identity and scope come from the physical row.
-- No outbox/posting occurs here: the flag-gated worker discovers immutable facts.
CREATE FUNCTION "public"."accounting_inventory_capture"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item record; branch record; actor text; chosen_method text; chosen_cost bigint;
  movement_kind text; amount numeric; reason text; original_id uuid; original record;
  transfer record; shipped record; applied record; expected_batch_branch uuid;
BEGIN
  IF NEW.type::text NOT IN ('USAGE','WASTE','TRANSFER') OR NEW.quantity_change=0 THEN RETURN NEW; END IF;
  expected_batch_branch:=NEW.branch_id;
  SELECT company_id,last_cost,average_cost INTO item FROM "public"."inventory_items" WHERE id=NEW.item_id;
  SELECT b.company_id,b.active,b.ownership_type,coalesce(b.costing_method,c.costing_method,'LAST_COST') method
    INTO branch FROM "public"."branches" b JOIN "public"."companies" c ON c.id=b.company_id WHERE b.id=NEW.branch_id;
  IF item.company_id IS NULL OR branch.company_id IS DISTINCT FROM item.company_id THEN
    RAISE EXCEPTION 'Artículo y sucursal del movimiento deben pertenecer a la misma empresa' USING ERRCODE='23514';
  END IF;
  IF nullif(current_setting('app.current_company_id',true),'') IS NOT NULL
    AND item.company_id IS DISTINCT FROM nullif(current_setting('app.current_company_id',true),'')::uuid THEN
    RAISE EXCEPTION 'El movimiento está fuera de la empresa de la transacción' USING ERRCODE='42501';
  END IF;
  SELECT id INTO actor FROM "public"."users" WHERE id=NEW.performed_by AND company_id=item.company_id AND active AND deleted_at IS NULL;
  IF actor IS NULL THEN reason:='Falta un actor activo de la empresa en el movimiento original.'; END IF;
  IF NOT branch.active OR branch.ownership_type<>'OWNED' THEN reason:='La valoración contable requiere una sucursal propia activa.'; END IF;
  movement_kind:=CASE WHEN NEW.type::text='TRANSFER' THEN CASE WHEN NEW.quantity_change<0 THEN 'TRANSFER_OUT' ELSE 'TRANSFER_IN' END
    WHEN NEW.type::text='USAGE' AND NEW.quantity_change>0 THEN 'USAGE_RETURN' ELSE NEW.type::text END;
  chosen_method:=branch.method;
  IF branch.method='AVERAGE_COST' THEN
    chosen_cost:=coalesce(item.average_cost,item.last_cost);
    IF item.average_cost IS NULL AND item.last_cost IS NOT NULL THEN chosen_method:='LAST_COST_FALLBACK'; END IF;
  ELSE
    chosen_cost:=coalesce(item.last_cost,item.average_cost);
    IF item.last_cost IS NULL AND item.average_cost IS NOT NULL THEN chosen_method:='AVERAGE_COST_FALLBACK'; END IF;
  END IF;
  IF chosen_cost IS NULL OR chosen_cost<0 THEN
    chosen_cost:=NULL;
  ELSE amount:=round(abs(NEW.quantity_change)*chosen_cost); END IF;
  IF movement_kind='USAGE_RETURN' THEN
    amount:=NULL; chosen_cost:=NULL; chosen_method:='ORIGINAL';
    IF NEW.reference_id ~ '^salecons:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:reverse:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      original_id:=right(NEW.reference_id,36)::uuid;
      SELECT * INTO original FROM "public"."accounting_inventory_valuations"
        WHERE company_id=item.company_id AND movement_id=original_id FOR UPDATE;
      IF FOUND THEN
        IF original.kind<>'USAGE' OR original.quantity>=0 OR original.branch_id<>NEW.branch_id OR original.item_id<>NEW.item_id
          OR original.batch_id IS DISTINCT FROM NEW.batch_id OR NEW.reference_id IS DISTINCT FROM original.reference_id||':reverse:'||original.movement_id::text THEN
          RAISE EXCEPTION 'La devolución no corresponde al movimiento original' USING ERRCODE='23514';
        END IF;
        chosen_cost:=original.unit_cost_cents;
        IF original.amount_cents IS NOT NULL THEN
          SELECT coalesce(sum(abs(quantity)),0) quantity,coalesce(sum(amount_cents),0) cents INTO applied
            FROM "public"."accounting_inventory_valuations" WHERE company_id=item.company_id AND original_movement_id=original_id;
          amount:="public"."accounting_inventory_prorate"(abs(original.quantity),original.amount_cents,applied.quantity,applied.cents::bigint,NEW.quantity_change);
          reason:=coalesce(reason,original.pending_reason);
        END IF;
      END IF;
    END IF;
    IF amount IS NULL THEN reason:=coalesce(reason,'Falta el movimiento original valorado para devolver el consumo; no se usa el costo actual.'); END IF;
  END IF;
  IF NEW.type::text IN ('TRANSFER','WASTE') AND NEW.reference_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT t.*,origin.company_id from_company,destination.company_id to_company,
      origin.ownership_type from_kind,destination.ownership_type to_kind,origin.active from_active,destination.active to_active
      INTO transfer FROM "public"."inventory_transfers" t
      JOIN "public"."branches" origin ON origin.id=t.from_branch_id JOIN "public"."branches" destination ON destination.id=t.to_branch_id
      WHERE t.id=NEW.reference_id::uuid FOR UPDATE OF t;
    IF FOUND AND (NEW.type::text='TRANSFER' OR (NEW.type::text='WASTE' AND NEW.branch_id=transfer.to_branch_id)) THEN
      IF transfer.from_company<>item.company_id OR transfer.to_company<>item.company_id THEN
        RAISE EXCEPTION 'La transferencia debe conservar la misma empresa en origen y destino' USING ERRCODE='23514';
      END IF;
      IF transfer.from_branch_id=transfer.to_branch_id OR (NEW.type::text='TRANSFER' AND (
        (NEW.quantity_change<0 AND NEW.branch_id<>transfer.from_branch_id)
        OR (NEW.quantity_change>0 AND NEW.branch_id<>transfer.to_branch_id))) THEN
        RAISE EXCEPTION 'La fase del movimiento no corresponde a su transferencia' USING ERRCODE='23514';
      END IF;
      IF transfer.from_kind<>'OWNED' OR transfer.to_kind<>'OWNED' OR NOT transfer.from_active OR NOT transfer.to_active
        OR transfer.status::text NOT IN ('IN_TRANSIT','COMPLETED') THEN reason:=coalesce(reason,'La transferencia requiere sucursales propias activas y envío confirmado.'); END IF;
      IF NEW.branch_id=transfer.to_branch_id THEN
        IF NEW.type::text='WASTE' AND NEW.quantity_change>=0 THEN
          RAISE EXCEPTION 'La merma en tránsito debe ser una salida física' USING ERRCODE='23514';
        END IF;
        movement_kind:=CASE WHEN NEW.type::text='WASTE' THEN 'TRANSFER_WASTE' ELSE 'TRANSFER_IN' END;
        IF movement_kind='TRANSFER_WASTE' THEN expected_batch_branch:=transfer.from_branch_id; END IF;
        chosen_cost:=NULL; amount:=NULL; chosen_method:='TRANSFER';
        SELECT sum(abs(quantity)) quantity,sum(amount_cents) cents,
          bool_and(amount_cents IS NOT NULL AND pending_reason IS NULL) complete INTO shipped
          FROM "public"."accounting_inventory_valuations" WHERE company_id=item.company_id AND item_id=NEW.item_id
            AND reference_id=NEW.reference_id AND branch_id=transfer.from_branch_id AND kind='TRANSFER_OUT';
        IF shipped.complete AND shipped.cents<=9007199254740991 THEN
          SELECT coalesce(sum(abs(quantity)),0) quantity,coalesce(sum(amount_cents),0) cents INTO applied
            FROM "public"."accounting_inventory_valuations" WHERE company_id=item.company_id AND item_id=NEW.item_id
              AND reference_id=NEW.reference_id AND branch_id=transfer.to_branch_id AND kind IN ('TRANSFER_IN','TRANSFER_WASTE');
          amount:="public"."accounting_inventory_prorate"(shipped.quantity,shipped.cents::bigint,applied.quantity,applied.cents::bigint,abs(NEW.quantity_change));
        ELSE reason:=coalesce(reason,'Falta la valoración completa del envío original; no se usa el costo del destino.'); END IF;
      END IF;
    ELSIF NEW.type::text='TRANSFER' THEN amount:=NULL; reason:=coalesce(reason,'Falta la transferencia documentada del movimiento.'); END IF;
  END IF;
  IF NEW.type::text='TRANSFER' AND (NEW.reference_id IS NULL OR NEW.reference_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    amount:=NULL; reason:=coalesce(reason,'Falta la transferencia documentada del movimiento.');
  END IF;
  IF NEW.batch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "public"."inventory_batches"
    WHERE id=NEW.batch_id AND item_id=NEW.item_id AND branch_id=expected_batch_branch) THEN
    RAISE EXCEPTION 'El lote no corresponde al artículo y sucursal del movimiento' USING ERRCODE='23514';
  END IF;
  IF amount>9007199254740991 THEN amount:=NULL; reason:='La valoración excede el rango seguro de centavos.'; END IF;
  IF amount IS NULL THEN reason:=coalesce(reason,'Falta el costo capturado al crear el movimiento.'); END IF;
  INSERT INTO "public"."accounting_inventory_valuations"
    (movement_id,company_id,branch_id,item_id,batch_id,reference_id,kind,quantity,unit_cost_cents,amount_cents,
      costing_method,accounting_date,actor_id,pending_reason,original_movement_id)
    VALUES(NEW.id,item.company_id,NEW.branch_id,NEW.item_id,NEW.batch_id,NEW.reference_id,movement_kind,NEW.quantity_change,
      chosen_cost,amount,chosen_method,NEW.timestamp::date,actor,reason,original_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_inventory_capture AFTER INSERT ON "public"."inventory_movements"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_inventory_capture"();
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."accounting_inventory_capture"() FROM public;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."accounting_inventory_immutable"() FROM public;
--> statement-breakpoint
-- A scoped read of the operational phase; no broad SELECT grant on legacy transfers.
CREATE FUNCTION "public"."accounting_inventory_source_blocker"(company uuid,movement uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE f record; t record;
BEGIN
  IF company IS DISTINCT FROM nullif(current_setting('app.current_company_id',true),'')::uuid THEN RETURN 'El movimiento no está en tu empresa.'; END IF;
  SELECT * INTO f FROM "public"."accounting_inventory_valuations" WHERE company_id=company AND movement_id=movement;
  IF f.movement_id IS NULL THEN RETURN 'Falta la valoración original del movimiento.'; END IF;
  IF f.kind NOT IN ('TRANSFER_OUT','TRANSFER_IN','TRANSFER_WASTE') THEN RETURN NULL; END IF;
  SELECT tr.*,origin.company_id from_company,destination.company_id to_company,
    origin.ownership_type from_kind,destination.ownership_type to_kind,origin.active from_active,destination.active to_active
    INTO t FROM "public"."inventory_transfers" tr JOIN "public"."branches" origin ON origin.id=tr.from_branch_id
    JOIN "public"."branches" destination ON destination.id=tr.to_branch_id WHERE tr.id=f.reference_id::uuid;
  IF t.id IS NULL OR t.from_company<>company OR t.to_company<>company OR t.from_kind<>'OWNED' OR t.to_kind<>'OWNED'
    OR NOT t.from_active OR NOT t.to_active OR t.status::text NOT IN ('IN_TRANSIT','COMPLETED')
    OR (f.kind<>'TRANSFER_OUT' AND t.status::text<>'COMPLETED')
    OR (f.kind='TRANSFER_OUT' AND f.branch_id<>t.from_branch_id) OR (f.kind<>'TRANSFER_OUT' AND f.branch_id<>t.to_branch_id) THEN
    RETURN 'La transferencia requiere sucursales propias y envío o recepción confirmados.';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."accounting_inventory_source_blocker"(uuid,uuid) FROM public;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_inventory_expected_lines"(kind text,amount bigint)
RETURNS TABLE(role text,debit bigint,credit bigint) LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE kind WHEN 'USAGE' THEN 'COGS' WHEN 'USAGE_RETURN' THEN 'INVENTORY' WHEN 'WASTE' THEN 'WASTE'
    WHEN 'TRANSFER_OUT' THEN 'IN_TRANSIT' WHEN 'TRANSFER_IN' THEN 'INVENTORY' WHEN 'TRANSFER_WASTE' THEN 'WASTE' END, amount, 0::bigint
  UNION ALL SELECT CASE kind WHEN 'USAGE' THEN 'INVENTORY' WHEN 'USAGE_RETURN' THEN 'COGS' WHEN 'WASTE' THEN 'INVENTORY'
    WHEN 'TRANSFER_OUT' THEN 'INVENTORY' WHEN 'TRANSFER_IN' THEN 'IN_TRANSIT' WHEN 'TRANSFER_WASTE' THEN 'IN_TRANSIT' END, 0::bigint, amount
$$;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_inventory_post_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE f record; original_journal uuid; blocker text;
BEGIN
  IF NEW.status<>'POSTED' OR OLD.status<>'DRAFT' THEN RETURN NEW; END IF;
  IF NEW.reversal_of_id IS NOT NULL AND EXISTS(SELECT 1 FROM "public"."accounting_journals"
    WHERE id=NEW.reversal_of_id AND company_id=NEW.company_id AND source_type='INVENTORY_MOVEMENT') THEN
    RAISE EXCEPTION 'Inventario requiere una corrección física vinculada; no una reversa manual' USING ERRCODE='23514';
  END IF;
  IF NEW.source_type IS DISTINCT FROM 'INVENTORY_MOVEMENT' THEN RETURN NEW; END IF;
  SELECT v.* INTO f FROM "public"."accounting_inventory_valuations" v JOIN "public"."accounting_events" e
    ON e.company_id=v.company_id AND e.source_type='INVENTORY_MOVEMENT' AND e.source_id=v.movement_id
    WHERE v.company_id=NEW.company_id AND v.movement_id::text=NEW.source_id AND v.branch_id=NEW.branch_id
      AND v.accounting_date=NEW.accounting_date AND v.actor_id=NEW.created_by AND e.event_type=NEW.event_type
      AND e.accounting_date=v.accounting_date AND e.branch_id=v.branch_id AND e.actor_id=v.actor_id AND e.source_version=NEW.source_version
      AND NEW.source_version=1 AND e.event_type=CASE v.kind WHEN 'USAGE' THEN 'INVENTORY_USED'
        WHEN 'USAGE_RETURN' THEN 'INVENTORY_USAGE_RETURNED' WHEN 'WASTE' THEN 'INVENTORY_WASTED'
        WHEN 'TRANSFER_OUT' THEN 'INVENTORY_SHIPPED' WHEN 'TRANSFER_IN' THEN 'INVENTORY_RECEIVED' ELSE 'INVENTORY_TRANSIT_WASTED' END;
  IF f.movement_id IS NULL OR f.amount_cents IS NULL OR f.amount_cents<=0 OR f.pending_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Falta el hecho y valor congelado elegibles del movimiento' USING ERRCODE='23514';
  END IF;
  blocker:="public"."accounting_inventory_source_blocker"(NEW.company_id,f.movement_id);
  IF blocker IS NOT NULL THEN RAISE EXCEPTION '%',blocker USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM "public"."accounting_rules" WHERE id=NEW.rule_id AND company_id=NEW.company_id
      AND event_type=NEW.event_type AND version=NEW.rule_version AND active AND effective_from<=NEW.accounting_date)
    OR (SELECT count(*) FROM "public"."accounting_journal_lines" WHERE company_id=NEW.company_id AND journal_id=NEW.id)<>2
    OR EXISTS(SELECT 1 FROM "public"."accounting_inventory_expected_lines"(f.kind,f.amount_cents) x WHERE NOT EXISTS(
      SELECT 1 FROM "public"."accounting_journal_lines" l JOIN "public"."accounting_accounts" a ON a.company_id=l.company_id AND a.id=l.account_id
      JOIN "public"."accounting_rule_entries" re ON re.company_id=l.company_id AND re.rule_id=NEW.rule_id
        AND re.account_id=l.account_id AND re.role=x.role AND re.cost_center_id IS NOT DISTINCT FROM l.cost_center_id
      WHERE l.company_id=NEW.company_id AND l.journal_id=NEW.id AND l.memo='INVENTORY:'||x.role
        AND l.debit_cents=x.debit AND l.credit_cents=x.credit
        AND a.kind=CASE WHEN x.role IN ('COGS','WASTE') THEN 'EXPENSE' ELSE 'ASSET' END)) THEN
    RAISE EXCEPTION 'Los renglones no corresponden al movimiento, importe y regla congelados' USING ERRCODE='23514';
  END IF;
  IF f.kind='USAGE_RETURN' THEN
    SELECT e.journal_id INTO original_journal FROM "public"."accounting_events" e
      WHERE e.company_id=NEW.company_id AND e.source_type='INVENTORY_MOVEMENT' AND e.source_id=f.original_movement_id
        AND e.event_type='INVENTORY_USED' AND e.status='POSTED';
    IF original_journal IS NULL OR EXISTS(SELECT 1 FROM "public"."accounting_journal_lines" l WHERE l.company_id=NEW.company_id AND l.journal_id=NEW.id
      AND NOT EXISTS(SELECT 1 FROM "public"."accounting_journal_lines" o WHERE o.company_id=l.company_id AND o.journal_id=original_journal
        AND o.memo=l.memo AND o.account_id=l.account_id AND o.cost_center_id IS NOT DISTINCT FROM l.cost_center_id)) THEN
      RAISE EXCEPTION 'La devolución requiere las cuentas del consumo original publicado' USING ERRCODE='23514';
    END IF;
  ELSIF f.kind IN ('TRANSFER_IN','TRANSFER_WASTE') THEN
    IF NOT EXISTS(SELECT 1 FROM "public"."accounting_inventory_valuations" WHERE company_id=NEW.company_id AND reference_id=f.reference_id AND item_id=f.item_id AND kind='TRANSFER_OUT')
      OR EXISTS(SELECT 1 FROM "public"."accounting_inventory_valuations" v LEFT JOIN "public"."accounting_events" e
        ON e.company_id=v.company_id AND e.source_id=v.movement_id AND e.source_type='INVENTORY_MOVEMENT' AND e.event_type='INVENTORY_SHIPPED'
        WHERE v.company_id=NEW.company_id AND v.reference_id=f.reference_id AND v.item_id=f.item_id AND v.kind='TRANSFER_OUT'
          AND (e.status IS DISTINCT FROM 'POSTED' OR NOT EXISTS(SELECT 1 FROM "public"."accounting_journal_lines" o
            JOIN "public"."accounting_journal_lines" l ON l.company_id=o.company_id AND l.account_id=o.account_id AND l.cost_center_id IS NOT DISTINCT FROM o.cost_center_id
            WHERE o.company_id=NEW.company_id AND o.journal_id=e.journal_id AND o.memo='INVENTORY:IN_TRANSIT'
              AND l.journal_id=NEW.id AND l.memo='INVENTORY:IN_TRANSIT'))) THEN
      RAISE EXCEPTION 'La recepción requiere la misma cuenta en tránsito del envío publicado' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_inventory_post_validate BEFORE UPDATE OF status ON "public"."accounting_journals"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_inventory_post_guard"();
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."accounting_inventory_post_guard"() FROM public;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_inventory_transfer_immutable"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM "public"."accounting_inventory_valuations" WHERE reference_id=OLD.id::text AND kind IN ('TRANSFER_OUT','TRANSFER_IN','TRANSFER_WASTE'))
    AND (TG_OP='DELETE' OR (OLD.id,OLD.from_branch_id,OLD.to_branch_id,OLD.transfer_number)
      IS DISTINCT FROM (NEW.id,NEW.from_branch_id,NEW.to_branch_id,NEW.transfer_number)) THEN
    RAISE EXCEPTION 'La identidad de la transferencia valorada es inmutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_inventory_transfer_immutable BEFORE UPDATE OR DELETE ON "public"."inventory_transfers"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_inventory_transfer_immutable"();
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."accounting_inventory_transfer_immutable"() FROM public;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pulso_app') THEN
    GRANT SELECT ON "public"."accounting_inventory_valuations" TO pulso_app;
    GRANT EXECUTE ON FUNCTION "public"."accounting_inventory_source_blocker"(uuid,uuid) TO pulso_app;
    GRANT SELECT(id,company_id,active,deleted_at) ON "public"."users" TO pulso_app;
    GRANT SELECT(id,company_id,active,ownership_type) ON "public"."branches" TO pulso_app;
  END IF;
END $$;
