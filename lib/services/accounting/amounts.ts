/**
 * Amount helpers for the accounting ledger.
 *
 * Importes contables se guardan como centavos enteros. Estos helpers rechazan
 * valores que JavaScript no puede sumar con exactitud, de modo que un descuadre
 * por redondeo flotante no pueda llegar a una póliza. No redondean: devuelven
 * error explícito en vez de convertir silenciosamente.
 */

/** 2^53 - 1: máximo entero que JavaScript representa sin pérdida. */
export const MAX_CENTS = 9_007_199_254_740_991;

export interface JournalSideLine {
  debitCents: number;
  creditCents: number;
}

export interface JournalTotals {
  debitCents: number;
  creditCents: number;
  balanced: boolean;
}

/** Valida un importe en centavos ya calculado. */
export function assertCents(value: number, label = "importe"): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RangeError(`El ${label} debe ser un entero en centavos.`);
  }
  if (value < 0) {
    throw new RangeError(`El ${label} no puede ser negativo.`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`El ${label} excede el rango entero seguro.`);
  }
  return value;
}

/** Suma centavos rechazando cualquier desbordamiento del entero seguro. */
export function sumCents(values: readonly number[], label = "total"): number {
  let total = 0;
  for (const value of values) {
    total += assertCents(value, label);
    if (!Number.isSafeInteger(total)) {
      throw new RangeError(`El ${label} excede el rango entero seguro.`);
    }
  }
  return total;
}

/**
 * Convierte un importe decimal ("1234.5", 1234.5) a centavos sin pasar por
 * aritmética flotante. Acepta hasta dos decimales y rechaza el resto en vez de
 * redondear. Los números se interpretan como importes, no como centavos.
 */
export function toCents(amount: string | number, label = "importe"): number {
  if (typeof amount === "number" && !Number.isFinite(amount)) {
    throw new RangeError(`El ${label} no es un número válido.`);
  }
  const raw = typeof amount === "number" ? String(amount) : amount.trim();
  const match = /^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) {
    throw new RangeError(`El ${label} debe ser positivo con hasta dos decimales.`);
  }
  const cents = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (cents > BigInt(MAX_CENTS)) throw new RangeError(`El ${label} excede el rango entero seguro.`);
  return assertCents(Number(cents), label);
}

/** Totales de un conjunto de renglones; `balanced` exige cargos = abonos. */
export function totalsOf(lines: readonly JournalSideLine[]): JournalTotals {
  const debitCents = sumCents(lines.map(line => line.debitCents), "total de cargos");
  const creditCents = sumCents(lines.map(line => line.creditCents), "total de abonos");
  return { debitCents, creditCents, balanced: debitCents === creditCents };
}
