// M13 / T27: POS column alias dictionary + value parsers.
// Pure data + pure functions (no DB, no I/O) so they can be unit-verified
// and reused by the ingestion service, the upload UI and WhatsApp ingest.

/**
 * Canonical sales-cut fields every POS export is mapped to (AD-7).
 * `businessDate` and `totalSales` are required; everything else is optional.
 * `paymentMethod` / `category` are source *columns* used in detail-shaped
 * files, not stored fields on daily_sales_cuts.
 */
export type CanonicalField =
  | "businessDate"
  | "totalSales"
  | "cashSales"
  | "cardSales"
  | "otherPayments"
  | "ticketCount"
  | "taxAmount"
  | "discounts"
  | "cancellations"
  | "paymentMethod"
  | "category";

export const CANONICAL_FIELDS: CanonicalField[] = [
  "businessDate",
  "totalSales",
  "cashSales",
  "cardSales",
  "otherPayments",
  "ticketCount",
  "taxAmount",
  "discounts",
  "cancellations",
  "paymentMethod",
  "category",
];

/** Human-readable Spanish labels for the mapping UI (T29). */
export const FIELD_LABELS: Record<CanonicalField, string> = {
  businessDate: "Fecha",
  totalSales: "Venta total",
  cashSales: "Efectivo",
  cardSales: "Tarjeta",
  otherPayments: "Otros pagos",
  ticketCount: "No. de tickets",
  taxAmount: "IVA",
  discounts: "Descuentos",
  cancellations: "Cancelaciones",
  paymentMethod: "Forma de pago",
  category: "Categoría",
};

/**
 * Alias variants per canonical field, covering common Mexican POS exports
 * (Soft Restaurant, Aspel CAJA, Eleventa, SICAR, Square, Poster, Aloha,
 * Simphony) plus English exports. Aliases are stored raw; they are
 * normalized through `normalizeHeader` before matching, so accents, case
 * and punctuation do not matter.
 */
export const FIELD_ALIASES: Record<CanonicalField, string[]> = {
  businessDate: [
    "Fecha",
    "Fecha de Venta",
    "Fecha Venta",
    "Fecha Corte",
    "Fecha de Corte",
    "Fecha de Cierre",
    "Fecha Operación",
    "Fecha Operacion",
    "Día",
    "Dia",
    "Date",
    "Business Date",
    "Sale Date",
  ],
  totalSales: [
    "Total",
    "Venta Total",
    "Total Ventas",
    "Total de Ventas",
    "Total de Venta",
    "Importe Total",
    "Venta Neta",
    "Ventas Netas",
    "Gran Total",
    "Total General",
    "Total Vendido",
    "Monto Total",
    "Importe de Venta",
    "Net Sales",
    "Gross Sales",
    "Total Sales",
    "Sales",
    "Revenue",
  ],
  cashSales: [
    "Efectivo",
    "Cash",
    "Venta Efectivo",
    "Ventas Efectivo",
    "Total Efectivo",
    "Efectivo Ventas",
    "Cash Sales",
    "Venta en Efectivo",
  ],
  cardSales: [
    "Tarjeta",
    "Tarjetas",
    "TDC",
    "TDD",
    "Crédito",
    "Credito",
    "Débito",
    "Debito",
    "Tarjeta Crédito",
    "Tarjeta Credito",
    "Tarjeta Débito",
    "Tarjeta Debito",
    "Tarjeta de Crédito",
    "Tarjeta de Debito",
    "Venta Tarjeta",
    "Ventas Tarjeta",
    "Total Tarjeta",
    "Card",
    "Card Sales",
    "Credit Card",
    "Debit Card",
    "Credit",
    "Debit",
  ],
  otherPayments: [
    "Otros",
    "Otros Pagos",
    "Otras Formas de Pago",
    "Otros Medios de Pago",
    "Vales",
    "Vales de Despensa",
    "Transferencia",
    "Transferencias",
    "Cheques",
    "Cheque",
    "Other",
    "Other Payments",
  ],
  ticketCount: [
    "Tickets",
    "No. Tickets",
    "No Tickets",
    "Num Tickets",
    "Núm. Tickets",
    "No. de Tickets",
    "Numero de Tickets",
    "Número de Tickets",
    "Cantidad Tickets",
    "Cuentas",
    "No. Cuentas",
    "Transacciones",
    "Folios",
    "No. Folios",
    "Ticket Count",
    "Transactions",
    "Checks",
    "Num Tickets Sold",
  ],
  taxAmount: [
    "IVA",
    "Impuestos",
    "Impuesto",
    "Total IVA",
    "IVA 16%",
    "Impuesto Trasladado",
    "Tax",
    "Tax Amount",
    "Total Tax",
  ],
  discounts: [
    "Descuentos",
    "Descuento",
    "Total Descuentos",
    "Discount",
    "Discounts",
  ],
  cancellations: [
    "Cancelaciones",
    "Cancelados",
    "Cancelado",
    "Ventas Canceladas",
    "Tickets Cancelados",
    "Cancellations",
    "Cancelled",
  ],
  paymentMethod: [
    "Forma de Pago",
    "Forma Pago",
    "Método de Pago",
    "Metodo de Pago",
    "Tipo de Pago",
    "Medio de Pago",
    "Modo de Pago",
    "F. Pago",
    "Payment Method",
    "Payment",
    "Payment Type",
    "Payment Mode",
  ],
  category: [
    "Categoría",
    "Categoria",
    "Category",
    "Category Name",
    "Grupo",
    "Familia",
    "Departamento",
    "Depto",
  ],
};

