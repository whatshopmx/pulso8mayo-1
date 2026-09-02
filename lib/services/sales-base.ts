/**
 * A3.2 — La base sobre la que se calculan los porcentajes del módulo de Finanzas.
 *
 * `daily_sales_cuts.total_sales` es la venta **con IVA**: es lo que el POS
 * reporta y lo que entró a la caja. Hasta A3.2 todos los porcentajes del módulo
 * —food cost, labor cost, margen operativo— se dividían entre esa cifra, así que
 * la base venía inflada un 16%: un food cost real del 34.8% se presentaba como
 * 30%, justo del lado verde del semáforo. Dos comentarios del repo afirmaban
 * incluso que la columna era neta (`labor-cost-service.ts`, encabezado de
 * `pnl-service.ts`), y por eso el hallazgo tardó en verse.
 *
 * El insumo correcto es `tax_amount`, que `sales-ingestion-service` ya leía del
 * archivo del POS y que A3.1 empezó a guardar. Cuando existe, la base es
 * medida. Cuando no —el POS no lo exporta, o el corte es de los históricos sin
 * desglose— hay dos conductas posibles y **las dos se declaran**:
 *
 *  - `vat_rate_percent` configurada (default 16): se estima la base neta y el
 *    renglón se marca `DERIVED`. Da comparabilidad entre períodos sin fingir
 *    que la cifra se midió.
 *  - `vat_rate_percent` en `null`: no se estima nada. El porcentaje se calcula
 *    sobre la base bruta y la nota lo dice en voz alta. Es la conducta para
 *    quien no quiere que Pulso suponga una tasa por él —un abarrote que mezcla
 *    tasas, una sucursal en franja fronteriza.
 *
 * Vive aparte y no dentro de `pnl-service` porque **cuatro consumidores tienen
 * que compartir la misma base**: P&L, KPI financiero, costo laboral y el
 * tablero de comisiones. Si uno cambia de base y otro no, vuelven a dar números
 * distintos para el mismo concepto — que es el pecado que el rediseño del KPI ya
 * había corregido una vez.
 */
