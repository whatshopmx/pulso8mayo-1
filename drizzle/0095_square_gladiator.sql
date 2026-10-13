CREATE TYPE "public"."purchase_delegation_action" AS ENUM('REQUEST', 'EMIT');--> statement-breakpoint
CREATE TYPE "public"."purchase_delegation_scope" AS ENUM('COMPANY', 'BRANCH', 'CATEGORY');--> statement-breakpoint
CREATE TABLE "purchase_delegation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"action" "purchase_delegation_action" NOT NULL,
	"scope" "purchase_delegation_scope" NOT NULL,
	"branch_id" uuid,
	"category" text,
	"required_role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_delegation_rules" ADD CONSTRAINT "purchase_delegation_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_delegation_rules_company_idx" ON "purchase_delegation_rules" USING btree ("company_id","action");--> statement-breakpoint
CREATE INDEX "purchase_delegation_rules_branch_idx" ON "purchase_delegation_rules" USING btree ("company_id","branch_id");