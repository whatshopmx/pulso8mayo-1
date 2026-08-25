import { NextRequest } from "next/server";
import { z } from "zod";
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
  purchasingStructure: z.enum(["CENTRALIZADA", "POR_SUCURSAL", "HIBRIDO"]),
  foodProduction: z.enum(["IN_SITU", "COCINA_CENTRAL", "MIXTO"]),
  treasuryModel: z.enum(["CUENTA_UNICA", "CUENTA_POR_SUCURSAL", "MIXTO"]),
  supplierPayment: z.enum(["CENTRALIZADO", "POR_SUCURSAL", "HIBRIDO"]),
  managerAutonomy: z.enum(["ALTA", "MEDIA", "BAJA"]),
  payrollDispersion: z.enum(["CONSOLIDADA", "POR_RAZON_SOCIAL", "MIXTO"]),
  tenantType: z.enum(["GRUPO_PROPIO", "MIXTO_FRANQUICIAS"]),
} as const;

/** Umbrales monetarios en centavos; `null` significa "sin tope". */
const thresholdSchema = z.number().int().min(0).nullable();

/**
 * Porcentaje objetivo. Se recibe como número (el formulario captura "30.5") y
 * se persiste como `numeric(5,2)`, que Drizzle escribe desde string.
 */
const percentSchema = z
  .number()
  .min(0, "El porcentaje no puede ser negativo.")
  .max(100, "El porcentaje no puede ser mayor a 100.");

const updateConfigSchema = z
  .object({
    ...dimensionEnums,
    managerAuthLimitCents: thresholdSchema,
    doubleApprovalThresholdCents: thresholdSchema,
    pettyCashLimitCents: thresholdSchema,
    emergencyPurchaseCapCents: thresholdSchema,
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
    return ApiHandler.success(config);
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
    return ApiHandler.success(updated);
  } catch (error) {
    return ApiHandler.error(error);
  }
}
