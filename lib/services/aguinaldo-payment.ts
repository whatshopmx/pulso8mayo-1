import { calcularRetencionAguinaldoArt174, type RetencionAguinaldoArt174Resultado } from "./isr-annual-withholding";

/** Fecha civil predeterminada del flujo mexicano, independiente de la zona del servidor. */
export function hoyCivilAguinaldo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Sin coerción ni normalización de días inexistentes; nunca aceptar un timestamp. */
export function resolverFechaPagoAguinaldo(fechaPago: string) {
  if (typeof fechaPago !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fechaPago)) {
    throw new RangeError("fechaPago debe ser una fecha civil YYYY-MM-DD.");
  }
  const fecha = new Date(`${fechaPago}T12:00:00Z`);
  if (!Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== fechaPago) {
    throw new RangeError("fechaPago contiene un día inexistente.");
  }
  return { fechaPago, anioPago: Number(fechaPago.slice(0, 4)), mesPago: Number(fechaPago.slice(5, 7)) };
}

export interface AguinaldoPago {
  retencion: RetencionAguinaldoArt174Resultado;
  totalDeduccionesCents: number;
  netoCents: number;
}

/** Contrato compartido por preview, edición de días y ejecución; sin DB ni timbrador. */
export function calcularPagoAguinaldo(
  calculo: { brutoCents: number; exentoCents: number; gravadoCents: number },
  salarioDiarioCents: number,
  fechaPago: string,
): AguinaldoPago {
  const fecha = resolverFechaPagoAguinaldo(fechaPago);
  if (![calculo.brutoCents, calculo.exentoCents, calculo.gravadoCents].every((n) => Number.isSafeInteger(n) && n >= 0)
    || calculo.brutoCents !== calculo.exentoCents + calculo.gravadoCents) {
    throw new RangeError("Cálculo de aguinaldo inválido: bruto debe ser exento + gravado en centavos enteros.");
  }
  const retencion = calcularRetencionAguinaldoArt174({
    anioPago: fecha.anioPago, mesPago: fecha.mesPago,
    aguinaldoBrutoCents: calculo.brutoCents, aguinaldoGravadoCents: calculo.gravadoCents, salarioDiarioCents,
  });
  if (retencion.ajusteSubsidioCausadoCents > 0 || retencion.subsidioAplicadoCents > 0) {
    throw new RangeError("Se requieren acumulados mensuales conciliados para aplicar o regularizar el subsidio antes de timbrar este aguinaldo.");
  }
  const totalDeduccionesCents = retencion.retencionCents;
  const netoCents = calculo.brutoCents - totalDeduccionesCents;
  if (!Number.isSafeInteger(netoCents) || netoCents < 0) throw new RangeError("Neto del aguinaldo inválido.");
  return { retencion, totalDeduccionesCents, netoCents };
}
