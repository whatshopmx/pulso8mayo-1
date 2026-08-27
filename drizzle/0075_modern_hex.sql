ALTER TABLE "inventory_batches" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD COLUMN "parent_batch_ids" jsonb;