/**
 * Payment-method buckets used to classify labels (rows in payment-summary
 * files, values in the paymentMethod column of ticket-detail files, and
 * key-value rows in summary files). Aggregator apps map to DELIVERY so the
 * dashboard can break sales out by channel (AD-8, T30).
 */
export type PaymentBucket = "CASH" | "CARD" | "DELIVERY" | "OTHER";

export const PAYMENT_METHOD_ALIASES: Record<PaymentBucket, string[]> = {
  CASH: ["Efectivo", "Cash"],
  CARD: [
    "Tarjeta",
    "Tarjetas",
    "TDC",
    "TDD",
    "Crédito",
    "Credito",
    "Débito",
    "Debito",
    "Tarjeta de Crédito",
    "Tarjeta de Credito",
    "Tarjeta de Débito",
    "Tarjeta de Debito",
    "Visa",
    "Mastercard",
    "Master Card",
    "Amex",
    "American Express",
    "Clip",
    "Mercado Pago",
    "MercadoPago",
    "Card",
    "Credit",
    "Debit",
    "Credit Card",
    "Debit Card",
  ],
  DELIVERY: [
    "Rappi",
    "Uber Eats",
    "UberEats",
    "UberEATS",
    "DiDi",
    "Didi",
    "DiDi Food",
    "Didi Food",
    "Pedidos Ya",
    "PedidosYa",
    "Delivery",
    "Domicilio",
    "A Domicilio",
    "Plataformas",
    "Agregadores",
  ],
  OTHER: [
    "Vales",
    "Vale",
    "Vales de Despensa",
    "Transferencia",
    "Transferencias",
    "Transfer",
    "Cheque",
    "Cheques",
    "Cortesía",
    "Cortesia",
    "Cortesías",
    "Otros",
    "Otro",
    "Other",
  ],
};

/** Labels that represent a grand-total row (cross-check, never a payment). */
export const TOTAL_LABELS = [
  "Total",
  "Gran Total",
  "Total General",
  "Total Ventas",
  "Total de Ventas",
  "Suma",
  "Sumas",
  "Totales",
  "Total Sales",
  "Grand Total",
];

// ---------------------------------------------------------------------------
// Normalization + matching
// ---------------------------------------------------------------------------

/**
 * Normalizes a header/label for matching: trims, lowercases, strips
 * diacritics and collapses any non-alphanumeric run into a single space.
 * "No. Tickets" → "no tickets", "Método de Pago" → "metodo de pago".
 */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Normalized alias → canonical field lookup, built once at module load. */
const FIELD_ALIAS_MAP: Map<string, CanonicalField> = (() => {
  const map = new Map<string, CanonicalField>();
  for (const field of CANONICAL_FIELDS) {
    for (const alias of FIELD_ALIASES[field]) {
      map.set(normalizeHeader(alias), field);
    }
  }
  return map;
})();

/** Normalized alias → payment bucket lookup, built once at module load. */
const PAYMENT_ALIAS_MAP: Map<string, PaymentBucket> = (() => {
  const map = new Map<string, PaymentBucket>();
  for (const bucket of Object.keys(PAYMENT_METHOD_ALIASES) as PaymentBucket[]) {
    for (const alias of PAYMENT_METHOD_ALIASES[bucket]) {
      map.set(normalizeHeader(alias), bucket);
    }
  }
  return map;
})();

const TOTAL_LABEL_SET = new Set(TOTAL_LABELS.map(normalizeHeader));

