import { db } from "@/lib/db";
import { configChangeLogs, tenantOperatingConfig } from "@/lib/db/schema";
import { and, desc, eq, inArray, lte } from "drizzle-orm";

/**
 * C14.3 — qué valor de un parámetro estaba vigente en una fecha dada.
 *
 * El problema que esto arregla: IVA, carga patronal, ISN y umbral de merma se
 * leen al calcular, así que cambiar el IVA de 16 a 8 **reescribía la historia**.
 * Un food cost de marzo se movía por una decisión de junio, y nadie podía
 * distinguir "así se vio en su momento" de "así se ve hoy".
 *
 * La vigencia no necesita su propia tabla: `config_change_logs` ya guarda cada
 * cambio con su fecha. Para saber qué valía un parámetro el día 31 de marzo
 * basta el último cambio anterior a ese día.
 *
 * La regla es "el valor vigente al **cierre** del periodo": un mes que ya
 * terminó conserva los números que tuvo al cerrarse, y sólo el periodo en
 * curso cambia cuando se edita un parámetro.
 */

/** Los cuatro parámetros con vigencia. Los umbrales y objetivos de semáforo no entran aquí. */
export const PARAMETROS_VIGENTES = [
  "vatRatePercent",
  "laborBurdenFactorPercent",
  "payrollStateTaxPercent",
  "mermaVarianceThresholdPct",
] as const;

export type ParametroVigente = (typeof PARAMETROS_VIGENTES)[number];

export interface ParametrosVigentes {
  vatRatePercent: string | null;
  laborBurdenFactorPercent: string | null;
  payrollStateTaxPercent: string | null;
  mermaVarianceThresholdPct: string | null;
}

/**
 * Valores vigentes en `asOf` (exclusivo: un cambio hecho ese mismo día a las
 * 18:00 todavía no cuenta para un periodo que terminó a las 23:59:59... salvo
 * que caiga antes; el corte es por timestamp, no por día).
 *
 * Si el historial no se puede leer —una base sin la migración aplicada, o un
 * fallo puntual— se devuelve el valor actual. Es peor mostrar el valor vigente
 * que no mostrar nada, y el origen queda declarado por el llamador.
 */
export async function parametrosVigentesEn(
  companyId: string,
  asOf: Date | string
): Promise<ParametrosVigentes> {
  const actual = await leerActuales(companyId);
  const corte = typeof asOf === "string" ? new Date(asOf) : asOf;
  if (Number.isNaN(corte.getTime())) return actual;

  try {
    const filas = await db
      .select({
        fieldName: configChangeLogs.fieldName,
        newValue: configChangeLogs.newValue,
      })
      .from(configChangeLogs)
      .where(
        and(
          eq(configChangeLogs.companyId, companyId),
          inArray(configChangeLogs.fieldName, [...PARAMETROS_VIGENTES]),
          lte(configChangeLogs.performedAt, corte)
        )
      )
      .orderBy(desc(configChangeLogs.performedAt));

    // El más reciente gana: se recorre de más nuevo a más viejo y no se
    // sobrescribe un campo ya visto.
    const vistos = new Set<string>();
    for (const fila of filas) {
      const campo = fila.fieldName as ParametroVigente;
      if (vistos.has(campo)) continue;
      vistos.add(campo);
      if (fila.newValue === null || fila.newValue === undefined) {
        actual[campo] = null;
      } else if (typeof fila.newValue === "number") {
        // Un porcentaje guardado nunca vuelve como número, pero un `jsonb`
        // leído de un valor antiguo sí puede: se normaliza a texto.
        actual[campo] = fila.newValue.toFixed(2);
      } else {
        actual[campo] = String(fila.newValue);
      }
    }
  } catch (error) {
    console.error("[operating-params] No se pudo leer el historial de vigencia:", error);
  }

  return actual;
}

/** Los valores que hay ahora mismo en la fila de configuración. */
async function leerActuales(companyId: string): Promise<ParametrosVigentes> {
  const [fila] = await db
    .select({
      vatRatePercent: tenantOperatingConfig.vatRatePercent,
      laborBurdenFactorPercent: tenantOperatingConfig.laborBurdenFactorPercent,
      payrollStateTaxPercent: tenantOperatingConfig.payrollStateTaxPercent,
      mermaVarianceThresholdPct: tenantOperatingConfig.mermaVarianceThresholdPct,
    })
    .from(tenantOperatingConfig)
    .where(eq(tenantOperatingConfig.companyId, companyId))
    .limit(1);

  return {
    vatRatePercent: fila?.vatRatePercent ?? null,
    laborBurdenFactorPercent: fila?.laborBurdenFactorPercent ?? null,
    payrollStateTaxPercent: fila?.payrollStateTaxPercent ?? null,
    mermaVarianceThresholdPct: fila?.mermaVarianceThresholdPct ?? null,
  };
}