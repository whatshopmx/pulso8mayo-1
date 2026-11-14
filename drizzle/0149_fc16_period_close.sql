CREATE TABLE "accounting_period_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"journal_count" integer DEFAULT 0 NOT NULL,
	"max_journal_number" integer DEFAULT 0 NOT NULL,
	"total_debit_cents" bigint DEFAULT 0 NOT NULL,
	"total_credit_cents" bigint DEFAULT 0 NOT NULL,
	"trial_balance" jsonb NOT NULL,
	"pnl_snapshot" jsonb,
	"closed_by" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopened_by" text,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	CONSTRAINT "accounting_period_closes_period_check" CHECK ("accounting_period_closes"."year" BETWEEN 2000 AND 2100 AND "accounting_period_closes"."month" BETWEEN 1 AND 12 AND "accounting_period_closes"."version" >= 1),
	CONSTRAINT "accounting_period_closes_status_check" CHECK (("accounting_period_closes"."status" = 'ACTIVE' AND "accounting_period_closes"."reopened_by" IS NULL AND "accounting_period_closes"."reopened_at" IS NULL AND "accounting_period_closes"."reopen_reason" IS NULL)
    OR ("accounting_period_closes"."status" = 'SUPERSEDED' AND "accounting_period_closes"."reopened_by" IS NOT NULL AND "accounting_period_closes"."reopened_at" IS NOT NULL AND "accounting_period_closes"."reopen_reason" = btrim("accounting_period_closes"."reopen_reason") AND length("accounting_period_closes"."reopen_reason") BETWEEN 5 AND 500)),
	CONSTRAINT "accounting_period_closes_balance_check" CHECK ("accounting_period_closes"."journal_count" >= 0 AND "accounting_period_closes"."max_journal_number" >= 0 AND "accounting_period_closes"."total_debit_cents" >= 0 AND "accounting_period_closes"."total_debit_cents" = "accounting_period_closes"."total_credit_cents"),
	CONSTRAINT "accounting_period_closes_snapshot_check" CHECK (jsonb_typeof("accounting_period_closes"."trial_balance") = 'array' AND ("accounting_period_closes"."pnl_snapshot" IS NULL OR jsonb_typeof("accounting_period_closes"."pnl_snapshot") = 'array'))
);
--> statement-breakpoint
ALTER TABLE "accounting_period_closes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "financial_periods" ADD COLUMN "close_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_periods" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "financial_periods" ADD COLUMN "reopened_by" text;--> statement-breakpoint
ALTER TABLE "financial_periods" ADD COLUMN "reopen_reason" text;--> statement-breakpoint
ALTER TABLE "pnl_snapshots" ADD COLUMN "accounting_close_id" uuid;--> statement-breakpoint
ALTER TABLE "pnl_snapshots" ADD COLUMN "close_version" integer;--> statement-breakpoint
ALTER TABLE "accounting_period_closes" ADD CONSTRAINT "accounting_period_closes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_period_closes" ADD CONSTRAINT "accounting_period_closes_period_id_financial_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."financial_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_period_closes" ADD CONSTRAINT "accounting_period_closes_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_period_closes" ADD CONSTRAINT "accounting_period_closes_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_period_closes_version_unique" ON "accounting_period_closes" USING btree ("company_id","year","month","version");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_period_closes_active_unique" ON "accounting_period_closes" USING btree ("company_id","year","month") WHERE "accounting_period_closes"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "accounting_period_closes_period_idx" ON "accounting_period_closes" USING btree ("company_id","period_id");--> statement-breakpoint
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "accounting_period_closes_tenant" ON "accounting_period_closes" AS PERMISSIVE FOR ALL TO public USING ("accounting_period_closes"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_period_closes"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);
--> statement-breakpoint
ALTER TABLE "public"."accounting_period_closes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_period_closes_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  month_start date;
  month_end date;
  next_version integer;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'El cierre contable requiere READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las versiones de cierre contable son inmutables y no pueden eliminarse' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 505));
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Una nueva versión de cierre debe crearse como ACTIVE' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "public"."financial_periods" p
      WHERE p.id = NEW.period_id AND p.company_id = NEW.company_id AND p.year = NEW.year AND p.month = NEW.month
    ) THEN
      RAISE EXCEPTION 'El cierre contable no corresponde al periodo financiero indicado' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "public"."users" u
      WHERE u.id = NEW.closed_by AND u.company_id = NEW.company_id AND u.active AND u.deleted_at IS NULL
        AND u.role IN ('OWNER', 'ADMIN', 'SUPER_ADMIN')
    ) THEN
      RAISE EXCEPTION 'Actor no autorizado para cerrar el periodo contable' USING ERRCODE = '23514';
    END IF;
    SELECT coalesce(max(c.version), 0) + 1 INTO next_version
      FROM "public"."accounting_period_closes" c
      WHERE c.company_id = NEW.company_id AND c.year = NEW.year AND c.month = NEW.month;
    IF NEW.version <> next_version THEN
      RAISE EXCEPTION 'La versión de cierre debe ser consecutiva (esperada %, recibida %)', next_version, NEW.version USING ERRCODE = '23514';
    END IF;
    month_start := make_date(NEW.year, NEW.month, 1);
    month_end := (month_start + interval '1 month - 1 day')::date;
    IF EXISTS (
      SELECT 1 FROM "public"."accounting_journals" j
      WHERE j.company_id = NEW.company_id AND j.status = 'DRAFT'
        AND j.accounting_date BETWEEN month_start AND month_end
    ) THEN
      RAISE EXCEPTION 'Existen pólizas en borrador dentro del periodo que impiden el cierre' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "public"."accounting_events" e
      WHERE e.company_id = NEW.company_id AND e.status = 'PENDING'
        AND (
          (e.accounting_date IS NOT NULL AND e.accounting_date BETWEEN month_start AND month_end)
          OR (e.accounting_date IS NULL AND e.created_at < (month_end + interval '1 day'))
        )
    ) THEN
      RAISE EXCEPTION 'Existen eventos contables pendientes en el periodo que impiden el cierre' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: only ACTIVE -> SUPERSEDED on reopen, preserving all snapshot fields
  IF OLD.status <> 'ACTIVE' OR NEW.status <> 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Las versiones de cierre contable solo pueden pasar de ACTIVE a SUPERSEDED al reabrir' USING ERRCODE = '23514';
  END IF;
  IF (OLD.id, OLD.company_id, OLD.period_id, OLD.year, OLD.month, OLD.version,
      OLD.journal_count, OLD.max_journal_number, OLD.total_debit_cents, OLD.total_credit_cents,
      OLD.trial_balance, OLD.pnl_snapshot, OLD.closed_by, OLD.closed_at)
    IS DISTINCT FROM
     (NEW.id, NEW.company_id, NEW.period_id, NEW.year, NEW.month, NEW.version,
      NEW.journal_count, NEW.max_journal_number, NEW.total_debit_cents, NEW.total_credit_cents,
      NEW.trial_balance, NEW.pnl_snapshot, NEW.closed_by, NEW.closed_at) THEN
    RAISE EXCEPTION 'El contenido congelado de una versión de cierre es inmutable' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "public"."users" u
    WHERE u.id = NEW.reopened_by AND u.company_id = NEW.company_id AND u.active AND u.deleted_at IS NULL
      AND u.role IN ('OWNER', 'SUPER_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Se requiere permiso de reapertura contable (OWNER o SUPER_ADMIN activo)' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_period_closes_validate BEFORE INSERT OR UPDATE OR DELETE ON "public"."accounting_period_closes"
FOR EACH ROW EXECUTE FUNCTION "public"."accounting_period_closes_guard"();
--> statement-breakpoint
CREATE FUNCTION "public"."financial_periods_close_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Los cambios de periodo financiero requieren READ COMMITTED' USING ERRCODE = '0A000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text, 505));
  IF TG_OP = 'UPDATE' AND OLD.status = 'CLOSED' AND NEW.status = 'OPEN' THEN
    IF EXISTS (
      SELECT 1 FROM "public"."accounting_period_closes" c
      WHERE c.company_id = NEW.company_id AND c.year = NEW.year AND c.month = NEW.month AND c.status = 'ACTIVE'
    ) THEN
      IF NEW.reopened_by IS NULL OR length(btrim(coalesce(NEW.reopen_reason, ''))) < 5 THEN
        RAISE EXCEPTION 'La reapertura de un periodo cerrado requiere actor y motivo explícito' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER financial_periods_close_validate BEFORE INSERT OR UPDATE ON "public"."financial_periods"
FOR EACH ROW EXECUTE FUNCTION "public"."financial_periods_close_guard"();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT, UPDATE(status, reopened_by, reopened_at, reopen_reason) ON "public"."accounting_period_closes" TO pulso_app;
    GRANT SELECT, INSERT, UPDATE ON "public"."financial_periods" TO pulso_app;
    GRANT SELECT, INSERT, UPDATE ON "public"."pnl_snapshots" TO pulso_app;
  END IF;
END $$;