CREATE TABLE "accounting_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"source_version" integer DEFAULT 1 NOT NULL,
	"actor_id" text NOT NULL,
	"accounting_date" date,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"journal_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_events_source_check" CHECK (("accounting_events"."source_type" = 'OPERATING_EXPENSE' AND "accounting_events"."event_type" = 'EXPENSE_RECOGNIZED')
    OR ("accounting_events"."source_type" = 'EXPENSE_PAYMENT' AND "accounting_events"."event_type" = 'EXPENSE_PAYMENT')),
	CONSTRAINT "accounting_events_version_check" CHECK ("accounting_events"."source_version" = 1),
	CONSTRAINT "accounting_events_attempts_check" CHECK ("accounting_events"."attempts" >= 0),
	CONSTRAINT "accounting_events_status_check" CHECK (("accounting_events"."status" = 'PENDING' AND "accounting_events"."journal_id" IS NULL)
    OR ("accounting_events"."status" = 'POSTED' AND "accounting_events"."journal_id" IS NOT NULL AND "accounting_events"."last_error" IS NULL)),
	CONSTRAINT "accounting_events_error_check" CHECK ("accounting_events"."last_error" IS NULL OR length("accounting_events"."last_error") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "accounting_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_branch_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_journal_fk" FOREIGN KEY ("company_id","journal_id") REFERENCES "public"."accounting_journals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_events_source_unique" ON "accounting_events" USING btree ("company_id","source_type","source_id","event_type","source_version");--> statement-breakpoint
CREATE INDEX "accounting_events_pending_idx" ON "accounting_events" USING btree ("company_id","status","next_attempt_at","id");--> statement-breakpoint
CREATE POLICY "accounting_events_tenant" ON "accounting_events" AS PERMISSIVE FOR ALL TO public USING ("accounting_events"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_events"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);
--> statement-breakpoint
ALTER TABLE "public"."accounting_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION "public"."accounting_events_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM "public"."branches" b
    WHERE b.id = NEW.branch_id AND b.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'La sucursal no pertenece a la empresa del hecho' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los hechos contables no se eliminan' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    ROW(NEW.id, NEW.company_id, NEW.branch_id, NEW.source_type, NEW.source_id,
      NEW.event_type, NEW.source_version, NEW.actor_id, NEW.accounting_date, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.company_id, OLD.branch_id, OLD.source_type, OLD.source_id,
      OLD.event_type, OLD.source_version, OLD.actor_id, OLD.accounting_date, OLD.created_at)
    OR (OLD.status = 'POSTED' AND NEW IS DISTINCT FROM OLD)) THEN
    RAISE EXCEPTION 'La identidad del hecho y su publicación son inmutables' USING ERRCODE = '23514';
  END IF;
  IF NEW.journal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "public"."accounting_journals" j
    WHERE j.company_id = NEW.company_id AND j.id = NEW.journal_id AND j.status = 'POSTED'
      AND j.source_type = NEW.source_type AND j.source_id = NEW.source_id::text
      AND j.event_type = NEW.event_type AND j.source_version = NEW.source_version) THEN
    RAISE EXCEPTION 'La póliza no corresponde al hecho publicado' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accounting_events_guard BEFORE INSERT OR UPDATE OR DELETE
ON "public"."accounting_events" FOR EACH ROW EXECUTE FUNCTION "public"."accounting_events_guard"();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT (id) ON "public"."companies" TO pulso_app;
    GRANT SELECT, INSERT ON "public"."accounting_events" TO pulso_app;
    GRANT UPDATE (status, journal_id, attempts, last_error, next_attempt_at, updated_at)
      ON "public"."accounting_events" TO pulso_app;
  END IF;
END $$;
