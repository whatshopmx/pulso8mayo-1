-- C28 — Outbox de entrega de efectos de terminación de workflows.
-- Persiste la intención de publicar `workflow/instance.completed` junto con la
-- transición a COMPLETED (misma transacción), así que un fallo entre commit y
-- envío no pierde el evento. Una fila por instancia.
-- Aditiva: no borra ni altera datos existentes.

--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "completion_effects_status" text;
--> statement-breakpoint
CREATE TABLE "workflow_completion_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"completed_extractors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "workflow_completion_outbox" ADD CONSTRAINT "workflow_completion_outbox_instance_id_unique" UNIQUE ("instance_id");
--> statement-breakpoint
ALTER TABLE "workflow_completion_outbox" ADD CONSTRAINT "workflow_completion_outbox_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workflow_completion_outbox_status_idx" ON "workflow_completion_outbox" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "workflow_completion_outbox_instance_idx" ON "workflow_completion_outbox" USING btree ("instance_id");
