CREATE TABLE "inventory_expiration_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"window" text NOT NULL,
	"notified_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_expiration_alerts" ADD CONSTRAINT "inventory_expiration_alerts_batch_id_inventory_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."inventory_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_expiration_alerts_batch_window_unique" ON "inventory_expiration_alerts" USING btree ("batch_id","window");