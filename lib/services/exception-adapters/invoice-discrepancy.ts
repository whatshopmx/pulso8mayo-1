import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { allowedEvents } from "../exception-lifecycle";
import { ExceptionService } from "../exception-service";
import type { AdapterScope, ExceptionAdapter } from "./types";

const SUBJECT_TYPE = "invoice_discrepancy";

/**
 * Facturas con discrepancia en el 3-way match → excepción de `finanzas`/DINERO.
 *
 * Cuando la factura pasa a `EXCEPTION_APPROVED` (autorizada con justificación),
 * la excepción abierta se cancela: no se duplica ni queda huérfana.
 *
 * Este adaptador es el criterio de aceptación del Gate 0.
 */
export const invoiceDiscrepancyAdapter: ExceptionAdapter = {
  subjectType: SUBJECT_TYPE,
  async run({ companyId, branchId }: AdapterScope): Promise<number> {
    const discrepancies = await db
      .select({
        id: invoices.id,
        branchId: invoices.branchId,
        uuid: invoices.uuid,
        folio: invoices.folio,
        total: invoices.total,
        currency: invoices.currency,
        supplierId: invoices.supplierId,
        matchStatus: invoices.matchStatus,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.matchStatus, "DISCREPANCY"),
          branchId ? eq(invoices.branchId, branchId) : undefined,
        ),
      );

    for (const r of discrepancies) {
      const label = r.folio || r.uuid;
      await ExceptionService.raise({
        companyId,
        branchId: r.branchId,
        domain: "finanzas",
        qsrCategory: "DINERO",
        severity: "high",
        subjectType: SUBJECT_TYPE,
        subjectId: r.id,
        reason: `Factura ${label} con discrepancia en conciliación (3-way match)`,
        actionMeta: {
          type: "RESOLVE_ALERT",
          label: "Revisar Conciliación de Factura",
          url: `/dashboard/inventory/invoices?invoiceId=${r.id}`,
        },
        metadata: {
          title: `Factura con discrepancia: ${label}`,
          invoiceUuid: r.uuid,
          folio: r.folio,
          totalCents: r.total,
          currency: r.currency,
          supplierId: r.supplierId,
          sourceStatus: r.matchStatus,
          impact: "Pago potencialmente incorrecto (precio/cantidad no conciliados)",
        },
      });
    }

    // Autorreconciliación: las autorizadas como excepción cierran su excepción.
    const approved = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.matchStatus, "EXCEPTION_APPROVED"),
          branchId ? eq(invoices.branchId, branchId) : undefined,
        ),
      );

    for (const r of approved) {
      const existing = await ExceptionService.getBySubject(
        companyId,
        SUBJECT_TYPE,
        r.id,
      );
      if (!existing) continue;
      if (!allowedEvents(existing.status).includes("CANCEL")) continue;
      await ExceptionService.cancel(
        existing.id,
        companyId,
        null,
        "Factura autorizada como excepción (EXCEPTION_APPROVED).",
      ).catch(() => {
        /* ya resuelto/verificado: no se cancela */
      });
    }

    return discrepancies.length;
  },
};
