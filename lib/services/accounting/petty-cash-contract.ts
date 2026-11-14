import { assertCents, sumCents, type JournalSideLine } from "./amounts";

export type PettyCashPlanInput =
  | { kind: "OUT"; amountCents: number; taxCents: number }
  | { kind: "REPLENISHMENT"; amountCents: number; isOpening?: boolean };

export type PettyCashRole = "EXPENSE" | "RECOVERABLE_TAX" | "PETTY_CASH" | "PAYMENT_SOURCE";

const OPENING_CONCEPTS = new Set([
  "apertura del fondo de caja chica",
  "reapertura del fondo de caja chica",
]);

/** Fund opening/reopening uses REPLENISHMENT in operational history, but is not a bank replenishment. */
export function isPettyCashOpeningConcept(concept: string | null | undefined): boolean {
  if (typeof concept !== "string") return false;
  return OPENING_CONCEPTS.has(concept.trim().replace(/\s+/g, " ").toLowerCase());
}

/**
 * Canonical document identity shared between operating_expenses and petty_cash_transactions.
 * A storage URL or filename alone is never accepted as document identity.
 */
export function normalizeAccountingVoucherKey(value: string | null | undefined): string {
  if (typeof value !== "string") {
    throw new RangeError("Falta la clave documental del comprobante.");
  }
  const normalized = value.trim().replace(/\s+/g, " ").toUpperCase();
  if (!normalized) {
    throw new RangeError("Falta la clave documental del comprobante.");
  }
  if (
    /^(HTTPS?|S3|FILE|BLOB|DATA):\/\//i.test(normalized)
    || normalized.startsWith("/")
    || /\.(PNG|JPE?G|WEBP|GIF|PDF)(\?.*)?$/i.test(normalized)
  ) {
    throw new RangeError("Una URL o ruta de archivo no es identidad documental suficiente.");
  }
  if (normalized.length < 3 || normalized.length > 160 || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new RangeError("La clave documental del comprobante debe tener entre 3 y 160 caracteres válidos.");
  }
  return normalized;
}

/**
 * Pure accounting plan for petty cash:
 * - OUT recognizes expense + optional documented recoverable tax against PETTY_CASH.
 * - REPLENISHMENT moves cash from PAYMENT_SOURCE (own bank) to PETTY_CASH without creating expense.
 */
export function pettyCashPlan(input: PettyCashPlanInput): (JournalSideLine & { role: PettyCashRole })[] {
  const lines: (JournalSideLine & { role: PettyCashRole })[] = [];
  const add = (role: PettyCashRole, amount: number, debit: boolean) => {
    if (amount) lines.push({ role, debitCents: debit ? amount : 0, creditCents: debit ? 0 : amount });
  };
  if (input.kind === "REPLENISHMENT") {
    if (input.isOpening) {
      throw new RangeError("La apertura o reapertura del fondo no se contabiliza como reposición.");
    }
    const amount = assertCents(input.amountCents);
    if (!amount) throw new RangeError("La reposición de caja chica debe ser positiva.");
    add("PETTY_CASH", amount, true);
    add("PAYMENT_SOURCE", amount, false);
    return lines;
  }
  const amount = assertCents(input.amountCents);
  const tax = assertCents(input.taxCents);
  if (!amount) throw new RangeError("La salida de caja chica debe ser positiva.");
  if (tax >= amount) {
    throw new RangeError("El impuesto documentado debe ser menor al importe bruto de caja chica.");
  }
  const expense = amount - tax;
  if (sumCents([expense, tax]) !== amount) {
    throw new RangeError("El desglose de caja chica no cuadra con el importe bruto.");
  }
  add("EXPENSE", expense, true);
  add("RECOVERABLE_TAX", tax, true);
  add("PETTY_CASH", amount, false);
  return lines;
}
