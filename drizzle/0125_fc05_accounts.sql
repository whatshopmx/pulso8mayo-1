CREATE TABLE "accounting_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"normal_balance" text NOT NULL,
	"parent_id" uuid,
	"postable" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_accounts_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "accounting_accounts_code_check" CHECK ("accounting_accounts"."code" ~ '^[A-Z0-9][A-Z0-9._-]{0,31}$'),
	CONSTRAINT "accounting_accounts_name_check" CHECK ("accounting_accounts"."name" = btrim("accounting_accounts"."name") AND length("accounting_accounts"."name") BETWEEN 1 AND 160),
	CONSTRAINT "accounting_accounts_kind_check" CHECK ("accounting_accounts"."kind" IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
	CONSTRAINT "accounting_accounts_normal_balance_check" CHECK ("accounting_accounts"."normal_balance" IN ('DEBIT','CREDIT')),
	CONSTRAINT "accounting_accounts_dates_check" CHECK ("accounting_accounts"."valid_to" IS NULL OR "accounting_accounts"."valid_to" >= "accounting_accounts"."valid_from"),
	CONSTRAINT "accounting_accounts_parent_self_check" CHECK ("accounting_accounts"."parent_id" IS NULL OR "accounting_accounts"."parent_id" <> "accounting_accounts"."id")
);
--> statement-breakpoint
ALTER TABLE "accounting_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_source_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"bank_account_id" uuid,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_links_one_source_check" CHECK (("accounting_source_links"."cost_center_id" IS NOT NULL) <> ("accounting_source_links"."bank_account_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "accounting_source_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_accounts" ADD CONSTRAINT "accounting_accounts_parent_company_fk" FOREIGN KEY ("company_id","parent_id") REFERENCES "public"."accounting_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_source_links" ADD CONSTRAINT "accounting_source_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_source_links" ADD CONSTRAINT "accounting_source_links_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_source_links" ADD CONSTRAINT "accounting_links_account_company_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."accounting_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_source_links" ADD CONSTRAINT "accounting_links_cost_center_company_fk" FOREIGN KEY ("company_id","cost_center_id") REFERENCES "public"."cost_centers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_source_links" ADD CONSTRAINT "accounting_links_bank_company_fk" FOREIGN KEY ("company_id","bank_account_id") REFERENCES "public"."company_bank_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_accounts_company_code_unique" ON "accounting_accounts" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "accounting_accounts_parent_idx" ON "accounting_accounts" USING btree ("company_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_links_cost_center_unique" ON "accounting_source_links" USING btree ("company_id","cost_center_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_links_bank_unique" ON "accounting_source_links" USING btree ("company_id","bank_account_id");--> statement-breakpoint
CREATE INDEX "accounting_links_account_idx" ON "accounting_source_links" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE POLICY "accounting_accounts_tenant" ON "accounting_accounts" AS PERMISSIVE FOR ALL TO public USING ("accounting_accounts"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_accounts"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_links_tenant" ON "accounting_source_links" AS PERMISSIVE FOR ALL TO public USING ("accounting_source_links"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_source_links"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);
