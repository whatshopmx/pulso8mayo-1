-- APR-01: Alinear aprobación de documentos (OC, OS, factura, gasto, pago y nómina)
-- Migración candidata: NO aplicar a operativo fuera de OPS-03.

CREATE TABLE IF NOT EXISTS "document_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "branch_id" uuid REFERENCES "branches"("id"),
  "doc_type" text NOT NULL CHECK ("doc_type" IN ('OC', 'OS', 'INVOICE', 'EXPENSE', 'PAYMENT_RUN', 'PAYROLL')),
  "doc_id" uuid NOT NULL,
  "approval_version" integer NOT NULL CHECK ("approval_version" >= 1),
  "status" text NOT NULL DEFAULT 'APPROVED' CHECK ("status" IN ('APPROVED', 'INVALIDATED')),
  "material_fingerprint" text NOT NULL,
  "material_snapshot" jsonb NOT NULL,
  "required_role" text NOT NULL,
  "authority_source" text NOT NULL,
  "approved_by" text NOT NULL REFERENCES "users"("id"),
  "approved_by_role" text NOT NULL,
  "secondary_approved_by" text REFERENCES "users"("id"),
  "approval_reason" text,
  "evidence_id" uuid,
  "approved_at" timestamp DEFAULT now() NOT NULL,
  "invalidated_at" timestamp,
  "invalidated_by" text REFERENCES "users"("id"),
  "invalidation_reason" text,
  "changed_fields" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "document_approvals_company_doc_version_unique"
  ON "document_approvals" ("company_id", "doc_type", "doc_id", "approval_version");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "document_approvals_active_approved_unique"
  ON "document_approvals" ("company_id", "doc_type", "doc_id")
  WHERE ("status" = 'APPROVED');--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "document_approvals_company_doc_idx"
  ON "document_approvals" ("company_id", "doc_type", "doc_id");--> statement-breakpoint

ALTER TABLE "document_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_approvals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS "document_approvals_tenant_isolation" ON "document_approvals";--> statement-breakpoint
CREATE POLICY "document_approvals_tenant_isolation"
  ON "document_approvals"
  AS PERMISSIVE
  FOR ALL
  USING ("company_id" = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK ("company_id" = NULLIF(current_setting('app.current_company_id', true), '')::uuid);--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulso_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE "document_approvals" TO pulso_app;
  END IF;
END $$;
