/**
 * Registro de adaptadores hacia `exceptions` (Phase 0 / D4).
 *
 * Regla: los adaptadores **nunca** se ejecutan dentro de un GET. El trigger es
 * Inngest (cron + evento on-demand) o un hook explícito tras una discrepancia.
 * `runExceptionAdapters` aísla el fallo de cada adaptador: uno caído no aborta
 * los demás.
 */
import { incidentAdapter } from "./incident";
import { inventoryAlertAdapter } from "./inventory-alert";
import { complianceAlertAdapter } from "./compliance-alert";
import { equipmentAlertAdapter } from "./equipment-alert";
import { nom035ActionPlanAdapter } from "./nom035-action-plan";
import { shiftApprovalAdapter } from "./shift-approval";
import { shiftChangeAdapter } from "./shift-change";
import { cashVarianceAdapter } from "./cash-variance";
import { invoiceDiscrepancyAdapter } from "./invoice-discrepancy";
import type { AdapterOutcome, AdapterScope, ExceptionAdapter } from "./types";

export type { AdapterOutcome, AdapterScope, ExceptionAdapter };

/** Alertas de dominio (parte 1) + personal/finanzas (parte 2). */
export const EXCEPTION_ADAPTERS: ExceptionAdapter[] = [
  incidentAdapter,
  inventoryAlertAdapter,
  complianceAlertAdapter,
  equipmentAlertAdapter,
  nom035ActionPlanAdapter,
  shiftApprovalAdapter,
  shiftChangeAdapter,
  cashVarianceAdapter,
  invoiceDiscrepancyAdapter,
];

export async function runExceptionAdapters(
  scope: AdapterScope,
): Promise<AdapterOutcome[]> {
  const outcomes: AdapterOutcome[] = [];
  for (const adapter of EXCEPTION_ADAPTERS) {
    try {
      const raised = await adapter.run(scope);
      outcomes.push({ adapter: adapter.subjectType, raised });
    } catch (error) {
      // Aislamiento por adaptador: se registra y se continúa.
      console.error(
        `[exceptions-sync] adaptador ${adapter.subjectType} falló`,
        error,
      );
      outcomes.push({
        adapter: adapter.subjectType,
        raised: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcomes;
}
