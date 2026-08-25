CREATE TYPE "public"."item_storage_type" AS ENUM('DRY', 'REFRIGERATED', 'FROZEN');--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "storage_type" "item_storage_type";