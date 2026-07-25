CREATE TYPE "public"."inventory_audit_action" AS ENUM('CREATE', 'UPDATE', 'DELETE');--> statement-breakpoint
CREATE TYPE "public"."inventory_audit_entity" AS ENUM('ITEM', 'BATCH', 'MOVEMENT', 'TRANSFER', 'WASTE', 'RECEIVING', 'ADJUSTMENT', 'SUPPLIER');--> statement-breakpoint
CREATE TYPE "public"."remediation_action_status" AS ENUM('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."storage_location_type" AS ENUM('DRY_STORAGE', 'REFRIGERATOR', 'FREEZER', 'BAR', 'KITCHEN', 'PRODUCTION', 'PACKAGING', 'OTHER');--> statement-breakpoint
ALTER TYPE "public"."incident_status" ADD VALUE 'AWAITING_EXTERNAL' BEFORE 'RESOLVED';--> statement-breakpoint
ALTER TYPE "public"."incident_status" ADD VALUE 'CONFIRMED' BEFORE 'RESOLVED';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'OWNER' BEFORE 'ADMIN';--> statement-breakpoint
CREATE TABLE "employee_training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"course_name" text NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	"score" integer NOT NULL,
	"certificate_url" text,
	"status" text DEFAULT 'ACTIVE',
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"action" "inventory_audit_action" NOT NULL,
	"entity_type" "inventory_audit_entity" NOT NULL,
	"entity_id" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"performed_by" text NOT NULL,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_snapshot_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"snapshot_type" text NOT NULL,
	"snapshot_date" timestamp NOT NULL,
	"metrics" jsonb NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remediation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"service_config_id" uuid,
	"branch_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"service_type" text NOT NULL,
	"workflow_template_id" text,
	"status" "remediation_action_status" DEFAULT 'PENDING',
	"confirmed_by" text,
	"confirmed_at" timestamp,
	"scheduled_date" timestamp,
	"schedule_id" uuid,
	"workflow_instance_id" uuid,
	"completed_at" timestamp,
	"result" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "storage_location_type" DEFAULT 'DRY_STORAGE' NOT NULL,
	"active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "unit_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"from_unit" text NOT NULL,
	"to_unit" text NOT NULL,
	"factor" integer NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "workflow_templates" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "workflow_templates" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workflow_templates" ALTER COLUMN "company_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "holidays" ALTER COLUMN "date" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "from_location_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "to_location_id" uuid;--> statement-breakpoint
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_service_config_id_branch_compliance_services_id_fk" FOREIGN KEY ("service_config_id") REFERENCES "public"."branch_compliance_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_conversions" ADD CONSTRAINT "unit_conversions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;