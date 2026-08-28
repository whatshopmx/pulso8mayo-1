ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "payee_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;