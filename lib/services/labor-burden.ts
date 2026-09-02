/**
 * A3.3 — Carga patronal como factor configurable, no como cálculo de IMSS.
 *
 * `labor-cost-service` mide nómina **bruta**: salarios y horas trabajadas. El
 * objetivo contra el que la compara el semáforo (`laborCostTargetPercent`,
 * default `28.00`) es un número de industria que ya viene *cargado* — incluye
 * IMSS, INFONAVIT, provisiones de aguinaldo y vacaciones, y el impuesto estatal
 * sobre nóminas. La comparación estaba torcida desde el default: un 22% bruto
 * que cargado ronda el 29% se pintaba verde, y nómina es precisamente el renglón
 * que un QSR ajusta cada semana con la programación de turnos.
 *
 * **Esto no calcula IMSS.** Calcular SBC, aplicar los topes en UMA y repartir
 * por ramas de seguro es un módulo entero con su propio mantenimiento legal. Un
 * factor por inquilino más el ISN de su estado pone la cifra en el mismo orden
 * de magnitud que el objetivo contra el que se compara, y se declara `DERIVED`
 * para que nadie lo confunda con una liquidación.
 *
 * Los dos porcentajes son `null` por default y `null` significa **no estimar**:
 * el KPI se rotula "bruto" y el semáforo no pinta color, porque comparar un
 * bruto contra un objetivo cargado no dice nada útil. El ISN va en su propia
 * línea y no dentro del factor porque es estatal —Nuevo León 3%, CDMX 4%,
 * Jalisco 2%— y un grupo con sucursales en dos estados no tiene una sola tasa.
 */
import { db } from "@/lib/db";
import { tenantOperatingConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface LaborBurden {
  /** Carga patronal capturada por el grupo, en %. `null` = no configurada. */
  factorPercent: number | null;
  /** ISN estatal capturado, en %. `null` = no configurado. */
  stateTaxPercent: number | null;
  /**
   * Suma que se aplica sobre el bruto. `null` cuando no hay ninguno de los dos:
   * es la señal de "no estimes nada", distinta de un 0% capturado a propósito.
   */
  totalPercent: number | null;
  /** Frase para la nota del renglón. Siempre dice si el número es bruto o cargado. */
  nota: string;
}

/** Lee el factor de carga patronal del inquilino. */
export async function getLaborBurden(companyId: string): Promise<LaborBurden> {
  const [row] = await db
    .select({
      factor: tenantOperatingConfig.laborBurdenFactorPercent,
      stateTax: tenantOperatingConfig.payrollStateTaxPercent,
    })
    .from(tenantOperatingConfig)
    .where(eq(tenantOperatingConfig.companyId, companyId))
    .limit(1);

  return buildLaborBurden(toPct(row?.factor), toPct(row?.stateTax));
}

/** Parte pura, para poder probarla y para reusarla desde un config ya leído. */
export function buildLaborBurden(
  factorPercent: number | null,
  stateTaxPercent: number | null,
): LaborBurden {
  if (factorPercent === null && stateTaxPercent === null) {
    return {
      factorPercent: null,
      stateTaxPercent: null,
      totalPercent: null,
      nota:
        "Cifra BRUTA: sólo sueldos y horas. No incluye IMSS, INFONAVIT, provisiones ni ISN, " +
        "así que no es comparable contra un objetivo de industria —que sí los trae. " +
        "Captura el factor de carga patronal del grupo para que el semáforo signifique algo.",
    };
  }

  const total = (factorPercent ?? 0) + (stateTaxPercent ?? 0);
  const partes: string[] = [];
  if (factorPercent !== null) partes.push(`${factorPercent}% de carga patronal`);
  if (stateTaxPercent !== null) partes.push(`${stateTaxPercent}% de ISN estatal`);

  return {
    factorPercent,
    stateTaxPercent,
    totalPercent: total,
    nota:
      `Cifra CARGADA: al bruto se le aplica ${partes.join(" más ")} configurado para el grupo. ` +
      "Es un factor declarado, no un cálculo de IMSS: no considera SBC, topes en UMA ni ramas de seguro.",
  };
}

function toPct(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
