// Persistencia y conciliación de los CFDIs recibidos por el buzón
// (descarga masiva SAT vía FiscalAPI).
//
// Flujo: el metadata crudo llega del buzón (fiscal-buzon-service) → se hace
// upsert por folio fiscal (uuid SAT, idempotente aunque se re-baje la misma
// ventana varias veces) → conciliación contra OCs y gastos del tenant → la
// fila queda con estatus CONCILIADA/SIN_MATCH para el dashboard.
//
// La conciliación es intencionalmente conservadora: emisor → proveedor/payee
// por taxId (scoped al tenant), y monto ±$0.01. Si dos OCs comparten total,
// gana la más reciente. El 3-way match completo vive en
// invoice-matching-service; aquí sólo anclamos el CFDI recibido.

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  cfdiRecibidos,
  operatingExpenses,
  payees,
  purchaseOrders,
  suppliers,
} from "@/lib/db/schema";

export interface FacturaParaPersistir {
  uuid: string;
  issuerTin: string;
  issuerName: string | null;
  /** Total con impuestos en PESOS (tal como viene el metadata). */
  total: number | null;
  fecha: string | null;
}

export interface ResumenPersistencia {
  procesadas: number;
  nuevas: number;
  actualizadas: number;
  conciliadas: number;
  sinMatch: number;
}

/** Metadatos crudos tal como llegan de obtenerMetadatos() (pesos). */
export async function persistirYConciliar(
  companyId: string,
  facturas: FacturaParaPersistir[],
  downloadRequestId?: string
): Promise<ResumenPersistencia> {
  const resumen: ResumenPersistencia = {
    procesadas: facturas.length,
    nuevas: 0,
    actualizadas: 0,
    conciliadas: 0,
    sinMatch: 0,
  };

  for (const f of facturas) {
    if (!f.uuid || !f.issuerTin || f.total == null) continue;

    const amountCents = Math.round(f.total * 100);
    const match = await conciliarContraparte(companyId, f.issuerTin.toUpperCase(), amountCents);

    const values = {
      companyId,
      invoiceUuid: f.uuid,
      issuerTin: f.issuerTin.toUpperCase(),
      issuerName: f.issuerName,
      recipientTin: null as string | null,
      amountCents,
      invoiceDate: f.fecha ? new Date(f.fecha) : null,
      downloadRequestId: downloadRequestId ?? null,
      conciliationStatus: match.conciliada ? ('CONCILIADA' as const) : ('SIN_MATCH' as const),
      matchedSupplierId: match.supplierId,
      matchedPayeeId: match.payeeId,
      matchedPurchaseOrderId: match.purchaseOrderId,
      matchedExpenseId: match.expenseId,
      rawMetadata: f as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    };

    // Upsert por folio SAT: re-bajar la misma ventana no duplica filas; el
    // dueño original conserva companyId (un CFDI tiene un solo receptor).
    const r = await db
      .insert(cfdiRecibidos)
      .values(values)
      .onConflictDoUpdate({
        target: cfdiRecibidos.invoiceUuid,
        set: {
          issuerName: values.issuerName,
          amountCents: values.amountCents,
          invoiceDate: values.invoiceDate,
          downloadRequestId: values.downloadRequestId,
          conciliationStatus: values.conciliationStatus,
          matchedSupplierId: values.matchedSupplierId,
          matchedPayeeId: values.matchedPayeeId,
          matchedPurchaseOrderId: values.matchedPurchaseOrderId,
          matchedExpenseId: values.matchedExpenseId,
          rawMetadata: values.rawMetadata,
          updatedAt: new Date(),
        },
      })
      .returning({ createdAt: cfdiRecibidos.createdAt, updatedAt: cfdiRecibidos.updatedAt });

    if (r[0] && r[0].createdAt.getTime() === r[0].updatedAt.getTime()) resumen.nuevas++;
    else resumen.actualizadas++;

    if (match.conciliada) resumen.conciliadas++;
    else resumen.sinMatch++;
  }

  return resumen;
}

interface MatchContraparte {
  conciliada: boolean;
  supplierId: string | null;
  payeeId: string | null;
  purchaseOrderId: string | null;
  expenseId: string | null;
}

