// Contrato de Cuentas por Pagar (M15 → M16).
//
// Igual que `pnl-types.ts` y `financial-kpi-types.ts`, este módulo NO tiene
// dependencias de runtime: lo comparten el servicio (servidor) y la pantalla
// (cliente) sin arrastrar Drizzle al bundle del navegador.

/** De dónde nace la obligación. */
export type PayableSource =
  /** CFDI recibido de un proveedor. */
  | "INVOICE"
  /** Gasto operativo ya autorizado y todavía sin pagar (renta, servicios...). */
  | "OPERATING_EXPENSE";

/**
 * Tramo de antigüedad relativo a hoy.
 *
 * `OVERDUE` va primero a propósito: es el único que ya causó daño.
 */
export type AgingBucket = "OVERDUE" | "DUE_7" | "DUE_15" | "DUE_30" | "DUE_LATER" | "NO_DUE_DATE";

export const AGING_BUCKET_ORDER: AgingBucket[] = [
  "OVERDUE",
  "DUE_7",
  "DUE_15",
  "DUE_30",
  "DUE_LATER",
  "NO_DUE_DATE",
];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  OVERDUE: "Vencido",
  DUE_7: "Vence en 7 días",
  DUE_15: "Vence en 8-15 días",
  DUE_30: "Vence en 16-30 días",
  DUE_LATER: "Vence en más de 30 días",
  NO_DUE_DATE: "Sin fecha de vencimiento",
};

export interface PayableItem {
  id: string;
  source: PayableSource;
  /** Folio del CFDI o descripción del gasto. */
  reference: string;
  counterparty: string;
  supplierId: string | null;
  /** Contraparte (payee) del gasto operativo. `null` en facturas y gastos casuales. */
  payeeId: string | null;
  branchId: string | null;
  branchName: string | null;
  amountCents: number;
  /** `null` cuando la factura no tiene fecha parseable o el gasto no la declaró. */
  dueDate: string | null;
  /** Días de atraso (positivo) o que faltan (negativo). `null` sin vencimiento. */
  daysUntilDue: number | null;
  bucket: AgingBucket;
  /** Conciliación contra OC y recepción. Solo aplica a facturas. */
  matchStatus: string | null;
  hasDiscrepancy: boolean;
}

export interface BucketTotal {
  bucket: AgingBucket;
  cents: number;
  count: number;
}

export interface CounterpartyTotal {
  supplierId: string | null;
  /** Contraparte (payee) del gasto operativo. `null` cuando se agrupa por categoría o proveedor. */
  payeeId: string | null;
  name: string;
  totalCents: number;
  overdueCents: number;
  count: number;
}

export interface AccountsPayableResult {
  items: PayableItem[];
  totalCents: number;
  overdueCents: number;
  overdueCount: number;
  /** Lo que vence dentro de los próximos 7 días, sin contar lo ya vencido. */
  dueThisWeekCents: number;
  buckets: BucketTotal[];
  byCounterparty: CounterpartyTotal[];
  /**
   * Facturas sin `dueDate` utilizable. Se cuentan aparte porque no son un
   * problema de tesorería sino de captura, y esconderlas en "sin vencimiento"
   * haría que nadie las arreglara.
   */
  missingDueDateCount: number;
}

/** Clasifica por días restantes. Negativo = ya venció. */
export function bucketFor(daysUntilDue: number | null): AgingBucket {
  if (daysUntilDue === null) return "NO_DUE_DATE";
  if (daysUntilDue < 0) return "OVERDUE";
  if (daysUntilDue <= 7) return "DUE_7";
  if (daysUntilDue <= 15) return "DUE_15";
  if (daysUntilDue <= 30) return "DUE_30";
  return "DUE_LATER";
}
