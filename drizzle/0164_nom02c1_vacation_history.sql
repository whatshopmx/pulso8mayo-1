CREATE SEQUENCE public.vacation_history_record_version_seq AS bigint;--> statement-breakpoint
CREATE FUNCTION public.vacation_history_scope(p_company uuid, p_user text, p_operation text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT coalesce(p_company=nullif(current_setting('app.current_company_id',true),'')::uuid
    AND EXISTS (SELECT 1 FROM public.users a JOIN public.users s ON s.id=p_user AND s.company_id=p_company
      WHERE a.id=nullif(current_setting('app.current_actor_id',true),'') AND a.company_id=p_company AND a.deleted_at IS NULL
        AND ((p_operation='grant' AND a.role::text IN ('SUPER_ADMIN','OWNER','ADMIN'))
          OR (p_operation='read' AND (a.role::text IN ('SUPER_ADMIN','OWNER','ADMIN')
            OR a.id=s.id OR (a.role::text IN ('GERENTE','SUPERVISOR','READONLY') AND a.branch_id=s.branch_id AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id=a.branch_id AND b.company_id=p_company))))
          OR (p_operation='decision' AND (a.role::text IN ('SUPER_ADMIN','OWNER','ADMIN')
            OR (a.role::text='GERENTE' AND a.branch_id=s.branch_id AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id=a.branch_id AND b.company_id=p_company))
            OR (a.role::text IN ('SUPERVISOR','EMPLEADO') AND a.id=s.id))))),false);
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vacation_history_scope(uuid,text,text) FROM PUBLIC;--> statement-breakpoint

