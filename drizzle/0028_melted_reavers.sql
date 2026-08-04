CREATE TYPE "public"."branch_ownership" AS ENUM('OWNED', 'FRANCHISE');--> statement-breakpoint
CREATE TABLE "arco_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"request_type" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"fulfilled_at" timestamp,
	"fulfilled_by" text,
	"response_document_id" uuid
);
--> statement-breakpoint
CREATE TABLE "data_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text,
	"access_decision" jsonb,
	"redacted_fields" text,
	"ip_address" text,
	"user_agent" text,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"retention_until" timestamp
);
--> statement-breakpoint
CREATE TABLE "data_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"privacy_notice_version" text NOT NULL,
	"consent_type" text NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"ip_address" text,
	"user_agent" text,
	"proof_document_id" uuid
);
--> statement-breakpoint
CREATE TABLE "payment_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"payment_ref" text NOT NULL,
	"payment_ref_type" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" text,
	"second_approved_by" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp,
	"executed_at" timestamp,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "privacy_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"company_id" uuid,
	"content_url" text NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "privacy_notices_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "tenant_keys" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_dek" text NOT NULL,
	"dek_version" integer DEFAULT 1 NOT NULL,
	"rotated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "ownership_type" "branch_ownership" DEFAULT 'OWNED' NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "franchisee_user_id" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "franchise_agreement_ref" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "franchise_royalty_percent" integer;--> statement-breakpoint
ALTER TABLE "arco_requests" ADD CONSTRAINT "arco_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_access_logs" ADD CONSTRAINT "data_access_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_access_logs" ADD CONSTRAINT "data_access_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_consents" ADD CONSTRAINT "data_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_consents" ADD CONSTRAINT "data_consents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_approvals" ADD CONSTRAINT "payment_approvals_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_notices" ADD CONSTRAINT "privacy_notices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_keys" ADD CONSTRAINT "tenant_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;