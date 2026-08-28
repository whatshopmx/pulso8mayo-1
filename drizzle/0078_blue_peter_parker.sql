ALTER TABLE "payment_runs" ADD COLUMN IF NOT EXISTS "branch_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payment_runs" ADD CONSTRAINT "payment_runs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;