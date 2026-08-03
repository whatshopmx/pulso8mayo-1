CREATE TYPE "public"."civil_drill_result" AS ENUM('EXITOSO', 'ACEPTABLE', 'REQUIERE_MEJORA', 'FALLIDO');--> statement-breakpoint
CREATE TYPE "public"."civil_drill_type" AS ENUM('EVACUACION', 'CONFINAMIENTO', 'SIMULACRO_GENERAL', 'SISMO', 'INCENDIO', 'OTRO');--> statement-breakpoint
CREATE TYPE "public"."civil_extinguisher_status" AS ENUM('OPTIMO', 'ACEPTABLE', 'REQUIERE_RECARGA', 'DESCARTADO', 'PERDIDO');--> statement-breakpoint
CREATE TABLE "civil_protection_drills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"drill_type" "civil_drill_type" NOT NULL,
	"result" "civil_drill_result",
	"drill_date" timestamp NOT NULL,
	"participants_count" integer,
	"evacuation_time_sec" integer,
	"activated_alarm" boolean DEFAULT true,
	"observations" text,
	"evidence_urls" jsonb DEFAULT '[]'::jsonb,
	"report_url" text,
	"coordinator_name" text,
	"coordinator_phone" text,
	"workflow_instance_id" uuid,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exit_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"exit_location" text NOT NULL,
	"is_clear" boolean NOT NULL,
	"signage_ok" boolean NOT NULL,
	"emergency_light_ok" boolean NOT NULL,
	"door_opens_ok" boolean NOT NULL,
	"access_width_cm" integer,
	"photo_url" text,
	"photos" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"issues_detected" text,
	"inspected_at" timestamp NOT NULL,
	"inspected_by" text NOT NULL,
	"inspection_round" text,
	"workflow_instance_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extinguisher_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"extinguisher_id" text NOT NULL,
	"location" text NOT NULL,
	"extinguisher_type" text,
	"capacity_kg" integer,
	"inspection_date" timestamp NOT NULL,
	"pressure_ok" boolean,
	"seal_ok" boolean,
	"hose_ok" boolean,
	"label_ok" boolean,
	"general_status" "civil_extinguisher_status",
	"expiration_date" timestamp,
	"last_recharge_date" timestamp,
	"next_inspection_date" timestamp,
	"ocr_raw_data" jsonb,
	"ocr_processed_at" timestamp,
	"evidence_url" text,
	"inspector_name" text,
	"inspector_notes" text,
	"workflow_instance_id" uuid,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "civil_protection_drills" ADD CONSTRAINT "civil_protection_drills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civil_protection_drills" ADD CONSTRAINT "civil_protection_drills_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civil_protection_drills" ADD CONSTRAINT "civil_protection_drills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civil_protection_drills" ADD CONSTRAINT "civil_protection_drills_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_checklist_items" ADD CONSTRAINT "exit_checklist_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_checklist_items" ADD CONSTRAINT "exit_checklist_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exit_checklist_items" ADD CONSTRAINT "exit_checklist_items_inspected_by_users_id_fk" FOREIGN KEY ("inspected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extinguisher_inspections" ADD CONSTRAINT "extinguisher_inspections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extinguisher_inspections" ADD CONSTRAINT "extinguisher_inspections_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extinguisher_inspections" ADD CONSTRAINT "extinguisher_inspections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extinguisher_inspections" ADD CONSTRAINT "extinguisher_inspections_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cp_drills_company_idx" ON "civil_protection_drills" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "cp_drills_branch_idx" ON "civil_protection_drills" USING btree ("branch_id","drill_date");--> statement-breakpoint
CREATE INDEX "cp_exits_branch_idx" ON "exit_checklist_items" USING btree ("branch_id","inspected_at");--> statement-breakpoint
CREATE INDEX "cp_ext_branch_idx" ON "extinguisher_inspections" USING btree ("branch_id","inspection_date");--> statement-breakpoint
CREATE INDEX "cp_ext_company_idx" ON "extinguisher_inspections" USING btree ("company_id","extinguisher_id");