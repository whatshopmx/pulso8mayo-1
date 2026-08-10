import { inngest } from "@/lib/inngest/client";
import { createChildLogger } from "@/lib/logger";
import { db } from "@/lib/db";
import { companies, branches } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { InventorySnapshotService } from "@/lib/services/inventory-snapshot-service";

const logger = createChildLogger("cron:inventory-snapshot");

/**
 * Snapshot nocturno de stock (AD-5): job de escritura idempotente por
 * sucursal, SEPARADO de `checkInventoryAlerts` (que sigue corriendo cada 6h
 * para notificaciones). Correr el snapshot en el cron de alertas complicaría
 * el retry de ambos con lógicas de escritura y notificación mezcladas.
 *
 * Mismo bucle que `lib/cron/inventory-checks.ts`: compañías ACTIVE ×
 * sucursales activas. `buildSnapshot` es idempotente por día (ON CONFLICT).
 */
export const cronInventorySnapshot = inngest.createFunction(
  {
    id: "cron-inventory-snapshot",
    triggers: [{ cron: "0 5 * * *" }],
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
            snapshots += await InventorySnapshotService.buildSnapshot(company.id, branch.id);
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
