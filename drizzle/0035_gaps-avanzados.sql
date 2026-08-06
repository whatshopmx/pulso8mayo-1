CREATE TABLE "company_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"monthly_price_cents" integer DEFAULT 0 NOT NULL,
	"max_branches" integer NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbook_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'PUBLISHED' NOT NULL,
	"published_by" text,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbook_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text,
	"description" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"change_note" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "morning_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brief_date" text NOT NULL,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"twin_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "scope" text DEFAULT 'branch' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_tier_id_subscription_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."subscription_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_publications" ADD CONSTRAINT "playbook_publications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_publications" ADD CONSTRAINT "playbook_publications_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "morning_briefs" ADD CONSTRAINT "morning_briefs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_subscriptions_company_unique" ON "company_subscriptions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_subscriptions_tier_idx" ON "company_subscriptions" USING btree ("tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_tiers_slug_unique" ON "subscription_tiers" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "playbook_publications_template_branch_unique" ON "playbook_publications" USING btree ("template_id","branch_id");--> statement-breakpoint
CREATE INDEX "playbook_publications_company_idx" ON "playbook_publications" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "playbook_publications_branch_idx" ON "playbook_publications" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "playbook_versions_template_version_unique" ON "playbook_versions" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "morning_briefs_company_date_unique" ON "morning_briefs" USING btree ("company_id","brief_date");--> statement-breakpoint
CREATE INDEX "morning_briefs_company_generated_idx" ON "morning_briefs" USING btree ("company_id","generated_at");