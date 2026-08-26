// M15 → M16: Cuentas por Pagar.
//
// "Una vez conciliada la factura, entra al calendario de pagos con fecha de
// vencimiento" (diseño §M15). Hasta la migración 0040 eso no podía existir:
// `invoices` no tenía ni vencimiento ni estatus de pago, y `suppliers` no tenía
// días de crédito, así que no había forma de saber qué se debe ni cuándo.
//
// Este servicio junta las dos obligaciones que el dueño vive como "lo que
// debo": los CFDI recibidos sin pagar y los gastos operativos ya autorizados
// que todavía no salen de la cuenta. La nómina NO entra aquí — se proyecta en
// `cash-flow-service` desde los contratos vigentes, y mezclarla haría que el
// total de "por pagar a proveedores" dejara de ser comparable con la realidad.

import { db } from "@/lib/db";
import { invoices, operatingExpenses, suppliers, branches, payees } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  AGING_BUCKET_ORDER,
  PAYABLES_ITEMS_LIMIT,
  bucketFor,
  type AccountsPayableResult,
  type BucketTotal,
  type CounterpartyTotal,
  type PayableItem,
} from "@/lib/services/accounts-payable-types";

export type {
  AccountsPayableResult,
  PayableItem,
  PayableSource,
} from "@/lib/services/accounts-payable-types";

export interface AccountsPayableFilter {
  companyId: string;
  branchId?: string;
  supplierId?: string;
  /**
   * A19 — Cota del detalle. Los agregados se calculan sobre **todas** las
   * partidas y el corte se aplica al final, así que acotar no cambia ni un
   * total ni un tramo de antigüedad: sólo cuántas filas viajan.
   */
  itemsLimit?: number;
}

/** Días entre hoy y una fecha `YYYY-MM-DD`. Negativo = ya pasó. */
function daysUntil(day: string, todayMs: number): number {
  const target = new Date(`${day}T00:00:00Z`).getTime();
  return Math.round((target - todayMs) / 86_400_000);
}