import { db } from "@/lib/db";
import { tenantOperatingConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** De dónde salió la base contra la que se dividen los porcentajes. */
export type SalesBaseKind =
  /** Venta neta con el IVA que el POS exportó en cada corte. */
  | "NET_MEASURED"
  /** Venta neta estimada con la tasa configurada del inquilino. */
  | "NET_DERIVED"
  /** Venta con IVA: no hay impuesto capturado y el inquilino apagó la estimación. */
  | "GROSS_DECLARED";

export interface SalesBase {
  kind: SalesBaseKind;
  /** Base en centavos contra la que se calcula cualquier % sobre ventas. */
  baseCents: number;
  /** Venta con IVA, tal como la reporta el POS. */
  grossCents: number;
  /** IVA descontado para llegar a la base; 0 cuando la base es bruta. */
  taxCents: number;
  /** Cortes del período con `tax_amount` capturado, de `cutsCount` totales. */
  cutsWithTax: number;
  cutsCount: number;
  /** Frase lista para la nota de un renglón. Siempre dice qué base se usó. */
  note: string;
}

/** Tasa de IVA del inquilino, o `null` si apagó la estimación. */
export async function getVatRatePercent(companyId: string): Promise<number | null> {
  const [row] = await db
    .select({ vatRatePercent: tenantOperatingConfig.vatRatePercent })
    .from(tenantOperatingConfig)
    .where(eq(tenantOperatingConfig.companyId, companyId))
    .limit(1);

  // Sin fila de configuración se usa el default del esquema (16). Un inquilino
  // que nunca abrió la pantalla de configuración no debería quedarse sin base
  // neta por omisión: la tasa general es la conducta razonable, y la nota la
  // declara igual.
  if (!row) return 16;

  const raw = row.vatRatePercent;
  if (raw === null || raw === undefined) return null;

  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Resuelve la base de un período a partir de los agregados de sus cortes.
 *
 * No consulta nada: recibe las sumas ya calculadas por quien las necesita, para
 * que agregar la base no agregue una consulta por sucursal. `vatRatePercent` se
 * lee una sola vez por petición (`getVatRatePercent`) y se pasa a cada sucursal.
 *
 * **La mezcla se resuelve hacia abajo.** Si en el período algunos cortes traen
 * IVA y otros no, la base es `NET_DERIVED`, no `NET_MEASURED`: una suma con un
 * sumando estimado es una estimación completa, y es lo más fuerte que se puede
 * afirmar de ella. Es el mismo criterio de `weakestOf` en `pnl-types`.
 */
export function resolveSalesBase(input: {
  grossCents: number;
  /** Suma de `tax_amount` de los cortes que lo traen. */
  taxCents: number;
  cutsWithTax: number;
  cutsCount: number;
  vatRatePercent: number | null;
}): SalesBase {
  const { grossCents, cutsWithTax, cutsCount, vatRatePercent } = input;
  const taxCapturado = Math.max(0, input.taxCents);

  if (grossCents <= 0 || cutsCount === 0) {
    return {
      kind: "GROSS_DECLARED",
      baseCents: grossCents,
      grossCents,
      taxCents: 0,
      cutsWithTax,
      cutsCount,
      note: "Sin ventas capturadas en el período: no hay base sobre la cual calcular porcentajes.",
    };
  }

  // Todos los cortes traen su IVA: base medida, sin supuestos.
  if (cutsWithTax === cutsCount && taxCapturado > 0) {
    return {
      kind: "NET_MEASURED",
      baseCents: grossCents - taxCapturado,
      grossCents,
      taxCents: taxCapturado,
      cutsWithTax,
      cutsCount,
      note: `Porcentajes sobre venta neta: el IVA (${pesos(taxCapturado)}) sale del desglose que el POS exportó en los ${cutsCount} cortes del período.`,
    };
  }

  // El inquilino apagó la estimación: base bruta, declarada.
  if (vatRatePercent === null || vatRatePercent <= 0) {
    return {
      kind: "GROSS_DECLARED",
      baseCents: grossCents,
      grossCents,
      taxCents: 0,
      cutsWithTax,
      cutsCount,
      note:
        cutsWithTax > 0
          ? `Porcentajes sobre venta CON IVA: sólo ${cutsWithTax} de ${cutsCount} cortes traen el impuesto desglosado y la estimación de IVA está apagada en la configuración del grupo.`
          : "Porcentajes sobre venta CON IVA: el POS no exporta el impuesto y la estimación de IVA está apagada en la configuración del grupo. Son entre 2 y 5 puntos más bajos de lo real.",
    };
  }

  // Estimación: el IVA capturado se respeta y sólo se estima lo que falta.
  const factor = 1 + vatRatePercent / 100;
  const brutoConIvaMedido = proporcionConIva(grossCents, taxCapturado, cutsWithTax, cutsCount);
  const brutoSinDesglose = grossCents - brutoConIvaMedido;
  const ivaEstimado = Math.round(brutoSinDesglose - brutoSinDesglose / factor);
  const taxTotal = taxCapturado + Math.max(0, ivaEstimado);

  return {
    kind: "NET_DERIVED",
    baseCents: grossCents - taxTotal,
    grossCents,
    taxCents: taxTotal,
    cutsWithTax,
    cutsCount,
    note:
      cutsWithTax > 0
        ? `Porcentajes sobre venta neta. ${cutsWithTax} de ${cutsCount} cortes traen el IVA desglosado; en el resto se estima al ${vatRatePercent}% configurado para el grupo. Es un supuesto, no una medición.`
        : `Porcentajes sobre venta neta estimada al ${vatRatePercent}% de IVA configurado para el grupo. El POS no exporta el impuesto, así que es un supuesto: para medirlo, activa la columna de IVA en la exportación del punto de venta.`,
  };
}

/**
 * Cuánta de la venta bruta corresponde a los cortes que sí traen IVA.
 *
 * No hay forma exacta de saberlo sin traer los cortes uno por uno, y traerlos
 * costaría una consulta por sucursal justo en la ruta que se rediseñó para no
 * tenerla. Se reparte por número de cortes, que es la aproximación que menos
 * supone: todos los cortes de un período son días del mismo negocio.
 */
function proporcionConIva(
  grossCents: number,
  taxCapturado: number,
  cutsWithTax: number,
  cutsCount: number,
): number {
  if (cutsWithTax === 0) return 0;
  if (cutsWithTax >= cutsCount) return grossCents;
  const estimado = Math.round((grossCents * cutsWithTax) / cutsCount);
  // Nunca menos que el propio impuesto capturado: sería un neto negativo.
  return Math.max(estimado, taxCapturado);
}

function pesos(cents: number): string {
  return (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}
