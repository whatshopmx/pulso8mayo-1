import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { hasPermission } from "@/lib/permissions";
import {
  getTenantOperatingConfig,
  upsertTenantOperatingConfig,
  type UpsertTenantOperatingConfigInput,
} from "@/lib/services/tenant-config-service";

/**
 * Configuración del modelo operativo del grupo (diseño §2) + umbrales.
 *
 * Esta ruta consumía `tenant-operating-config-service`, un segundo servicio
 * sobre la MISMA tabla que no invalidaba el caché. Como `tenant-config-service`
 * cachea las lecturas 5 minutos con `unstable_cache`, guardar desde el
 * formulario no refrescaba nada: los objetivos financieros que lee
 * `getFinancialTargets` seguían sirviendo el valor viejo hasta que expirara el
 * TTL. Se unificó en el servicio cacheado, que sí llama a `revalidateTag`.
 *
 * También se eliminó la ruta gemela `/api/tenant/operating-config`, que hacía
 * lo mismo y no tenía un solo llamador.
 */

const dimensionEnums = {
  purchasingStructure: z.enum(["CENTRALIZADA", "POR_SUCURSAL", "HIBRIDO"], { error: "Elige una estructura de compras." }),
  foodProduction: z.enum(["IN_SITU", "COCINA_CENTRAL", "MIXTO"], { error: "Elige un modelo de producción de alimentos." }),
  treasuryModel: z.enum(["CUENTA_UNICA", "CUENTA_POR_SUCURSAL", "MIXTO"], { error: "Elige un modelo de tesorería." }),
  supplierPayment: z.enum(["CENTRALIZADO", "POR_SUCURSAL", "HIBRIDO"], { error: "Elige una política de pago a proveedores." }),
  managerAutonomy: z.enum(["ALTA", "MEDIA", "BAJA"], { error: "Elige un nivel de autonomía del gerente." }),
  payrollDispersion: z.enum(["CONSOLIDADA", "POR_RAZON_SOCIAL", "MIXTO"], { error: "Elige una política de dispersión de nómina." }),
  tenantType: z.enum(["GRUPO_PROPIO", "MIXTO_FRANQUICIAS"], { error: "Elige un tipo de empresa." }),
} as const;

/**
 * Umbrales monetarios en centavos; `null` significa "sin tope".
 *
 * Los mensajes nombran la unidad porque el contrato habla de centavos y el
 * formulario de pesos: un entero Rechazado tiene que decir si se esperaba un
 * número entero de centavos, no "expected integer".
 */
const thresholdSchema = z
  .number({ error: "Escribe un monto o déjalo vacío para quitar el tope." })
  .int("El monto debe enviarse en centavos, sin decimales.")
  .min(0, "El monto no puede ser negativo.")
  .max(2147483647, "El monto no puede superar 2147483647 centavos.")
  .nullable();

/**
 * Porcentaje objetivo. Se recibe como número (el formulario captura "30.5") y
 * se persiste como `numeric(5,2)`, que Drizzle escribe desde string.
 */
const percentSchema = z
  .number({ error: "Escribe un porcentaje entre 0 y 100." })
  .min(0, "El porcentaje no puede ser negativo.")
  .max(100, "El porcentaje no puede ser mayor a 100.");

const updateConfigSchema = z
  .object({
    ...dimensionEnums,
    managerAuthLimitCents: thresholdSchema,
    doubleApprovalThresholdCents: thresholdSchema,
    pettyCashLimitCents: thresholdSchema,
    emergencyPurchaseCapCents: thresholdSchema,
    courtesyWasteMonthlyCapCents: thresholdSchema,
    foodCostTargetPercent: percentSchema,
    foodCostWarnPercent: percentSchema,
    laborCostTargetPercent: percentSchema,
    laborCostWarnPercent: percentSchema,
    healthyMarginTargetPercent: percentSchema,
    healthyMarginWarnPercent: percentSchema,
    mermaVarianceThresholdPct: percentSchema,
  })
  .partial()
  .superRefine((data, ctx) => {
    // Un semáforo cuyo umbral de precaución es más estricto que el objetivo no
    // tiene zona amarilla: saltaría de "saludable" a "crítico". Se rechaza en
    // vez de guardarse y producir lecturas imposibles en el dashboard.
    const costPairs = [
      ["foodCostTargetPercent", "foodCostWarnPercent", "food cost"],
      ["laborCostTargetPercent", "laborCostWarnPercent", "labor cost"],
    ] as const;

    for (const [targetKey, warnKey, label] of costPairs) {
      const target = data[targetKey];
      const warn = data[warnKey];
      if (target !== undefined && warn !== undefined && warn < target) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [warnKey],
          message: `El umbral de precaución de ${label} debe ser mayor o igual al objetivo (en costos, menor es mejor).`,
        });
      }
    }

    // El margen va al revés: mayor es mejor, así que el piso de precaución
    // debe quedar por DEBAJO del objetivo.
    const marginTarget = data.healthyMarginTargetPercent;
    const marginWarn = data.healthyMarginWarnPercent;
    if (marginTarget !== undefined && marginWarn !== undefined && marginWarn > marginTarget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["healthyMarginWarnPercent"],
        message:
          "El piso de precaución del margen debe ser menor o igual al objetivo (en margen, mayor es mejor).",
      });
    }
  });

