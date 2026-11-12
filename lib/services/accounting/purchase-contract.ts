import { assertCents, MAX_CENTS, sumCents } from "./amounts";

export type PurchasePlanInput =
  | { kind: "RECEIPT"; receivedCents: number }
  | { kind: "INVOICE"; receivedCents: number; netCents: number; taxCents: number; totalCents: number; differenceApproved: boolean }
  | { kind: "CREDIT"; returnedCents: number; netCents: number; taxCents: number; totalCents: number }
  | { kind: "PAYMENT"; amountCents: number };

/** Quantity is in the received base unit; cost is documented cents per that unit. */
export function receiptValue(lines: readonly { quantity: string | number; unitCostCents: number | null;
  basis: string; accepted: boolean }[]): number {
  if (!lines.length) throw new RangeError("La recepción no tiene partidas documentadas.");
  let scaled = BigInt(0);
  for (const line of lines) {
    if (!line.accepted) throw new RangeError("La recepción contiene mercancía en cuarentena o rechazada; requiere clasificación explícita.");
    if (!["DOCUMENT", "PURCHASE_ORDER"].includes(line.basis)) throw new RangeError("El costo de recepción debe estar documentado; el último costo no es evidencia.");
    if (line.unitCostCents === null) throw new RangeError("Falta el costo documentado de una partida.");
    const cost = assertCents(line.unitCostCents);
    const match = /^(\d{1,12})(?:\.(\d{1,4}))?$/.exec(String(line.quantity));
    if (!match) throw new RangeError("Cantidad inválida: usa hasta cuatro decimales.");
    const quantity = BigInt(match[1]) * BigInt(10000) + BigInt((match[2] ?? "").padEnd(4, "0"));
    if (quantity <= BigInt(0)) throw new RangeError("La cantidad recibida debe ser positiva.");
    scaled += quantity * BigInt(cost);
  }
  const cents = (scaled + BigInt(5000)) / BigInt(10000);
  if (cents <= BigInt(0) || cents > BigInt(MAX_CENTS)) throw new RangeError("El valor recibido debe ser positivo y estar dentro del rango seguro.");
  return Number(cents);
}

/** Technical development contract. Accounts and tax treatment require explicit reviewed rules. */
export function purchasePlan(input: PurchasePlanInput) {
  const lines: { role: string; debitCents: number; creditCents: number }[] = [];
  const add = (role: string, signedDebit: number) => {
    assertCents(Math.abs(signedDebit));
    if (signedDebit) lines.push({ role, debitCents: Math.max(0, signedDebit), creditCents: Math.max(0, -signedDebit) });
  };
  if (input.kind === "RECEIPT" || input.kind === "PAYMENT") {
    const amount = assertCents(input.kind === "RECEIPT" ? input.receivedCents : input.amountCents);
    if (!amount) throw new RangeError("El importe debe ser positivo.");
    add(input.kind === "RECEIPT" ? "INVENTORY" : "PAYABLE", amount);
    add(input.kind === "RECEIPT" ? "RECEIVING_PENDING" : "PAYMENT_SOURCE", -amount);
    return lines;
  }
  const net = assertCents(input.netCents), tax = assertCents(input.taxCents), total = assertCents(input.totalCents);
  if (!total || sumCents([net, tax]) !== total) throw new RangeError("El subtotal más impuesto documentado no coincide con el total.");
  if (input.kind === "INVOICE") {
    const received = assertCents(input.receivedCents);
    if (!received) throw new RangeError("Falta el valor de la recepción original.");
    if (net !== received && !input.differenceApproved) throw new RangeError("La diferencia requiere revisión y motivo explícitos.");
    add("RECEIVING_PENDING", received);
    add("PURCHASE_VARIANCE", net - received);
    add("RECOVERABLE_TAX", tax);
    add("PAYABLE", -total);
  } else {
    const returned = assertCents(input.returnedCents);
    add("PAYABLE", total);
    add("INVENTORY", -returned);
    add("PURCHASE_VARIANCE", returned - net);
    add("RECOVERABLE_TAX", -tax);
  }
  return lines;
}
