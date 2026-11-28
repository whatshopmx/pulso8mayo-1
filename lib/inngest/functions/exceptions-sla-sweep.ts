import { and, eq } from "drizzle-orm";

import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { branches, companies } from "@/lib/db/schema";
import {
  sweepCompanyExceptionSla,
  type SlaSweepResult,
} from "@/lib/services/exception-sla-job-service";

/**
 * EXC-03.b — Job durable y recuperable de escalamiento por SLA vencido.
 *
 * - Cron cada 15 minutos + evento on-demand `exceptions/sla-sweep.requested`
 *   (`{ companyId?, nowIso? }`).
 * - `concurrency: 1`: evita barridos simultáneos innecesarios.
 * - Un `step.run` por empresa: si una empresa falla, las ya completadas quedan
 *   memoizadas y el reintento no duplica escalamientos (respaldado además por
 *   `pg_advisory_xact_lock` + estado `ESCALATED` no re-escalable).
 */
export const exceptionsSlaSweep = inngest.createFunction(
  {
    id: "exceptions-sla-sweep",
    triggers: [
      { cron: "*/15 * * * *" },
      { event: "exceptions/sla-sweep.requested" },
    ],
    concurrency: { limit: 1 },
    retries: 3,
  },
  async ({ event, step }) => {
    const requested =
      (event?.data as { companyId?: string; nowIso?: string }) ?? {};
    const controlledNow = requested.nowIso ? new Date(requested.nowIso) : new Date();

    const targets = await step.run("load-companies", async () => {
      if (requested.companyId) {
        return [{ id: requested.companyId }];
      }
      return db
        .selectDistinct({ id: companies.id })
        .from(companies)
        .innerJoin(branches, eq(branches.companyId, companies.id))
        .where(and(eq(branches.active, true)));
    });

    const results: SlaSweepResult[] = [];

    for (const target of targets) {
      const outcome = await step.run(`sla-sweep-${target.id}`, async () => {
        return sweepCompanyExceptionSla({
          companyId: target.id,
          now: controlledNow,
        });
      });
      results.push(outcome as unknown as SlaSweepResult);
    }

    return {
      companies: targets.length,
      checkedAt: controlledNow.toISOString(),
      escalatedTotal: results.reduce((sum, r) => sum + r.escalated, 0),
      results,
    };
  },
);
