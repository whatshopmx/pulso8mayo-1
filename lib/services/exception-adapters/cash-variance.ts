import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { dailySalesCuts } from "@/lib/db/schema";
import { allowedEvents } from "../exception-lifecycle";
import { ExceptionService } from "../exception-service";
import type { AdapterScope, ExceptionAdapter } from "./types";

const SUBJECT_TYPE = "cash_variance";

/** Tolerancia de descuadre de arqueo (centavos). Misma que el feed legacy. */
const TOLERANCE_CENTS = 10000;
/** A partir de aquí un faltante es crítico. */
const CRITICAL_CENTS = 50000;

/**
 * Descuadres de arqueo → excepción de `finanzas`/DINERO. Los cortes que dejan
 * de rebasar la tolerancia cancelan su excepción abierta (autorreconciliación).
 */
export const cashVarianceAdapter: ExceptionAdapter = {
  subjectType: SUBJECT_TYPE,
  async run({ companyId, branchId }: AdapterScope): Promise<number> {
    const rows = await db
      .select({
        id: dailySalesCuts.id,
        branchId: dailySalesCuts.branchId,
        businessDate: dailySalesCuts.businessDate,
        shift: dailySalesCuts.shift,
        cashSales: dailySalesCuts.cashSales,
        cashCountedCents: dailySalesCuts.cashCountedCents,
        status: dailySalesCuts.status,
        detectedAt: dailySalesCuts.createdAt,
      })
      .from(dailySalesCuts)
      .where(
        and(
          eq(dailySalesCuts.companyId, companyId),
          isNotNull(dailySalesCuts.cashSales),
          isNotNull(dailySalesCuts.cashCountedCents),
          branchId ? eq(dailySalesCuts.branchId, branchId) : undefined,
        ),
      );

    let raised = 0;
    for (const r of rows) {
      const expected = r.cashSales ?? 0;
      const counted = r.cashCountedCents ?? expected;
      const diffCents = expected - counted;
      const absDiff = Math.abs(diffCents);

      if (absDiff < TOLERANCE_CENTS) {
        await cancelIfOpen(companyId, r.id, "El corte volvió a tolerancia.");
        continue;
      }

      const isShortage = diffCents > 0;
      const reason = isShortage
        ? `Faltante de caja en turno ${r.shift}: -$${(diffCents / 100).toFixed(2)} MXN`
        : `Sobrante de caja en turno ${r.shift}: +$${(absDiff / 100).toFixed(2)} MXN`;

      await ExceptionService.raise({
        companyId,
        branchId: r.branchId,
        domain: "finanzas",
        qsrCategory: "DINERO",
        severity: isShortage
          ? absDiff >= CRITICAL_CENTS
            ? "critical"
            : "high"
          : "warning",
        subjectType: SUBJECT_TYPE,
        subjectId: r.id,
        reason,
        actionMeta: {
          type: "AUDIT_DRAWER",
          label: "Auditar Arqueo de Caja",
          url: `/dashboard/finance/cash-flow?cutId=${r.id}`,
          whatsappSuggestedMessage: `Hola, detectamos una diferencia de efectivo en el corte del turno ${r.shift}. ¿Podrías confirmar el arqueo?`,
        },
        metadata: {
          title: reason,
          description: `Fecha de negocio: ${r.businessDate} · Turno ${r.shift}`,
          diffCents,
          sourceStatus: r.status,
          impact: isShortage
            ? `Faltante físico de $${(diffCents / 100).toFixed(2)} MXN sin justificar`
            : `Diferencia de $${(absDiff / 100).toFixed(2)} MXN en arqueo`,
          detectedAt: r.detectedAt,
        },
      });
      raised++;
    }
    return raised;
  },
};

async function cancelIfOpen(
  companyId: string,
  subjectId: string,
  reason: string,
): Promise<void> {
  const existing = await ExceptionService.getBySubject(
    companyId,
    SUBJECT_TYPE,
    subjectId,
  );
  if (!existing) return;
  if (!allowedEvents(existing.status).includes("CANCEL")) return;
  await ExceptionService.cancel(existing.id, companyId, null, reason).catch(() => {
    /* ya resuelto/verificado: no se cancela */
  });
}