CREATE TABLE "vacation_history_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stream_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"valid_from" date,
	"valid_through" date,
	"days" integer,
	"vacation_request_id" uuid,
	"leave_request_id" uuid,
	"reverses_event_id" uuid,
	"source_reference" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"record_version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "vacation_history_event_identity" UNIQUE("id","stream_id","company_id","user_id"),
	CONSTRAINT "vacation_history_event_source" CHECK (length(btrim("vacation_history_events"."source_reference")) BETWEEN 1 AND 1000 AND length(btrim("vacation_history_events"."reason")) BETWEEN 1 AND 2000 AND length(btrim("vacation_history_events"."idempotency_key")) BETWEEN 1 AND 128),
	CONSTRAINT "vacation_history_event_dates" CHECK (("vacation_history_events"."valid_from" IS NULL AND "vacation_history_events"."valid_through" IS NULL) OR ("vacation_history_events"."valid_from" IS NOT NULL AND "vacation_history_events"."valid_through" IS NOT NULL AND isfinite("vacation_history_events"."valid_from") AND isfinite("vacation_history_events"."valid_through") AND "vacation_history_events"."valid_from" <= "vacation_history_events"."valid_through")),
	CONSTRAINT "vacation_history_event_shape" CHECK (
        ("vacation_history_events"."kind"='COVERAGE' AND "vacation_history_events"."valid_from" IS NOT NULL AND "vacation_history_events"."days" IS NULL AND "vacation_history_events"."vacation_request_id" IS NULL AND "vacation_history_events"."leave_request_id" IS NULL AND "vacation_history_events"."reverses_event_id" IS NULL) OR
        ("vacation_history_events"."kind"='GRANT' AND "vacation_history_events"."valid_from" IS NOT NULL AND "vacation_history_events"."days" IS NOT NULL AND "vacation_history_events"."days">=0 AND "vacation_history_events"."vacation_request_id" IS NULL AND "vacation_history_events"."leave_request_id" IS NULL AND "vacation_history_events"."reverses_event_id" IS NULL) OR
        ("vacation_history_events"."kind"='REVOKE_GRANT' AND "vacation_history_events"."valid_from" IS NULL AND "vacation_history_events"."days" IS NULL AND "vacation_history_events"."vacation_request_id" IS NULL AND "vacation_history_events"."leave_request_id" IS NULL AND "vacation_history_events"."reverses_event_id" IS NOT NULL) OR
        ("vacation_history_events"."kind"='APPROVE_REQUEST' AND "vacation_history_events"."valid_from" IS NOT NULL AND "vacation_history_events"."days" IS NOT NULL AND "vacation_history_events"."days">0 AND "vacation_history_events"."days"=("vacation_history_events"."valid_through"-"vacation_history_events"."valid_from"+1) AND (("vacation_history_events"."vacation_request_id" IS NOT NULL)::int+("vacation_history_events"."leave_request_id" IS NOT NULL)::int)=1 AND "vacation_history_events"."reverses_event_id" IS NULL) OR
        ("vacation_history_events"."kind"='CANCEL_REQUEST' AND "vacation_history_events"."valid_from" IS NULL AND "vacation_history_events"."days" IS NULL AND (("vacation_history_events"."vacation_request_id" IS NOT NULL)::int+("vacation_history_events"."leave_request_id" IS NOT NULL)::int)=1 AND "vacation_history_events"."reverses_event_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "vacation_history_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vacation_history_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"predecessor_id" uuid,
	"coverage_from" date NOT NULL,
	"coverage_through" date NOT NULL,
	"source_reference" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"recorded_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"record_version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "vacation_history_stream_identity" UNIQUE("id","company_id","user_id"),
	CONSTRAINT "vacation_history_stream_dates" CHECK (isfinite("vacation_history_streams"."coverage_from") AND isfinite("vacation_history_streams"."coverage_through") AND "vacation_history_streams"."coverage_from" <= "vacation_history_streams"."coverage_through"),
	CONSTRAINT "vacation_history_stream_source" CHECK (length(btrim("vacation_history_streams"."source_reference")) BETWEEN 1 AND 1000 AND length(btrim("vacation_history_streams"."reason")) BETWEEN 1 AND 2000 AND length(btrim("vacation_history_streams"."idempotency_key")) BETWEEN 1 AND 128)
);
--> statement-breakpoint
ALTER TABLE "vacation_history_streams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vacation_history_events" ADD CONSTRAINT "vacation_history_events_vacation_request_id_vacation_requests_id_fk" FOREIGN KEY ("vacation_request_id") REFERENCES "public"."vacation_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_history_events" ADD CONSTRAINT "vacation_history_events_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_history_events" ADD CONSTRAINT "vacation_history_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_history_events" ADD CONSTRAINT "vacation_history_event_stream" FOREIGN KEY ("stream_id","company_id","user_id") REFERENCES "public"."vacation_history_streams"("id","company_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_history_events" ADD CONSTRAINT "vacation_history_event_reversal" FOREIGN KEY ("reverses_event_id","stream_id","company_id","user_id") REFERENCES "public"."vacation_history_events"("id","stream_id","company_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_history_streams" ADD CONSTRAINT "vacation_history_streams_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_history_streams" ADD CONSTRAINT "vacation_history_streams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_history_streams" ADD CONSTRAINT "vacation_history_streams_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_history_streams" ADD CONSTRAINT "vacation_history_stream_predecessor" FOREIGN KEY ("predecessor_id","company_id","user_id") REFERENCES "public"."vacation_history_streams"("id","company_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vacation_history_event_key" ON "vacation_history_events" USING btree ("stream_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "vacation_history_event_reversed_once" ON "vacation_history_events" USING btree ("reverses_event_id") WHERE "vacation_history_events"."reverses_event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vacation_history_vacation_approved_once" ON "vacation_history_events" USING btree ("stream_id","vacation_request_id") WHERE "vacation_history_events"."kind"='APPROVE_REQUEST' AND "vacation_history_events"."vacation_request_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vacation_history_leave_approved_once" ON "vacation_history_events" USING btree ("stream_id","leave_request_id") WHERE "vacation_history_events"."kind"='APPROVE_REQUEST' AND "vacation_history_events"."leave_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "vacation_history_event_cutoff" ON "vacation_history_events" USING btree ("company_id","user_id","record_version");--> statement-breakpoint
CREATE UNIQUE INDEX "vacation_history_stream_key" ON "vacation_history_streams" USING btree ("company_id","user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "vacation_history_stream_root" ON "vacation_history_streams" USING btree ("company_id","user_id") WHERE "vacation_history_streams"."predecessor_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vacation_history_stream_successor" ON "vacation_history_streams" USING btree ("predecessor_id") WHERE "vacation_history_streams"."predecessor_id" IS NOT NULL;--> statement-breakpoint
CREATE POLICY "vacation_history_event_read" ON "vacation_history_events" AS PERMISSIVE FOR SELECT TO public USING (public.vacation_history_scope("vacation_history_events"."company_id","vacation_history_events"."user_id",'read'));--> statement-breakpoint
CREATE POLICY "vacation_history_event_insert" ON "vacation_history_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.vacation_history_scope("vacation_history_events"."company_id","vacation_history_events"."user_id",CASE WHEN "vacation_history_events"."kind" IN ('COVERAGE','GRANT','REVOKE_GRANT') THEN 'grant' ELSE 'decision' END) AND "vacation_history_events"."actor_id"=nullif(current_setting('app.current_actor_id',true),''));--> statement-breakpoint
CREATE POLICY "vacation_history_stream_read" ON "vacation_history_streams" AS PERMISSIVE FOR SELECT TO public USING (public.vacation_history_scope("vacation_history_streams"."company_id","vacation_history_streams"."user_id",'read'));--> statement-breakpoint
CREATE POLICY "vacation_history_stream_insert" ON "vacation_history_streams" AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.vacation_history_scope("vacation_history_streams"."company_id","vacation_history_streams"."user_id",'grant') AND "vacation_history_streams"."actor_id"=nullif(current_setting('app.current_actor_id',true),''));
--> statement-breakpoint
CREATE FUNCTION public.vacation_history_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  actor text := nullif(current_setting('app.current_actor_id',true),'');
  actor_role text;
  actor_branch uuid;
  anchor record;
  prior record;
  subject record;
  through_day date;
  operation text;
BEGIN
  IF TG_TABLE_NAME='vacation_history_streams' THEN operation := 'grant';
  ELSE operation := CASE WHEN NEW.kind IN ('COVERAGE','GRANT','REVOKE_GRANT') THEN 'grant' ELSE 'decision' END; END IF;
  IF NEW.actor_id IS DISTINCT FROM actor OR NOT public.vacation_history_scope(NEW.company_id,NEW.user_id,operation) THEN
    RAISE EXCEPTION 'Vacation history actor is not authorized' USING ERRCODE='42501';
  END IF;
  -- All writers and future manifest readers use this same employee lock.
  -- Version assignment occurs AFTER the lock, never as a column default.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text || ':' || NEW.user_id,0));
  PERFORM 1 FROM public.users a WHERE a.id IN (actor,NEW.user_id) ORDER BY a.id FOR SHARE;
  IF NOT public.vacation_history_scope(NEW.company_id,NEW.user_id,operation) THEN
    RAISE EXCEPTION 'Vacation history authority changed' USING ERRCODE='42501';
  END IF;
  SELECT a.role::text,a.branch_id INTO actor_role,actor_branch FROM public.users a WHERE a.id=actor;
  IF TG_TABLE_NAME='vacation_history_streams' THEN
    IF NEW.predecessor_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM public.vacation_history_streams s WHERE s.company_id=NEW.company_id AND s.user_id=NEW.user_id) THEN
        RAISE EXCEPTION 'Vacation history already has an opening' USING ERRCODE='23514';
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.vacation_history_streams s WHERE s.id=NEW.predecessor_id AND s.company_id=NEW.company_id AND s.user_id=NEW.user_id)
      OR EXISTS (SELECT 1 FROM public.vacation_history_streams s WHERE s.predecessor_id=NEW.predecessor_id) THEN
      RAISE EXCEPTION 'Vacation history predecessor is not the current head' USING ERRCODE='23514';
    END IF;
  ELSE
    IF NEW.kind='APPROVE_REQUEST' AND actor_role NOT IN ('SUPER_ADMIN','OWNER','ADMIN','GERENTE') THEN
      RAISE EXCEPTION 'Vacation history decision is not authorized' USING ERRCODE='42501';
    END IF;
    SELECT s.* INTO anchor FROM public.vacation_history_streams s
      WHERE s.id=NEW.stream_id AND s.company_id=NEW.company_id AND s.user_id=NEW.user_id;
    IF NOT FOUND OR EXISTS (SELECT 1 FROM public.vacation_history_streams s WHERE s.predecessor_id=NEW.stream_id) THEN
      RAISE EXCEPTION 'Vacation history stream is missing or superseded' USING ERRCODE='23514';
    END IF;
    IF NEW.kind='COVERAGE' THEN
      SELECT greatest(anchor.coverage_through,max(e.valid_through)) INTO through_day
        FROM public.vacation_history_events e WHERE e.stream_id=NEW.stream_id AND e.kind='COVERAGE';
      IF NEW.valid_from IS DISTINCT FROM anchor.coverage_from OR NEW.valid_through < through_day THEN
        RAISE EXCEPTION 'Vacation history coverage cannot shrink' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.kind='GRANT' THEN
      IF NEW.valid_from < anchor.coverage_from THEN
        RAISE EXCEPTION 'Vacation history grant predates its verified opening' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.kind='REVOKE_GRANT' THEN
      SELECT e.* INTO prior FROM public.vacation_history_events e WHERE e.id=NEW.reverses_event_id AND e.stream_id=NEW.stream_id;
      IF NOT FOUND OR prior.kind<>'GRANT' THEN
        RAISE EXCEPTION 'Vacation history grant reversal has no matching grant' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.kind IN ('APPROVE_REQUEST','CANCEL_REQUEST') THEN
      IF NEW.vacation_request_id IS NOT NULL AND NEW.leave_request_id IS NULL THEN
        SELECT v.company_id,v.user_id,v.branch_id,v.start_date::date AS start_day,v.end_date::date AS end_day,
          v.total_days,v.status::text,v.approved_by,v.approved_at,(v.cancelled_at IS NOT NULL) AS cancellation_recorded
          INTO subject FROM public.vacation_requests v WHERE v.id=NEW.vacation_request_id FOR SHARE;
      ELSIF NEW.leave_request_id IS NOT NULL AND NEW.vacation_request_id IS NULL THEN
        SELECT v.company_id,v.user_id,v.branch_id,v.start_date::date AS start_day,v.end_date::date AS end_day,
          v.total_days,v.status::text,v.approved_by,v.approved_at,true AS cancellation_recorded
          INTO subject FROM public.leave_requests v JOIN public.leave_types t ON t.id=v.leave_type_id
          AND t.company_id=v.company_id AND t.name='VACATION' WHERE v.id=NEW.leave_request_id FOR SHARE OF v;
      ELSE
        RAISE EXCEPTION 'Vacation history requires exactly one request source' USING ERRCODE='23514';
      END IF;
      IF NOT FOUND OR subject.company_id IS DISTINCT FROM NEW.company_id OR subject.user_id IS DISTINCT FROM NEW.user_id
        OR (subject.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id=subject.branch_id AND b.company_id=NEW.company_id)) THEN
        RAISE EXCEPTION 'Vacation history request scope is invalid' USING ERRCODE='23514';
      END IF;
      IF NEW.kind='APPROVE_REQUEST' THEN
        IF actor_role NOT IN ('SUPER_ADMIN','OWNER','ADMIN','GERENTE')
          OR (actor_role='GERENTE' AND actor_branch IS DISTINCT FROM subject.branch_id) THEN
          RAISE EXCEPTION 'Vacation history decision is not authorized' USING ERRCODE='42501';
        END IF;
        IF subject.status<>'APPROVED' OR subject.approved_by IS DISTINCT FROM actor OR subject.approved_at IS NULL
          OR NEW.valid_from IS DISTINCT FROM subject.start_day OR NEW.valid_through IS DISTINCT FROM subject.end_day
          OR NEW.days IS DISTINCT FROM subject.total_days THEN
          RAISE EXCEPTION 'Vacation history approval does not match its source' USING ERRCODE='23514';
        END IF;
      ELSE
        IF (actor_role='GERENTE' AND actor_branch IS DISTINCT FROM subject.branch_id)
          OR (actor_role IN ('SUPERVISOR','EMPLEADO') AND actor IS DISTINCT FROM subject.user_id) THEN
          RAISE EXCEPTION 'Vacation history cancellation is not authorized' USING ERRCODE='42501';
        END IF;
        SELECT e.* INTO prior FROM public.vacation_history_events e WHERE e.id=NEW.reverses_event_id AND e.stream_id=NEW.stream_id;
        IF NOT FOUND OR prior.kind<>'APPROVE_REQUEST'
          OR prior.vacation_request_id IS DISTINCT FROM NEW.vacation_request_id OR prior.leave_request_id IS DISTINCT FROM NEW.leave_request_id
          OR subject.status<>'CANCELLED' OR NOT subject.cancellation_recorded
          OR prior.valid_from IS DISTINCT FROM subject.start_day OR prior.valid_through IS DISTINCT FROM subject.end_day
          OR prior.days IS DISTINCT FROM subject.total_days THEN
          RAISE EXCEPTION 'Vacation history cancellation has no matching approval' USING ERRCODE='23514';
        END IF;
      END IF;
    ELSE
      RAISE EXCEPTION 'Unknown vacation history event' USING ERRCODE='23514';
    END IF;
  END IF;
  NEW.recorded_at := date_trunc('milliseconds',clock_timestamp());
  NEW.record_version := nextval('public.vacation_history_record_version_seq');
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vacation_history_insert_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER vacation_history_stream_insert BEFORE INSERT ON public.vacation_history_streams
  FOR EACH ROW EXECUTE FUNCTION public.vacation_history_insert_guard();--> statement-breakpoint
