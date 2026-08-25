CREATE TABLE "folio_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"doc_type" "approval_doc_type" NOT NULL,
	"year" integer NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "folio_counters" ADD CONSTRAINT "folio_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folio_counters" ADD CONSTRAINT "folio_counters_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "folio_counters_unique" ON "folio_counters" USING btree ("company_id","branch_id","doc_type","year");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_company_code_unique" ON "branches" USING btree ("company_id","code") WHERE code is not null;