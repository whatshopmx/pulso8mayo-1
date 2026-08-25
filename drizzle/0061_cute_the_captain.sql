CREATE TYPE "public"."approval_doc_type" AS ENUM('OC', 'OS');--> statement-breakpoint
CREATE TYPE "public"."approval_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('ANTES', 'DESPUES');--> statement-breakpoint
CREATE TYPE "public"."purchase_type" AS ENUM('PROGRAMADA', 'STOCK', 'EMERGENCIA');--> statement-breakpoint
CREATE TYPE "public"."service_order_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'IN_PROGRESS', 'PENDING_CONFORMITY', 'CLOSED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."service_order_type" AS ENUM('CORRECTIVO', 'PREVENTIVO', 'CONTRACTUAL', 'EXTRAORDINARIO');--> statement-breakpoint
CREATE TYPE "public"."service_urgency" AS ENUM('NORMAL', 'URGENTE', 'EMERGENCIA');--> statement-breakpoint
CREATE TABLE "approval_matrix_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"doc_type" "approval_doc_type" NOT NULL,
	"amount_min" integer NOT NULL,
	"amount_max" integer,
	"required_role" text NOT NULL,
	"min_quotes" integer DEFAULT 1 NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_type" "approval_doc_type" NOT NULL,
	"doc_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"required_role" text NOT NULL,
	"min_quotes" integer DEFAULT 1 NOT NULL,
	"status" "approval_request_status" DEFAULT 'PENDING' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"cost_center_id" uuid NOT NULL,
	"month" text NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"accounting_line" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_order_id" uuid NOT NULL,
	"type" "evidence_type" NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_order_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_order_id" uuid NOT NULL,
	"url" text NOT NULL,
	"supplier_name" text,
	"amount" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"folio" text NOT NULL,
	"type" "service_order_type" NOT NULL,
	"urgency" "service_urgency" DEFAULT 'NORMAL' NOT NULL,
	"status" "service_order_status" DEFAULT 'DRAFT' NOT NULL,
	"equipment_id" uuid,
	"compliance_service_id" uuid,
	"scope" text,
	"justification" text,
	"technical_report" text,
	"supplier_id" uuid,
	"amount" integer,
	"scheduled_date" timestamp,
	"completed_at" timestamp,
	"cost_center_id" uuid,
	"conformity_signed_by" text,
	"conformity_signed_at" timestamp,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_orders_folio_unique" UNIQUE("folio")
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "purchase_type" "purchase_type" DEFAULT 'PROGRAMADA';--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "cost_center_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "folio_year" integer;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "folio_sequence" integer;--> statement-breakpoint
ALTER TABLE "approval_matrix_rules" ADD CONSTRAINT "approval_matrix_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_budgets" ADD CONSTRAINT "branch_budgets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_budgets" ADD CONSTRAINT "branch_budgets_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_evidence" ADD CONSTRAINT "service_order_evidence_service_order_id_service_orders_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_order_quotes" ADD CONSTRAINT "service_order_quotes_service_order_id_service_orders_id_fk" FOREIGN KEY ("service_order_id") REFERENCES "public"."service_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_compliance_service_id_branch_compliance_services_id_fk" FOREIGN KEY ("compliance_service_id") REFERENCES "public"."branch_compliance_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_matrix_rules_company_idx" ON "approval_matrix_rules" USING btree ("company_id","doc_type");--> statement-breakpoint
CREATE INDEX "approval_requests_doc_idx" ON "approval_requests" USING btree ("doc_type","doc_id");--> statement-breakpoint
CREATE INDEX "approval_requests_pending_idx" ON "approval_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "branch_budgets_branch_cc_month_unique" ON "branch_budgets" USING btree ("branch_id","cost_center_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centers_company_code_unique" ON "cost_centers" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "service_orders_company_branch_idx" ON "service_orders" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "service_orders_status_idx" ON "service_orders" USING btree ("status");