async function conciliarContraparte(
  companyId: string,
  issuerTin: string,
  amountCents: number
): Promise<MatchContraparte> {
  const vacio: MatchContraparte = {
    conciliada: false,
    supplierId: null,
    payeeId: null,
    purchaseOrderId: null,
    expenseId: null,
  };

  const [supplier] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.companyId, companyId), eq(suppliers.taxId, issuerTin)))
    .limit(1);

  if (supplier) {
    // Más reciente primero: si dos OCs comparten total, gana la última.
    const ocs = await db
      .select({ id: purchaseOrders.id, totalAmount: purchaseOrders.totalAmount })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.supplierId, supplier.id))
      .orderBy(desc(purchaseOrders.createdAt));
    const oc = ocs.find((o) => Math.abs((o.totalAmount ?? Number.NaN) - amountCents) <= 1);
    return oc
      ? { conciliada: true, supplierId: supplier.id, payeeId: null, purchaseOrderId: oc.id, expenseId: null }
      : { ...vacio, supplierId: supplier.id };
  }

  const [payee] = await db
    .select({ id: payees.id })
    .from(payees)
    .where(and(eq(payees.companyId, companyId), eq(payees.taxId, issuerTin)))
    .limit(1);

  if (payee) {
    const gastos = await db
      .select({ id: operatingExpenses.id, amount: operatingExpenses.amount })
      .from(operatingExpenses)
      .where(eq(operatingExpenses.payeeId, payee.id));
    const gasto = gastos.find((g) => Math.abs((g.amount ?? Number.NaN) - amountCents) <= 1);
    return gasto
      ? { conciliada: true, supplierId: null, payeeId: payee.id, purchaseOrderId: null, expenseId: gasto.id }
      : { ...vacio, payeeId: payee.id };
  }

  return vacio;
}

// ---------------------------------------------------------------------------
// Lectura para el dashboard
// ---------------------------------------------------------------------------

export interface FiltrosRecibidos {
  status?: "CONCILIADA" | "SIN_MATCH";
  limit?: number;
  offset?: number;
}

export async function listarRecibidos(companyId: string, filtros: FiltrosRecibidos = {}) {
  const limit = Math.min(Math.max(filtros.limit ?? 50, 1), 200);
  const offset = Math.max(filtros.offset ?? 0, 0);

  const condiciones = [eq(cfdiRecibidos.companyId, companyId)];
  if (filtros.status) condiciones.push(eq(cfdiRecibidos.conciliationStatus, filtros.status));

  const rows = await db
    .select({
      id: cfdiRecibidos.id,
      invoiceUuid: cfdiRecibidos.invoiceUuid,
      issuerTin: cfdiRecibidos.issuerTin,
      issuerName: cfdiRecibidos.issuerName,
      amountCents: cfdiRecibidos.amountCents,
      currency: cfdiRecibidos.currency,
      invoiceDate: cfdiRecibidos.invoiceDate,
      satCertificationDate: cfdiRecibidos.satCertificationDate,
      conciliationStatus: cfdiRecibidos.conciliationStatus,
      proveedorNombre: suppliers.name,
      payeeNombre: payees.name,
      poNumber: purchaseOrders.poNumber,
      gastoDescripcion: operatingExpenses.description,
      createdAt: cfdiRecibidos.createdAt,
    })
    .from(cfdiRecibidos)
    .leftJoin(suppliers, eq(cfdiRecibidos.matchedSupplierId, suppliers.id))
    .leftJoin(payees, eq(cfdiRecibidos.matchedPayeeId, payees.id))
    .leftJoin(purchaseOrders, eq(cfdiRecibidos.matchedPurchaseOrderId, purchaseOrders.id))
    .leftJoin(operatingExpenses, eq(cfdiRecibidos.matchedExpenseId, operatingExpenses.id))
    .where(and(...condiciones))
    .orderBy(desc(sql`coalesce(${cfdiRecibidos.invoiceDate}, ${cfdiRecibidos.createdAt})`))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(cfdiRecibidos)
    .where(and(...condiciones));

  return { items: rows, total, limit, offset };
}