/** Campos `numeric` que Drizzle persiste como string. */
const PERCENT_FIELDS = [
  "foodCostTargetPercent",
  "foodCostWarnPercent",
  "laborCostTargetPercent",
  "laborCostWarnPercent",
  "healthyMarginTargetPercent",
  "healthyMarginWarnPercent",
  "mermaVarianceThresholdPct",
] as const;

export async function GET() {
  try {
    const tenant = await requireTenant();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

    const config = await getTenantOperatingConfig(tenant.id);
    const courtesyWaste = await leerCourtesyWaste(tenant.id);

    return ApiHandler.success({
      ...config,
      courtesyWasteMonthlyCapCents: courtesyWaste,
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const { user } = await requireAuth();
    if (!tenant.id) {
      throw ApiError.badRequest("No hay una empresa seleccionada.");
    }

    if (!hasPermission(user.role, "settings", "update")) {
      throw ApiError.forbidden(
        "Solo un administrador u owner puede modificar la configuración del modelo operativo.",
      );
    }

    const body = await req.json();
    const data = updateConfigSchema.parse(body);

    if (Object.keys(data).length === 0) {
      throw ApiError.badRequest("No se enviaron campos para actualizar.");
    }

    // Al actualizar sólo un extremo, comprobar el par efectivo antes de escribir.
    const pairFields = PERCENT_FIELDS.filter((field) => field !== "mermaVarianceThresholdPct");
    if (pairFields.some((field) => data[field] !== undefined)) {
      const current = await getTenantOperatingConfig(tenant.id);
      const effective: Record<string, number> = {};
      for (const field of pairFields) {
        if (data[field] !== undefined) effective[field] = data[field];
        else if (current[field] !== null && current[field] !== undefined) effective[field] = Number(current[field]);
      }
      updateConfigSchema.parse(effective);
    }

    if (data.courtesyWasteMonthlyCapCents !== undefined) {
      await db
        .update(companies)
        .set({
          courtesyWasteMonthlyCapCents: data.courtesyWasteMonthlyCapCents,
          updatedAt: new Date(),
        })
        .where(eq(companies.id, tenant.id));
    }

    // Los porcentajes se separan del resto por nombre: viajan como número y la
    // columna es `numeric(5,2)`, que Drizzle escribe desde string. Se
    // destructuran en vez de borrarse de una copia para que el tipo de
    // `dimensions` refleje que ya no los contiene.
    const {
      foodCostTargetPercent,
      foodCostWarnPercent,
      laborCostTargetPercent,
      laborCostWarnPercent,
      healthyMarginTargetPercent,
      healthyMarginWarnPercent,
      mermaVarianceThresholdPct,
      courtesyWasteMonthlyCapCents: _c,
      ...dimensions
    } = data;

    const percents: UpsertTenantOperatingConfigInput = {};
    const incoming = {
      foodCostTargetPercent,
      foodCostWarnPercent,
      laborCostTargetPercent,
      laborCostWarnPercent,
      healthyMarginTargetPercent,
      healthyMarginWarnPercent,
      mermaVarianceThresholdPct,
    };
    for (const field of PERCENT_FIELDS) {
      const value = incoming[field];
      // Dos decimales fijos: evita que la columna reciba notación exponencial.
      if (value !== undefined) percents[field] = value.toFixed(2);
    }

    const updated = await upsertTenantOperatingConfig(tenant.id, {
      ...dimensions,
      ...percents,
    });
    // El tope de cortesías vive en `companies`, no en la fila de configuración:
    // se responde con lo que quedó, no con lo que pidió el formulario. Antes
    // devolvía `undefined` cuando se acababa de quitar el tope, que no es lo que
    // se guardó.
    const courtesyWaste =
      data.courtesyWasteMonthlyCapCents !== undefined
        ? data.courtesyWasteMonthlyCapCents
        : await leerCourtesyWaste(tenant.id);
    return ApiHandler.success({
      ...updated,
      courtesyWasteMonthlyCapCents: courtesyWaste,
    });
  } catch (error) {
    return ApiHandler.error(error);
  }
}

async function leerCourtesyWaste(companyId: string): Promise<number | null> {
  const [row] = await db
    .select({ courtesyWasteMonthlyCapCents: companies.courtesyWasteMonthlyCapCents })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row?.courtesyWasteMonthlyCapCents ?? null;
}
