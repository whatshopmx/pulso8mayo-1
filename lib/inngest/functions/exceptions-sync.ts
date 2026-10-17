import { and, eq } from "drizzle-orm";

import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { branches, companies } from "@/lib/db/schema";
import { runExceptionAdapters, type AdapterOutcome } from "@/lib/services/exception-adapters";

/**
 * Phase 0 / Task 8 — sync durable de excepciones.
 *
 * Cron cada 10 minutos + evento on-demand `exceptions/sync.requested`
 * (`{ companyId?, branchId? }`). Los adaptadores se ejecutan **fuera** de
 * cualquier GET; este es el único escritor programado hacia `exceptions`.
 *
 * - `concurrency: 1`: dos corridas simultáneas no compiten por las mismas filas
 *   (el upsert es idempotente, pero se evita trabajo duplicado).
 * - Un `step.run` por empresa: si una falla, las demás ya quedaron registradas.
 * - `runExceptionAdapters` aísla el fallo de cada adaptador.
 */
export const exceptionsSync = inngest.createFunction(
  {
    id: "exceptions-sync",
    triggers: [
      { cron: "*/10 * * * *" },
      { event: "exceptions/sync.requested" },
    ],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ event, step }) => {
    const requested =
      (event?.data as { companyId?: string; branchId?: string }) ?? {};

    const targets = await step.run("load-companies", async () => {
      if (requested.companyId) {
        return [{ id: requested.companyId }];
      }
      const rows = await db
        .selectDistinct({ id: companies.id })
        .from(companies)
        .innerJoin(branches, eq(branches.companyId, companies.id))
        .where(and(eq(branches.active, true)));
      return rows;
    });

    const results: Array<{
      companyId: string;
      outcomes: AdapterOutcome[];
    }> = [];

    for (const target of targets) {
      const outcomes = await step.run(`sync-${target.id}`, async () => {
        console.log(`[exceptions-sync] started company=${target.id}`);
        const result = await runExceptionAdapters({
          companyId: target.id,
          branchId: requested.branchId ?? null,
        });
        const errors = result.filter((r) => r.error);
        console.log(
          `[exceptions-sync] completed company=${target.id} raised=${result.reduce(
            (n, r) => n + r.raised,
            0,
          )} errors=${errors.length}`,
        );
        if (errors.length) {
          console.warn(
            `[exceptions-sync] adapters con error company=${target.id}`,
            errors,
          );
        }
        return result;
      });
      results.push({
        companyId: target.id,
        outcomes: outcomes as unknown as AdapterOutcome[],
      });
    }

    return { companies: targets.length, results };
  },
);
