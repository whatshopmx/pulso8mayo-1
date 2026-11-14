CREATE TABLE "accounting_company_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'DISABLED' NOT NULL,
	"posting_enabled" boolean DEFAULT false NOT NULL,
	"review_enabled" boolean DEFAULT false NOT NULL,
	"opening_date" date,
	"activated_at" timestamp with time zone,
	"activated_by" text,
	"disabled_at" timestamp with time zone,
	"disabled_by" text,
	"disable_reason" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_company_settings_mode_check" CHECK ("accounting_company_settings"."mode" IN ('DISABLED','COMPARISON','ACTIVE')),
	CONSTRAINT "accounting_company_settings_disabled_check" CHECK (("accounting_company_settings"."mode" <> 'DISABLED' OR "accounting_company_settings"."posting_enabled" = false))
);
--> statement-breakpoint
ALTER TABLE "accounting_company_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounting_company_settings" ADD CONSTRAINT "accounting_company_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_company_settings" ADD CONSTRAINT "accounting_company_settings_activated_by_users_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_company_settings" ADD CONSTRAINT "accounting_company_settings_disabled_by_users_id_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounting_company_settings" ADD CONSTRAINT "accounting_company_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE POLICY "accounting_company_settings_tenant" ON "accounting_company_settings" AS PERMISSIVE FOR ALL TO public USING ("accounting_company_settings"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid) WITH CHECK ("accounting_company_settings"."company_id" = nullif(current_setting('app.current_company_id', true),'')::uuid);
--> statement-breakpoint
ALTER TABLE "public"."accounting_company_settings" FORCE ROW LEVEL SECURITY;
