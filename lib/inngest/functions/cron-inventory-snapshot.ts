import { inngest } from "@/lib/inngest/client";
import { createChildLogger } from "@/lib/logger";
import { db } from "@/lib/db";
import { companies, branches } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { InventorySnapshotService } from "@/lib/services/inventory-snapshot-service";
import { localDateString, addCalendarDays } from "@/lib/workflows/today";

const logger = createChildLogger("cron:inventory-snapshot");

/**
 * Snapshot nocturno de stock (AD-5): job de escritura idempotente por
 * sucursal, SEPARADO de `checkInventoryAlerts` (que sigue corriendo cada 6h
 * para notificaciones). Correr el snapshot en el cron de alertas complicaría
 * el retry de ambos con lógicas de escritura y notificación mezcladas.
 *
 * Mismo bucle que `lib/cron/inventory-checks.ts`: compañías ACTIVE ×
 * sucursales activas. `buildSnapshot` es idempotente por día (ON CONFLICT).
 *
 * A4/O-2 — qué día sella. Antes corría a las `0 5 * * *` SIN `TZ=`, o sea las
 * 23:00 hora local del día anterior: sellaba con la fecha de un día que en la
 * sucursal todavía no terminaba. Ahora corre a las 4:00 hora de México —después
 * del cierre más tardío, antes de que abra nadie— y sella **D−1** explícito,
 * el día operativo que acaba de cerrar (OQ-A1).
 *
 * D−1 y no D porque el snapshot lee el estado VIVO de los lotes: a las 4:00
 * locales ese estado *es* el cierre de ayer. Y tras A4 los conteos de cierre
 * quedan con `countDate = D−1`, así que sólo D−1 hace que crucen.
 *
 * ⚠️ Cualquier UI que muestre "el snapshot de hoy" está mostrando el día
 * anterior: se etiqueta "cierre del <fecha>", no "hoy".
 */
export const cronInventorySnapshot = inngest.createFunction(
  {
    id: "cron-inventory-snapshot",
    triggers: [{ cron: "TZ=America/Mexico_City 0 4 * * *" }],
    retries: 2,
  },
  async ({ step }) => {
    return await step.run("build-daily-snapshots", async () => {
      try {
        const activeCompanies = await db.query.companies.findMany({
          where: eq(companies.billingStatus, "ACTIVE"),
        });

        let snapshots = 0;
        let branchesSnapshot = 0;

        for (const company of activeCompanies) {
          const companyBranches = await db.query.branches.findMany({
            where: and(
              eq(branches.companyId, company.id),
              eq(branches.active, true)
            ),
          });

          for (const branch of companyBranches) {
            branchesSnapshot++;
            // D−1 en el huso de la sucursal: una cadena con sucursal en Quintana
            // Roo (UTC-5) y otra en CDMX (UTC-6) no siempre cierra el mismo día.
            const cierre = addCalendarDays(localDateString(new Date(), branch.timezone), -1);
            snapshots += await InventorySnapshotService.buildSnapshot(company.id, branch.id, cierre);
          }
        }

        logger.info(
          { companies: activeCompanies.length, branches: branchesSnapshot, snapshots },
          "Inventory snapshots built"
        );

        return {
          success: true,
          status: "completed",
          companies: activeCompanies.length,
          branches: branchesSnapshot,
          snapshots,
        };
      } catch (error) {
        logger.error({ error }, "Inventory snapshot job failed");
        return { success: false, error: String(error) };
      }
    });
  }
);
