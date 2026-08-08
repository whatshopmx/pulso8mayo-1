ALTER TABLE "workflow_schedules" ADD COLUMN "assigned_roles" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD COLUMN "assigned_shifts" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD COLUMN "days_of_week" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD COLUMN "cumplimiento_normativo" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
-- Backfill: las columnas escalares se conservan (AD-7), pero las nuevas
-- arrancan con lo que ya había configurado en ellas para que el GET no
-- devuelva vacío en las filas existentes.
UPDATE "workflow_schedules"
SET "days_of_week" = jsonb_build_array(
    (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])["day_of_week" + 1]
)
WHERE "day_of_week" IS NOT NULL AND "day_of_week" BETWEEN 0 AND 6;--> statement-breakpoint
UPDATE "workflow_schedules"
SET "assigned_roles" = jsonb_build_array("assigned_role"::text)
WHERE "assigned_role" IS NOT NULL;
