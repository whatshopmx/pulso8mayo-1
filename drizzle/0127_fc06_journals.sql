CREATE TABLE "accounting_journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"debit_cents" bigint DEFAULT 0 NOT NULL,
	"credit_cents" bigint DEFAULT 0 NOT NULL,
	"memo" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_journal_lines_number_unique" UNIQUE("company_id","journal_id","line_number"),
	CONSTRAINT "accounting_journal_lines_number_check" CHECK ("accounting_journal_lines"."line_number" BETWEEN 1 AND 999),
	CONSTRAINT "accounting_journal_lines_side_check" CHECK (("accounting_journal_lines"."debit_cents" > 0) <> ("accounting_journal_lines"."credit_cents" > 0)),
	CONSTRAINT "accounting_journal_lines_range_check" CHECK ("accounting_journal_lines"."debit_cents" >= 0 AND "accounting_journal_lines"."credit_cents" >= 0
    AND "accounting_journal_lines"."debit_cents" <= 9007199254740991 AND "accounting_journal_lines"."credit_cents" <= 9007199254740991),
	CONSTRAINT "accounting_journal_lines_memo_check" CHECK ("accounting_journal_lines"."memo" IS NULL OR ("accounting_journal_lines"."memo" = btrim("accounting_journal_lines"."memo") AND length("accounting_journal_lines"."memo") BETWEEN 1 AND 200))
);
--> statement-breakpoint
ALTER TABLE "accounting_journal_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounting_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" integer,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"accounting_date" date NOT NULL,
	"business_date" date,
	"description" text NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"branch_id" uuid,
	"source_type" text,
	"source_id" text,
	"source_version" integer,
	"event_type" text,
	"reversal_of_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"posted_by" text,
	"posted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_journals_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "accounting_journals_status_check" CHECK ("accounting_journals"."status" IN ('DRAFT','POSTED')),
	CONSTRAINT "accounting_journals_currency_check" CHECK ("accounting_journals"."currency" = 'MXN'),
	CONSTRAINT "accounting_journals_description_check" CHECK ("accounting_journals"."description" = btrim("accounting_journals"."description") AND length("accounting_journals"."description") BETWEEN 1 AND 500),
	CONSTRAINT "accounting_journals_number_check" CHECK ("accounting_journals"."number" IS NULL OR "accounting_journals"."number" > 0),
	CONSTRAINT "accounting_journals_version_check" CHECK ("accounting_journals"."version" >= 1),
	CONSTRAINT "accounting_journals_posting_check" CHECK (
    ("accounting_journals"."status" = 'DRAFT' AND "accounting_journals"."number" IS NULL AND "accounting_journals"."posted_at" IS NULL AND "accounting_journals"."posted_by" IS NULL)
    OR ("accounting_journals"."status" = 'POSTED' AND "accounting_journals"."number" IS NOT NULL AND "accounting_journals"."posted_at" IS NOT NULL AND "accounting_journals"."posted_by" IS NOT NULL)),
	CONSTRAINT "accounting_journals_source_check" CHECK (
    num_nonnulls("accounting_journals"."source_type", "accounting_journals"."source_id", "accounting_journals"."source_version", "accounting_journals"."event_type") IN (0, 4)),
	CONSTRAINT "accounting_journals_source_version_check" CHECK ("accounting_journals"."source_version" IS NULL OR "accounting_journals"."source_version" >= 1),
	CONSTRAINT "accounting_journals_reversal_self_check" CHECK ("accounting_journals"."reversal_of_id" IS NULL OR "accounting_journals"."reversal_of_id" <> "accounting_journals"."id")
);
--> statement-breakpoint
ALTER TABLE "accounting_journals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounting_journal_lines" ADD CONSTRAINT "accounting_journal_lines_journal_fk" FOREIGN KEY ("company_id","journal_id") REFERENCES "public"."accounting_journals"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journal_lines" ADD CONSTRAINT "accounting_journal_lines_account_fk" FOREIGN KEY ("company_id","account_id") REFERENCES "public"."accounting_accounts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journal_lines" ADD CONSTRAINT "accounting_journal_lines_cost_center_fk" FOREIGN KEY ("company_id","cost_center_id") REFERENCES "public"."cost_centers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_journals" ADD CONSTRAINT "accounting_journals_reversal_company_fk" FOREIGN KEY ("company_id","reversal_of_id") REFERENCES "public"."accounting_journals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounting_journal_lines_journal_idx" ON "accounting_journal_lines" USING btree ("company_id","journal_id");--> statement-breakpoint
CREATE INDEX "accounting_journal_lines_account_idx" ON "accounting_journal_lines" USING btree ("company_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_journals_company_number_unique" ON "accounting_journals" USING btree ("company_id","number") WHERE "accounting_journals"."number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_journals_source_unique" ON "accounting_journals" USING btree ("company_id","source_type","source_id","event_type","source_version") WHERE "accounting_journals"."source_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "accounting_journals_business_idx" ON "accounting_journals" USING btree ("company_id","status","accounting_date");--> statement-breakpoint
CREATE POLICY "accounting_journal_lines_tenant" ON "accounting_journal_lines" AS PERMISSIVE FOR ALL TO public USING ("accounting_journal_lines"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_journal_lines"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);--> statement-breakpoint
CREATE POLICY "accounting_journals_tenant" ON "accounting_journals" AS PERMISSIVE FOR ALL TO public USING ("accounting_journals"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_journals"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);