export async function getAccountsPayable(
  filter: AccountsPayableFilter,
): Promise<AccountsPayableResult> {
  const today = new Date().toISOString().slice(0, 10);
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();

  const invoiceConditions = [
    eq(invoices.companyId, filter.companyId),
    // CANCELLED no se debe; PAID ya salió.
    eq(invoices.paymentStatus, "PENDING"),
  ];
  if (filter.branchId) invoiceConditions.push(eq(invoices.branchId, filter.branchId));
  if (filter.supplierId) invoiceConditions.push(eq(invoices.supplierId, filter.supplierId));

  const expenseConditions = [
    eq(operatingExpenses.companyId, filter.companyId),
    // APPROVED = autorizado y sin pagar. PENDING_APPROVAL todavía no es un
    // compromiso firme (puede rechazarse) y ya aparece en el panel de atención
    // de la portada; contarlo aquí inflaría la deuda con dinero que quizá no salga.
    eq(operatingExpenses.status, "APPROVED"),
  ];
  if (filter.branchId) expenseConditions.push(eq(operatingExpenses.branchId, filter.branchId));

  const [invoiceRows, expenseRows] = await Promise.all([
    db
      .select({
        id: invoices.id,
        folio: invoices.folio,
        serie: invoices.serie,
        total: invoices.total,
        dueDate: invoices.dueDate,
        supplierId: invoices.supplierId,
        supplierName: suppliers.name,
        nombreEmisor: invoices.nombreEmisor,
        rfcEmisor: invoices.rfcEmisor,
        branchId: invoices.branchId,
        branchName: branches.name,
        matchStatus: invoices.matchStatus,
        hasPriceDiscrepancy: invoices.hasPriceDiscrepancy,
        hasQtyDiscrepancy: invoices.hasQtyDiscrepancy,
      })
      .from(invoices)
      .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
      .leftJoin(branches, eq(invoices.branchId, branches.id))
      .where(and(...invoiceConditions)),

    // El filtro por proveedor no aplica a gastos operativos: no tienen
    // proveedor asociado. Cuando se filtra por uno, se omiten por completo en
    // vez de mostrarse como si pertenecieran a ese proveedor.
    filter.supplierId
      ? Promise.resolve([])
      : db
          .select({
            id: operatingExpenses.id,
            description: operatingExpenses.description,
            category: operatingExpenses.category,
            amount: operatingExpenses.amount,
            dueDate: operatingExpenses.dueDate,
            branchId: operatingExpenses.branchId,
            branchName: branches.name,
            payeeId: operatingExpenses.payeeId,
            payeeName: payees.name,
          })
          .from(operatingExpenses)
          .leftJoin(branches, eq(operatingExpenses.branchId, branches.id))
          .leftJoin(payees, eq(operatingExpenses.payeeId, payees.id))
          .where(and(...expenseConditions)),
  ]);

  const items: PayableItem[] = [];
  let missingDueDateCount = 0;

  for (const row of invoiceRows) {
    const due = row.dueDate ?? null;
    if (due === null) missingDueDateCount++;
    const days = due ? daysUntil(due, todayMs) : null;

    // El folio identifica la factura ante el proveedor; sin él, la serie o el
    // RFC emisor son lo único con lo que alguien puede buscarla.
    const reference =
      [row.serie, row.folio].filter(Boolean).join("-") || `CFDI de ${row.rfcEmisor}`;

    items.push({
      id: row.id,
      source: "INVOICE",
      reference,
      counterparty: row.supplierName ?? row.nombreEmisor ?? row.rfcEmisor,
      supplierId: row.supplierId,
      payeeId: null,
      branchId: row.branchId,
      branchName: row.branchName,
      amountCents: row.total,
      dueDate: due,
      daysUntilDue: days,
      bucket: bucketFor(days),
      matchStatus: row.matchStatus,
      hasDiscrepancy: row.hasPriceDiscrepancy || row.hasQtyDiscrepancy,
    });
  }

  for (const row of expenseRows) {
    const due = row.dueDate ?? null;
    const days = due ? daysUntil(due, todayMs) : null;

    // Fase payees: la contraparte real del gasto ("Inmobiliaria X") vence a
    // la categoría ("RENTA") como la identidad que la CxP muestra y agrupa.
    // El gasto casual — taxi, hielo, plomero— no tiene payee y cae a categoría,
    // que es lo que decía el comportamiento anterior.
    const counterparty = row.payeeName ?? row.category;

    items.push({
      id: row.id,
      source: "OPERATING_EXPENSE",
      reference: row.description,
      counterparty,
      supplierId: null,
      payeeId: row.payeeId ?? null,
      branchId: row.branchId,
      branchName: row.branchName,
      amountCents: row.amount,
      dueDate: due,
      daysUntilDue: days,
      bucket: bucketFor(days),
      matchStatus: null,
      hasDiscrepancy: false,
    });
  }

  // Lo más urgente arriba: primero lo vencido, y dentro de cada tramo lo de
  // mayor monto. Las partidas sin fecha van al final, ya contadas aparte.
  items.sort((a, b) => {
    const bucketDiff =
      AGING_BUCKET_ORDER.indexOf(a.bucket) - AGING_BUCKET_ORDER.indexOf(b.bucket);
    if (bucketDiff !== 0) return bucketDiff;
    if (a.daysUntilDue !== null && b.daysUntilDue !== null && a.daysUntilDue !== b.daysUntilDue) {
      return a.daysUntilDue - b.daysUntilDue;
    }
    return b.amountCents - a.amountCents;
  });

  // --- Agregados ------------------------------------------------------------
  const bucketMap = new Map<string, BucketTotal>(
    AGING_BUCKET_ORDER.map((bucket) => [bucket, { bucket, cents: 0, count: 0 }]),
  );
  const counterpartyMap = new Map<string, CounterpartyTotal>();

  let totalCents = 0;
  let overdueCents = 0;
  let overdueCount = 0;
  let dueThisWeekCents = 0;

  for (const item of items) {
    totalCents += item.amountCents;

    const bucket = bucketMap.get(item.bucket)!;
    bucket.cents += item.amountCents;
    bucket.count += 1;

    if (item.bucket === "OVERDUE") {
      overdueCents += item.amountCents;
      overdueCount += 1;
    } else if (item.bucket === "DUE_7") {
      dueThisWeekCents += item.amountCents;
    }

    // La llave de agrupación separa los tres orígenes de identidad para que
    // nunca colisionen entre sí: un proveedor (factura), un payee (gasto con
    // contraparte) y una categoría (gasto casual) viven en espacios distintos.
    const key = item.supplierId ?? (item.payeeId ? `payee:${item.payeeId}` : `label:${item.counterparty}`);
    const existing = counterpartyMap.get(key);
    if (existing) {
      existing.totalCents += item.amountCents;
      existing.count += 1;
      if (item.bucket === "OVERDUE") existing.overdueCents += item.amountCents;
    } else {
      counterpartyMap.set(key, {
        supplierId: item.supplierId,
        payeeId: item.payeeId,
        name: item.counterparty,
        totalCents: item.amountCents,
        overdueCents: item.bucket === "OVERDUE" ? item.amountCents : 0,
        count: 1,
      });
    }
  }

  const itemsLimit = filter.itemsLimit ?? PAYABLES_ITEMS_LIMIT;

  return {
    // El corte va aquí, después de recorrer todo `items` para los agregados.
    items: items.slice(0, itemsLimit),
    itemsTotal: items.length,
    totalCents,
    overdueCents,
    overdueCount,
    dueThisWeekCents,
    buckets: AGING_BUCKET_ORDER.map((b) => bucketMap.get(b)!).filter((b) => b.count > 0),
    byCounterparty: [...counterpartyMap.values()].sort((a, b) => {
      // Quien más te tiene vencido va primero; a igualdad, quien más te debe.
      if (b.overdueCents !== a.overdueCents) return b.overdueCents - a.overdueCents;
      return b.totalCents - a.totalCents;
    }),
    missingDueDateCount,
  };
}