export type MatchConfidence = "high" | "medium";

/**
 * Matches a source header to a canonical field.
 *  - high   → exact normalized alias match
 *  - medium → fuzzy containment (header contains alias or vice versa),
 *             preferring the longest matching alias to avoid "total"
 *             shadowing "total efectivo".
 */
export function matchFieldAlias(
  header: string
): { field: CanonicalField; confidence: MatchConfidence } | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;

  const exact = FIELD_ALIAS_MAP.get(normalized);
  if (exact) return { field: exact, confidence: "high" };

  let best: { field: CanonicalField; aliasLength: number } | null = null;
  for (const [alias, field] of FIELD_ALIAS_MAP) {
    if (alias.length < 3) continue; // avoid noise from tiny aliases
    if (normalized.includes(alias) || alias.includes(normalized)) {
      if (!best || alias.length > best.aliasLength) {
        best = { field, aliasLength: alias.length };
      }
    }
  }
  return best ? { field: best.field, confidence: "medium" } : null;
}

/** Classifies a payment-method label into a bucket (exact → fuzzy). */
export function matchPaymentLabel(label: string): PaymentBucket | null {
  const normalized = normalizeHeader(label);
  if (!normalized) return null;

  const exact = PAYMENT_ALIAS_MAP.get(normalized);
  if (exact) return exact;

  let best: { bucket: PaymentBucket; aliasLength: number } | null = null;
  for (const [alias, bucket] of PAYMENT_ALIAS_MAP) {
    if (alias.length < 3) continue;
    if (normalized.includes(alias) || alias.includes(normalized)) {
      if (!best || alias.length > best.aliasLength) {
        best = { bucket, aliasLength: alias.length };
      }
    }
  }
  return best ? best.bucket : null;
}

/** True if a row label is a grand-total row (e.g. "Total", "Gran Total"). */
export function isTotalLabel(label: string): boolean {
  return TOTAL_LABEL_SET.has(normalizeHeader(label));
}

// ---------------------------------------------------------------------------
// Value parsers
// ---------------------------------------------------------------------------

/**
 * Parses a money value into integer cents (AD-5).
 * Accepts numbers and MX-formatted strings: "$10,000.00", "10000.00",
 * "10000", "(1,234.56)" for negatives, and decimal-comma "1234,56".
 * Returns null when the value is empty or not numeric.
 */
export function parseMoneyToCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }
  if (value instanceof Date) return null;

  let text = String(value).trim();
  if (!text) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  text = text.replace(/[$\s]|MXN/gi, "");
  if (!text) return null;

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");

  if (hasComma && hasDot) {
    // MX standard: comma thousands, dot decimal → "10,000.00"
    text = text.replace(/,/g, "");
  } else if (hasComma) {
    // Single comma + 2 trailing digits → decimal comma ("1234,56"),
    // otherwise thousands separator ("10,000").
    text = /,\d{2}$/.test(text) && (text.match(/,/g) || []).length === 1
      ? text.replace(",", ".")
      : text.replace(/,/g, "");
  } else if (hasDot && /\.\d{3}(\.|$)/.test(text)) {
    // "1.234" or "1.234.567" → thousands dots
    text = text.replace(/\./g, "");
  }

  const parsed = parseFloat(text);
  if (!Number.isFinite(parsed)) return null;
  return Math.round((negative ? -parsed : parsed) * 100);
}

/**
 * Parses an integer count (tickets, folios). Accepts numbers and plain
 * digit strings ("80"). Returns null otherwise.
 */
export function parseCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  const text = String(value).trim().replace(/,/g, "");
  if (!/^-?\d+$/.test(text)) return null;
  return parseInt(text, 10);
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30); // Excel serial day 0

/**
 * Parses a business date into a "YYYY-MM-DD" string.
 * Accepts Date objects (UTC getters — exceljs returns UTC-based dates),
 * Excel serial numbers, ISO strings ("2020-01-15") and MX format
 * ("15/01/2020", "15-01-2020"). Day/month ambiguity resolves to DD/MM
 * (Mexican convention). Returns null when unparseable or invalid.
 */
export function parseBusinessDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toISODate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = EXCEL_EPOCH_UTC + Math.round(value) * 86_400_000;
    const d = new Date(ms);
    return toISODate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  const text = String(value).trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) {
    return toISODate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(text);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    return toISODate(year, Number(dmy[2]), Number(dmy[1]));
  }

  return null;
}

function toISODate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null; // e.g. Feb 31 rolled over into March
  }
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
