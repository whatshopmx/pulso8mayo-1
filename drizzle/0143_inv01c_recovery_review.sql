CREATE TABLE "sale_recovery_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"proposal_hash" text NOT NULL,
	"state_hash" text NOT NULL,
	"requested_by" text NOT NULL,
	"decision" text NOT NULL,
	"decided_by" text NOT NULL,
	"approver_role" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_recovery_decision_unique" UNIQUE("proposal_id"),
	CONSTRAINT "sale_recovery_decision_check" CHECK ("sale_recovery_decisions"."decision" IN ('APPROVED','REJECTED') AND "sale_recovery_decisions"."approver_role" IN ('ADMIN','OWNER','SUPER_ADMIN')),
	CONSTRAINT "sale_recovery_reviewer_check" CHECK ("sale_recovery_decisions"."decided_by" <> "sale_recovery_decisions"."requested_by" AND "sale_recovery_decisions"."decided_by" = btrim("sale_recovery_decisions"."decided_by") AND length("sale_recovery_decisions"."decided_by") BETWEEN 1 AND 256)
);
--> statement-breakpoint
ALTER TABLE "sale_recovery_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sale_recovery_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"legacy_sale_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"proposal_hash" text NOT NULL,
	"state_hash" text NOT NULL,
	"requested_by" text NOT NULL,
	"reason" text NOT NULL,
	"proposal" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_recovery_idempotency_unique" UNIQUE("company_id","idempotency_key"),
	CONSTRAINT "sale_recovery_review_target_unique" UNIQUE("id","company_id","branch_id","proposal_hash","state_hash","requested_by"),
	CONSTRAINT "sale_recovery_hashes_check" CHECK ("sale_recovery_proposals"."proposal_hash" ~ '^[a-f0-9]{64}$' AND "sale_recovery_proposals"."state_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "sale_recovery_request_check" CHECK ("sale_recovery_proposals"."requested_by" = btrim("sale_recovery_proposals"."requested_by") AND length("sale_recovery_proposals"."requested_by") BETWEEN 1 AND 256
            AND "sale_recovery_proposals"."reason" = btrim("sale_recovery_proposals"."reason") AND length("sale_recovery_proposals"."reason") BETWEEN 1 AND 2000),
	CONSTRAINT "sale_recovery_envelope_check" CHECK ((jsonb_typeof("sale_recovery_proposals"."proposal") = 'object'
            AND "sale_recovery_proposals"."proposal"->'identity'->>'companyId' = "sale_recovery_proposals"."company_id"::text
            AND "sale_recovery_proposals"."proposal"->'identity'->>'branchId' = "sale_recovery_proposals"."branch_id"::text
            AND "sale_recovery_proposals"."proposal"->'legacy'->>'id' = "sale_recovery_proposals"."legacy_sale_id"::text
            AND "sale_recovery_proposals"."proposal"->>'requestedBy' = "sale_recovery_proposals"."requested_by"
            AND "sale_recovery_proposals"."proposal"->>'idempotencyKey' = "sale_recovery_proposals"."idempotency_key"::text
            AND "sale_recovery_proposals"."proposal"->>'reason' = "sale_recovery_proposals"."reason"
            AND jsonb_typeof("sale_recovery_proposals"."proposal"->'evidence') = 'array'
            AND jsonb_array_length("sale_recovery_proposals"."proposal"->'evidence') BETWEEN 3 AND 100) IS TRUE)
);
--> statement-breakpoint
ALTER TABLE "sale_recovery_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_recovery_decisions" ADD CONSTRAINT "sale_recovery_decision_target_fk" FOREIGN KEY ("proposal_id","company_id","branch_id","proposal_hash","state_hash","requested_by") REFERENCES "public"."sale_recovery_proposals"("id","company_id","branch_id","proposal_hash","state_hash","requested_by") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_recovery_proposals" ADD CONSTRAINT "sale_recovery_proposals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_recovery_proposals" ADD CONSTRAINT "sale_recovery_proposals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_recovery_proposals" ADD CONSTRAINT "sale_recovery_proposals_legacy_sale_id_sales_entries_id_fk" FOREIGN KEY ("legacy_sale_id") REFERENCES "public"."sales_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_recovery_legacy_idx" ON "sale_recovery_proposals" USING btree ("company_id","branch_id","legacy_sale_id");--> statement-breakpoint
CREATE POLICY "sale_recovery_decision_tenant" ON "sale_recovery_decisions" AS PERMISSIVE FOR ALL TO public USING ("sale_recovery_decisions"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
            OR "sale_recovery_decisions"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid)) WITH CHECK ("sale_recovery_decisions"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
            OR "sale_recovery_decisions"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid));--> statement-breakpoint
CREATE POLICY "sale_recovery_proposal_tenant" ON "sale_recovery_proposals" AS PERMISSIVE FOR ALL TO public USING ("sale_recovery_proposals"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
            OR "sale_recovery_proposals"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid)) WITH CHECK ("sale_recovery_proposals"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
            OR "sale_recovery_proposals"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid) AND EXISTS (SELECT 1 FROM public.sales_entries s WHERE s.id="sale_recovery_proposals"."legacy_sale_id"
                AND s.company_id="sale_recovery_proposals"."company_id" AND s.branch_id="sale_recovery_proposals"."branch_id")
                AND EXISTS (SELECT 1 FROM public.branches b WHERE b.id="sale_recovery_proposals"."branch_id" AND b.company_id="sale_recovery_proposals"."company_id"));
--> statement-breakpoint
-- INV-01.c: facts remain append-only; no recovery/backfill is executed here.
ALTER TABLE public.sale_recovery_proposals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.sale_recovery_decisions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION public.sale_recovery_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sale recovery proposals and decisions are immutable' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER sale_recovery_proposal_immutable BEFORE UPDATE OR DELETE
ON public.sale_recovery_proposals FOR EACH ROW EXECUTE FUNCTION public.sale_recovery_immutable();
--> statement-breakpoint
CREATE TRIGGER sale_recovery_decision_immutable BEFORE UPDATE OR DELETE
ON public.sale_recovery_decisions FOR EACH ROW EXECUTE FUNCTION public.sale_recovery_immutable();
--> statement-breakpoint
CREATE FUNCTION public.sale_recovery_decision_timeline() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE submitted_at timestamptz;
BEGIN
  SELECT created_at INTO submitted_at FROM public.sale_recovery_proposals WHERE id = NEW.proposal_id;
  IF NEW.decided_at < submitted_at THEN
    RAISE EXCEPTION 'Recovery decision cannot precede its proposal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sale_recovery_decision_timeline BEFORE INSERT
ON public.sale_recovery_decisions FOR EACH ROW EXECUTE FUNCTION public.sale_recovery_decision_timeline();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT ON public.sale_recovery_proposals, public.sale_recovery_decisions TO pulso_app;
  END IF;
END $$;