// NOTA — aquí vivían `markInvoicePaid` y `markExpensePaid`.
//
// Se retiraron junto con el POST de `/api/finance/payables`. Marcaban una
// partida como pagada en una sola escritura, con permiso de GERENTE, saltándose
// los cuatro controles que definen el módulo de tesorería
// (`docs/plan-cuentas-por-pagar-reconciliado.md`):
//
//   1. la regla de umbral que decide QUIÉN puede autorizar ese monto,
//   2. la doble firma cuando el monto la exige,
//   3. el lote, que congela la CLABE verificada del proveedor al cerrarse,
//   4. la conciliación contra el movimiento bancario — "ejecutado" no es
//      "conciliado": lo primero es lo que el sistema cree, lo segundo es lo que
//      el banco confirma.
//
// El registro de pagos regresa con el flujo completo (paso 5 del plan). Hasta
// entonces esta superficie es de solo lectura: es preferible que el pago se
// siga registrando fuera del sistema a que el sistema afirme un control que no
// tiene.

/** Días de crédito por proveedor, para recalcular vencimientos al capturarlos. */
export async function updateSupplierPaymentTerms(
  companyId: string,
  supplierId: string,
  paymentTermsDays: number,
) {
  const [updated] = await db
    .update(suppliers)
    .set({ paymentTermsDays, updatedAt: new Date() })
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.companyId, companyId)))
    .returning();

  if (!updated) return null;

  // Los vencimientos ya calculados con los términos viejos quedarían mintiendo.
  // Solo se recalculan los que siguen sin pagarse: reescribir el vencimiento de
  // una factura liquidada cambiaría el historial.
  await db
    .update(invoices)
    .set({
      // `::integer` explícito: sin él el parámetro viaja como `unknown` y
      // Postgres no puede elegir entre `date + integer` y `date + interval`
      // ("operator is not unique: date + unknown"). Esta función nunca se había
      // ejecutado —estaba definida y sin llamadores—, así que el error salió a
      // la luz al conectarla con la edición de proveedores.
      dueDate: sql`(substring(${invoices.fecha} from 1 for 10)::date + ${paymentTermsDays}::integer)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(invoices.companyId, companyId),
        eq(invoices.supplierId, supplierId),
        eq(invoices.paymentStatus, "PENDING"),
        sql`substring(${invoices.fecha} from 1 for 10) ~ '^\\d{4}-\\d{2}-\\d{2}$'`,
      ),
    );

  return updated;
}
