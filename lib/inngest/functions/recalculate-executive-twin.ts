/**
 * Inngest — Executive Twin recalculation.
 *
 * Source: docs/pulso-executive-os-v2.md §6.2 (cron) and Task 6.
 *
 * Triggers:
 *   - cron (every 15 minutes) → iterate every company and recalculate the
 *     groupWide twin (no AccessContext, so it persists).
 *   - event `executive/twin.recalculate` → recalculate a single company
 *     (manual refresh from the API or another function).
 *
 * Each company runs in its own memoized step so one failure does not block the
 * rest and the run is resumable on retry.
 */
import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { ExecutiveTwinEngine } from "@/lib/services/executive-twin-engine";

export const recalculateExecutiveTwin = inngest.createFunction(
  {
    id: "recalculate-executive-twin",
    triggers: [
      { cron: "*/15 * * * *" },
      { event: "executive/twin.recalculate" },
    ],
    retries: 2,
  },
  async ({ event, step }) => {
    // Event-driven single-company refresh.
    const eventCompanyId = (event?.data as { companyId?: string } | undefined)?.companyId;
    if (eventCompanyId) {
      const twin = await step.run(`recalculate-${eventCompanyId}`, async () => {
        return ExecutiveTwinEngine.recalculate(eventCompanyId);
      });
      return { success: true, companyId: eventCompanyId, twinId: twin?.id ?? null };
    }

    // Cron path: every company.
    const allCompanies = await db.select({ id: companies.id }).from(companies);

    const results: { companyId: string; twinId: string | null }[] = [];
    for (const company of allCompanies) {
      const twin = await step.run(`recalculate-${company.id}`, async () => {
        return ExecutiveTwinEngine.recalculate(company.id);
      });
      results.push({ companyId: company.id, twinId: twin?.id ?? null });
    }

    return { success: true, count: results.length, results };
  },
);