CREATE TRIGGER vacation_history_event_insert BEFORE INSERT ON public.vacation_history_events
  FOR EACH ROW EXECUTE FUNCTION public.vacation_history_insert_guard();--> statement-breakpoint
CREATE FUNCTION public.vacation_history_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Vacation history is append-only' USING ERRCODE='23514'; END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vacation_history_immutable() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER vacation_history_stream_immutable BEFORE UPDATE OR DELETE ON public.vacation_history_streams
  FOR EACH ROW EXECUTE FUNCTION public.vacation_history_immutable();--> statement-breakpoint
CREATE TRIGGER vacation_history_event_immutable BEFORE UPDATE OR DELETE ON public.vacation_history_events
  FOR EACH ROW EXECUTE FUNCTION public.vacation_history_immutable();--> statement-breakpoint
CREATE TRIGGER vacation_history_stream_no_truncate BEFORE TRUNCATE ON public.vacation_history_streams
  FOR EACH STATEMENT EXECUTE FUNCTION public.vacation_history_immutable();--> statement-breakpoint
CREATE TRIGGER vacation_history_event_no_truncate BEFORE TRUNCATE ON public.vacation_history_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.vacation_history_immutable();--> statement-breakpoint

ALTER TABLE public.vacation_history_streams FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.vacation_history_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.vacation_history_streams,public.vacation_history_events FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON SEQUENCE public.vacation_history_record_version_seq FROM PUBLIC;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pulso_vacations_app') THEN
    REVOKE ALL ON public.vacation_history_streams,public.vacation_history_events FROM pulso_vacations_app;
    REVOKE ALL ON SEQUENCE public.vacation_history_record_version_seq FROM pulso_vacations_app;
    GRANT USAGE ON SCHEMA public TO pulso_vacations_app;
    GRANT SELECT,INSERT ON public.vacation_history_streams,public.vacation_history_events TO pulso_vacations_app;
    GRANT EXECUTE ON FUNCTION public.vacation_history_scope(uuid,text,text) TO pulso_vacations_app;
  END IF;
END $$;
