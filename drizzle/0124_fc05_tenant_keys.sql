ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_company_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "company_bank_accounts" ADD CONSTRAINT "company_bank_accounts_company_id_unique" UNIQUE("company_id","id");
