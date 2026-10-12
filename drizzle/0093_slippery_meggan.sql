CREATE TABLE "config_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"field_name" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"performed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "config_change_logs" ADD CONSTRAINT "config_change_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "config_change_logs_company_time_idx" ON "config_change_logs" USING btree ("company_id","performed_at");