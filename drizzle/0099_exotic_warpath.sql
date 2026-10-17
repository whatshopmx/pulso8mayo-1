CREATE TYPE "public"."exception_domain" AS ENUM('operacion', 'cumplimiento', 'equipos', 'personal', 'inventario', 'finanzas');--> statement-breakpoint
CREATE TYPE "public"."exception_severity" AS ENUM('info', 'warning', 'high', 'critical', 'fatal');--> statement-breakpoint
CREATE TYPE "public"."exception_status" AS ENUM('OPEN', 'ASSIGNED', 'IN_ACTION', 'RESOLVED', 'VERIFIED', 'CLOSED', 'REOPENED', 'ESCALATED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."qsr_risk_category" AS ENUM('DINERO', 'INOCUIDAD', 'ABASTO', 'PERSONAL');--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"domain" "exception_domain" NOT NULL,
	"qsr_category" "qsr_risk_category" NOT NULL,
	"severity" "exception_severity" DEFAULT 'warning' NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" "exception_status" DEFAULT 'OPEN' NOT NULL,
	"owner_id" text,
	"sla_due_at" timestamp,
	"action_meta" jsonb,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp,
	"verified_by" text,
	"verified_at" timestamp,
	"closed_at" timestamp,
	"evidence_id" uuid,
	"reopened_from_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_resolved_by_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_verified_by_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exceptions_company_subject_unique" ON "exceptions" USING btree ("company_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "exceptions_company_status_severity_sla_idx" ON "exceptions" USING btree ("company_id","status","severity","sla_due_at");--> statement-breakpoint
CREATE INDEX "exceptions_company_branch_status_idx" ON "exceptions" USING btree ("company_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "exceptions_owner_status_idx" ON "exceptions" USING btree ("owner_id","status");