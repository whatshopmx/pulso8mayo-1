/**
 * Inngest — Refresh all Sprint 2 intelligence engines.
 *
 * Source: docs/pulso-executive-os-v2.md §7 (refresh) + handoff §3 ("Persistencia
 * / refresco de engines").
 *
 * Trigger: cron cada 6 horas (expresión exacta en `triggers`, abajo) + evento
 * `executive/engines.refresh`. Para cada company llama `engine.refresh(companyId)`
 * en cada uno de los 5 engines. Cada refresh corre en su propio `step.run`
 * memoizado, de forma que el fallo de un engine no bloquea al resto y el run es
 * reanudable en el retry.
 *
 * NOTA (regla de repo): una expresión cron con paso (asterisco + barra + N) nunca
 * va dentro de un comentario de bloque — la secuencia lo cierra y rompe el parseo.
 * La fuente de verdad del cron es siempre el bloque `triggers`.
 *
 * 'refresh()' (facade contract) delegates to the existing services, normalizes
 * to 'EngineOutput', and caches the snapshot into
 * 'corporate_twins.executive_state.engineSnapshots[engineId]' via
 * 'ExecutiveTwinEngine.setEngineSnapshot'.
 *
 * Model: lib/inngest/functions/recalculate-executive-twin.ts (Sprint 1 Task 6).
 */
import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { OperationsEngine } from "@/lib/services/intelligence/operations-engine";
import { BrandEngine } from "@/lib/services/intelligence/brand-engine";
import { ComplianceEngine } from "@/lib/services/intelligence/compliance-engine";
import { FinanceEngine } from "@/lib/services/intelligence/finance-engine";
import { ProcurementEngine } from "@/lib/services/intelligence/procurement-engine";

/** The 5 Sprint 2 engines, keyed by their engineId. */
const ENGINES = [
  { engineId: "operations", engine: OperationsEngine },
  { engineId: "brand", engine: BrandEngine },
  { engineId: "compliance", engine: ComplianceEngine },
  { engineId: "finance", engine: FinanceEngine },
  { engineId: "procurement", engine: ProcurementEngine },
] as const;

export const refreshEngines = inngest.createFunction(
  {
    id: "refresh-engines",
    triggers: [
      { cron: "0 */6 * * *" },
      { event: "executive/engines.refresh" },
    ],
    retries: 2,
  },
  async ({ event, step }) => {
    // Event-driven single-company refresh.
    const eventCompanyId = (event?.data as { companyId?: string } | undefined)
      ?.companyId;

    const companyIds: string[] = eventCompanyId
      ? [eventCompanyId]
      : (await db.select({ id: companies.id }).from(companies)).map((c) => c.id);

    const results: {
      companyId: string;
      engineId: string;
      ok: boolean;
      error?: string;
    }[] = [];

    for (const companyId of companyIds) {
      for (const { engineId, engine } of ENGINES) {
        const res = await step.run(
          // El step ID debe variar por company: Inngest memoiza por ID y un ID
          // compartido reutilizaría el resultado del primer tenant para el resto.
          `refresh-${companyId}-${engineId}`,
          async (): Promise<{ ok: boolean; error?: string }> => {
            try {
              await engine.refresh(companyId);
              return { ok: true };
            } catch (err) {
              // Isolate: one engine's failure must not block the rest. Se
              // registra porque el `ok:false` viaja dentro del output del step y
              // no aparece como error del run: sin este log un engine caído es
              // invisible en los logs del servidor.
              console.error(
                `[refresh-engines] ${engineId} failed for company ${companyId}:`,
                err,
              );
              return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          },
        );
        results.push({
          companyId,
          engineId,
          ...(res as { ok: boolean; error?: string }),
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return { success: true, total: results.length, ok: okCount, results };
  },
);