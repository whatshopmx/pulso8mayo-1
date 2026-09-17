CREATE TABLE "executive_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"decision_key" text NOT NULL,
	"resolution" text NOT NULL,
	"resolved_by" uuid,
	"resolved_by_name" text,
	"resolved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Nota: `ALTER TABLE "incidents" ADD COLUMN "resolution_type" text;` se retiró
-- de esta migración: la columna ya existe en la base (drift del journal anterior)
-- y su inclusión provocaba check_for_column_name_collision.
ALTER TABLE "executive_decisions" ADD CONSTRAINT "executive_decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "executive_decisions_company_key_unique" ON "executive_decisions" USING btree ("company_id","decision_key");--> statement-breakpoint
CREATE INDEX "executive_decisions_company_resolved_idx" ON "executive_decisions" USING btree ("company_id","resolved_at");