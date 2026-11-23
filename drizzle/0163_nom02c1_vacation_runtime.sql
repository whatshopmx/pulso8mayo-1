-- Narrow SECURITY DEFINER predicate: the runtime cannot read users/branches.
-- The context comes from the authenticated server transaction, never the body.
CREATE FUNCTION public.vacation_request_scope(p_company uuid, p_branch uuid, p_user text, p_operation text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT coalesce(
    p_company = nullif(current_setting('app.current_company_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.users a
      WHERE a.id = nullif(current_setting('app.current_actor_id', true), '')
        AND a.company_id = p_company AND a.deleted_at IS NULL
        AND (a.role::text IN ('SUPER_ADMIN','OWNER','ADMIN')
          OR (a.role::text IN ('GERENTE','SUPERVISOR','EMPLEADO','READONLY') AND a.branch_id = p_branch))
        AND ((p_operation = 'read' AND (a.role::text <> 'EMPLEADO' OR p_user = a.id))
          OR (p_operation IN ('request','write') AND (a.role::text IN ('SUPER_ADMIN','OWNER','ADMIN','GERENTE')
            OR (a.role::text IN ('SUPERVISOR','EMPLEADO') AND p_user = a.id)))
          OR (p_operation = 'decide' AND a.role::text IN ('SUPER_ADMIN','OWNER','ADMIN','GERENTE'))))
    AND EXISTS (SELECT 1 FROM public.users s WHERE s.id = p_user AND s.company_id = p_company
      AND (p_operation <> 'request' OR (s.deleted_at IS NULL AND s.branch_id IS NOT DISTINCT FROM p_branch)))
    AND (p_branch IS NULL OR EXISTS (SELECT 1 FROM public.branches b WHERE b.id = p_branch AND b.company_id = p_company)),
    false);
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vacation_request_scope(uuid,uuid,text,text) FROM PUBLIC;--> statement-breakpoint
ALTER TABLE "vacation_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "vacation_runtime_read" ON "vacation_requests" AS PERMISSIVE FOR SELECT TO public USING (public.vacation_request_scope("vacation_requests"."company_id", "vacation_requests"."branch_id", "vacation_requests"."user_id", 'read'));--> statement-breakpoint
CREATE POLICY "vacation_payroll_read" ON "vacation_requests" AS PERMISSIVE FOR SELECT TO public USING (current_user = 'pulso_app'
            AND "vacation_requests"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
            AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
                OR "vacation_requests"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "vacation_runtime_insert" ON "vacation_requests" AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.vacation_request_scope("vacation_requests"."company_id", "vacation_requests"."branch_id", "vacation_requests"."user_id", 'request')
            AND "vacation_requests"."status" = 'PENDING' AND "vacation_requests"."approved_by" IS NULL AND "vacation_requests"."approved_at" IS NULL
            AND "vacation_requests"."rejected_by" IS NULL AND "vacation_requests"."rejected_at" IS NULL AND "vacation_requests"."cancelled_at" IS NULL);--> statement-breakpoint
CREATE POLICY "vacation_runtime_update" ON "vacation_requests" AS PERMISSIVE FOR UPDATE TO public USING (public.vacation_request_scope("vacation_requests"."company_id", "vacation_requests"."branch_id", "vacation_requests"."user_id", 'write')) WITH CHECK (public.vacation_request_scope("vacation_requests"."company_id", "vacation_requests"."branch_id", "vacation_requests"."user_id",
            CASE WHEN "vacation_requests"."status" IN ('APPROVED','REJECTED') THEN 'decide'
                WHEN "vacation_requests"."status" = 'CANCELLED' THEN 'write' ELSE 'invalid' END));--> statement-breakpoint
CREATE FUNCTION public.vacation_request_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE actor text := nullif(current_setting('app.current_actor_id', true), '');
BEGIN
  IF NOT ((OLD.status = 'PENDING' AND NEW.status IN ('APPROVED','REJECTED','CANCELLED'))
      OR (OLD.status = 'APPROVED' AND NEW.status IN ('CANCELLED','COMPLETED'))) THEN
    RAISE EXCEPTION 'Invalid vacation transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'APPROVED' THEN
    IF actor IS NULL OR NEW.approved_by IS DISTINCT FROM actor OR NEW.approved_at IS NULL
      OR ROW(NEW.rejected_by,NEW.rejected_at,NEW.cancelled_at,NEW.rejection_reason)
        IS DISTINCT FROM ROW(OLD.rejected_by,OLD.rejected_at,OLD.cancelled_at,OLD.rejection_reason) THEN
      RAISE EXCEPTION 'Invalid vacation approval provenance' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = 'REJECTED' THEN
    IF actor IS NULL OR NEW.rejected_by IS DISTINCT FROM actor OR NEW.rejected_at IS NULL
      OR ROW(NEW.approved_by,NEW.approved_at,NEW.cancelled_at,NEW.manager_comments)
        IS DISTINCT FROM ROW(OLD.approved_by,OLD.approved_at,OLD.cancelled_at,OLD.manager_comments) THEN
      RAISE EXCEPTION 'Invalid vacation rejection provenance' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (NEW.status = 'CANCELLED' AND NEW.cancelled_at IS NULL)
      OR ROW(NEW.approved_by,NEW.approved_at,NEW.rejected_by,NEW.rejected_at,NEW.manager_comments,NEW.rejection_reason)
        IS DISTINCT FROM ROW(OLD.approved_by,OLD.approved_at,OLD.rejected_by,OLD.rejected_at,OLD.manager_comments,OLD.rejection_reason) THEN
      RAISE EXCEPTION 'Vacation provenance is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.vacation_request_transition_guard() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER vacation_request_transition_guard BEFORE UPDATE ON public.vacation_requests
FOR EACH ROW EXECUTE FUNCTION public.vacation_request_transition_guard();--> statement-breakpoint
-- Role provisioning is an explicit deployment prerequisite, never a password in SQL.
-- No FORCE: owner/legacy callers remain a separate, unaccepted deployment path;
-- the HTTP selector must reject owners and every bypass/elevated role.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pulso_vacations_app') THEN
    GRANT USAGE ON SCHEMA public TO pulso_vacations_app;
    GRANT SELECT, INSERT ON public.vacation_requests TO pulso_vacations_app;
    GRANT UPDATE (status,approved_by,approved_at,rejected_by,rejected_at,cancelled_at,manager_comments,rejection_reason,updated_at)
      ON public.vacation_requests TO pulso_vacations_app;
    GRANT EXECUTE ON FUNCTION public.vacation_request_scope(uuid,uuid,text,text) TO pulso_vacations_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pulso_app') THEN
    GRANT SELECT ON public.vacation_requests TO pulso_app;
    GRANT EXECUTE ON FUNCTION public.vacation_request_scope(uuid,uuid,text,text) TO pulso_app;
  END IF;
END $$;
