ALTER TABLE "workflow_instances" ADD COLUMN "review_status" text;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "review_comment" text;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "reviewed_by" text;