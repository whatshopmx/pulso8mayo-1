CREATE TYPE "public"."evidence_entity_type" AS ENUM('WORKFLOW_STEP', 'INCIDENT', 'DOCUMENT', 'EXPENSE', 'SERVICE_ORDER', 'WASTE', 'RECEIVING', 'GENERAL');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('PHOTO', 'FILE', 'VOICE', 'VIDEO', 'TEXT');--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"entity_type" "evidence_entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"kind" "evidence_kind" DEFAULT 'PHOTO' NOT NULL,
	"mime_type" text,
	"url" text NOT NULL,
	"storage_key" text,
	"ai_metadata" jsonb,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_company_entity_idx" ON "evidence" USING btree ("company_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "evidence_company_branch_idx" ON "evidence" USING btree ("company_id","branch_id");--> statement-breakpoint
CREATE INDEX "evidence_created_by_idx" ON "evidence" USING btree ("created_by");