ALTER TABLE "workflow_instance_steps" ADD COLUMN "step_order" integer;--> statement-breakpoint
ALTER TABLE "workflow_instance_steps" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "workflow_instance_steps" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "workflow_instance_steps" ADD COLUMN "definition" jsonb;