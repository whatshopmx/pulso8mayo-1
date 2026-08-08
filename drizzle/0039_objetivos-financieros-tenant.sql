-- Objetivos financieros por tenant (M13/M16).
--
-- Hasta ahora el food cost objetivo (30%), el labor cost objetivo (28%) y los
-- cortes del margen sano (45/35) vivían hardcodeados en el JSX de
-- `components/sales/financial-kpi-cards.tsx` y en las constantes de
-- `lib/services/financial-kpi-service.ts`. Eso hacía que el semáforo dijera lo
-- mismo para una taquería y para una marisquería, que no comparten estructura
-- de costo. El diseño §2 exige que esto sea configuración del grupo.
--
-- Los DEFAULT reproducen exactamente los valores que ya estaban en el código,
-- así que ningún tenant existente cambia de lectura al aplicar esta migración.
--
-- Food y labor: MENOR es mejor → target = tope sano, warn = tope tolerable.
-- Margen:       MAYOR es mejor → target = piso sano, warn = piso tolerable.
--
-- `IF NOT EXISTS`: esta migración existió brevemente por duplicado (una versión
-- escrita a mano y otra generada por drizzle-kit, que no la vio porque faltaba
-- su snapshot). Se consolidaron en este archivo; la guarda hace que aplicarla
-- sea seguro aunque alguna de las dos ya haya corrido en una base.

ALTER TABLE "tenant_operating_config" ADD COLUMN IF NOT EXISTS "food_cost_target_percent" numeric(5, 2) DEFAULT '30.00';--> statement-breakpoint
ALTER TABLE "tenant_operating_config" ADD COLUMN IF NOT EXISTS "food_cost_warn_percent" numeric(5, 2) DEFAULT '35.00';--> statement-breakpoint
ALTER TABLE "tenant_operating_config" ADD COLUMN IF NOT EXISTS "labor_cost_target_percent" numeric(5, 2) DEFAULT '28.00';--> statement-breakpoint
ALTER TABLE "tenant_operating_config" ADD COLUMN IF NOT EXISTS "labor_cost_warn_percent" numeric(5, 2) DEFAULT '32.00';--> statement-breakpoint
ALTER TABLE "tenant_operating_config" ADD COLUMN IF NOT EXISTS "healthy_margin_target_percent" numeric(5, 2) DEFAULT '45.00';--> statement-breakpoint
ALTER TABLE "tenant_operating_config" ADD COLUMN IF NOT EXISTS "healthy_margin_warn_percent" numeric(5, 2) DEFAULT '35.00';
