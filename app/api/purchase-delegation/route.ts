import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission, roleIsAtLeast } from "@/lib/permissions";
import { isApiError } from "@/lib/api/error";
import {
  reemplazarReglasDeDelegacion,
  resumenDeDelegacion,
  validarReglasDeDelegacion,
  type DelegationAction,
} from "@/lib/purchasing/delegation-policy";

/**
 * Controles de solicitud y emisión de compras (C16.2.1).
 *
 * Aquí sólo se configuran; C16.2.2 los aplica a los caminos de escritura.
 *
 * Mismas dos guardas que la matriz de C16.1 y por el mismo motivo: `settings`
 * `update` dice "puede cambiar la configuración" y `ADMIN+` dice "no lo hace un
 * gerente de sucursal". El `companyId` sale de la sesión y nunca del cuerpo, así
 * que una empresa no puede escribir reglas en nombre de otra.
 */

const ruleSchema = z.object({
  action: z.enum(["REQUEST", "EMIT"]),
  scope: z.enum(["COMPANY", "BRANCH", "CATEGORY"]),
  branchId: z.string().uuid().nullable().optional(),
  category: z.string().max(80).nullable().optional(),
  requiredRole: z.string().min(1),
  active: z.boolean().optional(),
});

const putSchema = z.object({
  action: z.enum(["REQUEST", "EMIT"]),
  rules: z.array(ruleSchema),
});

/**
 * ADMIN+ y permiso de configuración. Se comprueban los dos porque cubren cosas
 * distintas: el rol evita que un gerente con permisos amplios de inventario
 * cambie la política del grupo, y el permiso evita que un rol alto sin
 * delegación de configuración escriba aquí por inercia.
 */
async function exigirAdministradorDeConfiguracion() {
  const tenant = await requireTenant();
  const { user } = await requireAuth();

  if (!roleIsAtLeast(user.role, "ADMIN")) {
    return {
      rejected: NextResponse.json(
        { error: "Sólo ADMIN o rol superior puede consultar los controles de compras" },
        { status: 403 },
      ),
    } as const;
  }
  if (!hasPermission(user.role, "settings", "update")) {
    return {
      rejected: NextResponse.json(
        { error: "No tienes permiso para cambiar la configuración de compras" },
        { status: 403 },
      ),
    } as const;
  }
  return { companyId: tenant.id! } as const;
}

/** GET /api/purchase-delegation — controles de solicitud y emisión (ADMIN+). */
export async function GET() {
  try {
    const guard = await exigirAdministradorDeConfiguracion();
    if ("rejected" in guard) return guard.rejected;

    const resumen = await resumenDeDelegacion(guard.companyId);
    return NextResponse.json(resumen);
  } catch (error: unknown) {
    console.error("Failed to read purchase delegation controls", error);
    if (isApiError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

/**
 * PUT /api/purchase-delegation — reemplaza los controles de UNA acción.
 *
 * Por acción y no por empresa: las dos son independientes y un error de
 * cobertura en `EMIT` no debería borrar lo configurado en `REQUEST`. El borrado
 * y el insert son una transacción, así que un rechazo deja la acción anterior
 * intacta en vez de a medias.
 */
export async function PUT(req: NextRequest) {
  try {
    const guard = await exigirAdministradorDeConfiguracion();
    if ("rejected" in guard) return guard.rejected;

    const parsed = putSchema.parse(await req.json());

    const reglas = parsed.rules.map((r) => ({
      action: r.action as DelegationAction,
      scope: r.scope,
      branchId: r.branchId ?? null,
      category: r.category ?? null,
      requiredRole: r.requiredRole,
      active: r.active ?? true,
    }));

    const deOtraAccion = reglas.filter((r) => r.action !== parsed.action);
    if (deOtraAccion.length > 0) {
      return NextResponse.json(
        { error: "Todas las reglas deben ser de la acción que se está guardando" },
        { status: 400 },
      );
    }

    const validacion = await validarReglasDeDelegacion(guard.companyId, reglas);
    if (validacion.ok === false) {
      return NextResponse.json(
        { error: validacion.error, warnings: validacion.warnings },
        { status: 400 },
      );
    }

    await reemplazarReglasDeDelegacion(guard.companyId, parsed.action, reglas);
    const resumen = await resumenDeDelegacion(guard.companyId);
    return NextResponse.json({ ...resumen, warnings: validacion.warnings });
  } catch (error: unknown) {
    console.error("Failed to update purchase delegation controls", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Datos inválidos", details: error.issues },
        { status: 400 },
      );
    }
    if (isApiError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
