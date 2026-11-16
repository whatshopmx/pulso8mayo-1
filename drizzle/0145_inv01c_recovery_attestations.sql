CREATE TABLE "sale_recovery_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"legacy_sale_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"purpose" text NOT NULL,
	"storage_key" text NOT NULL,
	"evidence_updated_at" timestamp NOT NULL,
	"content_sha256" text NOT NULL,
	"byte_length" integer NOT NULL,
	"source_reference" text NOT NULL,
	"reason" text NOT NULL,
	"verified_by" text NOT NULL,
	"verified_role" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "sale_recovery_attestation_idempotency_unique" UNIQUE("company_id","idempotency_key"),
	CONSTRAINT "sale_recovery_attestation_purpose_check" CHECK ("sale_recovery_attestations"."purpose" IN ('SALE','RECIPE_VERSION','NO_PRIOR_CONSUMPTION')),
	CONSTRAINT "sale_recovery_attestation_actor_check" CHECK ("sale_recovery_attestations"."verified_role" IN ('ADMIN','OWNER','SUPER_ADMIN')
            AND "sale_recovery_attestations"."verified_by" = btrim("sale_recovery_attestations"."verified_by") AND length("sale_recovery_attestations"."verified_by") BETWEEN 1 AND 256),
	CONSTRAINT "sale_recovery_attestation_content_check" CHECK ("sale_recovery_attestations"."content_sha256" ~ '^[a-f0-9]{64}$' AND "sale_recovery_attestations"."byte_length" BETWEEN 1 AND 20971520),
	CONSTRAINT "sale_recovery_attestation_source_check" CHECK ("sale_recovery_attestations"."source_reference" = btrim("sale_recovery_attestations"."source_reference") AND length("sale_recovery_attestations"."source_reference") BETWEEN 1 AND 2000
            AND "sale_recovery_attestations"."reason" = btrim("sale_recovery_attestations"."reason") AND length("sale_recovery_attestations"."reason") BETWEEN 1 AND 2000),
	CONSTRAINT "sale_recovery_attestation_key_check" CHECK ("sale_recovery_attestations"."storage_key" = 'companies/' || "sale_recovery_attestations"."company_id"::text
            || '/branches/' || "sale_recovery_attestations"."branch_id"::text || '/sales-recovery/' || "sale_recovery_attestations"."legacy_sale_id"::text || '/' || "sale_recovery_attestations"."evidence_id"::text),
	CONSTRAINT "sale_recovery_attestation_time_check" CHECK (isfinite("sale_recovery_attestations"."verified_at") AND isfinite("sale_recovery_attestations"."evidence_updated_at"))
);
--> statement-breakpoint
ALTER TABLE "sale_recovery_attestations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_recovery_attestations" ADD CONSTRAINT "sale_recovery_attestations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_recovery_attestations" ADD CONSTRAINT "sale_recovery_attestations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_recovery_attestations" ADD CONSTRAINT "sale_recovery_attestations_legacy_sale_id_sales_entries_id_fk" FOREIGN KEY ("legacy_sale_id") REFERENCES "public"."sales_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_recovery_attestations" ADD CONSTRAINT "sale_recovery_attestations_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_recovery_attestations" ADD CONSTRAINT "sale_recovery_attestations_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_recovery_attestation_subject_idx" ON "sale_recovery_attestations" USING btree ("company_id","branch_id","legacy_sale_id");--> statement-breakpoint
CREATE POLICY "sale_recovery_attestation_tenant" ON "sale_recovery_attestations" AS PERMISSIVE FOR ALL TO public USING ("sale_recovery_attestations"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
            OR "sale_recovery_attestations"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid)) WITH CHECK ("sale_recovery_attestations"."company_id" = nullif(current_setting('app.current_company_id', true), '')::uuid
        AND (nullif(current_setting('app.current_branch_id', true), '') IS NULL
            OR "sale_recovery_attestations"."branch_id" = nullif(current_setting('app.current_branch_id', true), '')::uuid) AND "sale_recovery_attestations"."verified_by" = nullif(current_setting('app.current_actor_id', true), '')
                AND EXISTS (SELECT 1 FROM public.evidence e
                  JOIN public.sales_entries s ON s.id = "sale_recovery_attestations"."legacy_sale_id" AND s.id::text = e.entity_id
                  JOIN public.branches b ON b.id = s.branch_id AND b.company_id = s.company_id
                  WHERE e.id = "sale_recovery_attestations"."evidence_id" AND e.entity_type = 'SALE_RECOVERY' AND e.deleted_at IS NULL
                    AND e.company_id = "sale_recovery_attestations"."company_id" AND e.branch_id = "sale_recovery_attestations"."branch_id"
                    AND s.company_id = "sale_recovery_attestations"."company_id" AND s.branch_id = "sale_recovery_attestations"."branch_id"
                    AND e.storage_key = "sale_recovery_attestations"."storage_key" AND e.updated_at = "sale_recovery_attestations"."evidence_updated_at"
                    AND "sale_recovery_attestations"."verified_at" >= e.created_at AT TIME ZONE 'UTC'
                    AND "sale_recovery_attestations"."verified_at" >= e.updated_at AT TIME ZONE 'UTC'));
--> statement-breakpoint
-- Documentary facts are append-only; no approval, stock application or backfill.
ALTER TABLE public.sale_recovery_attestations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION public.sale_recovery_attestation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sale recovery attestations are immutable' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER sale_recovery_attestation_immutable BEFORE UPDATE OR DELETE
ON public.sale_recovery_attestations FOR EACH ROW EXECUTE FUNCTION public.sale_recovery_attestation_immutable();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT ON public.sale_recovery_attestations TO pulso_app;
  END IF;
END $$;
