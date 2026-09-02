// app/api/finance/treasury/runs/[id]/layout/route.ts
import { NextRequest } from "next/server";
import { requireRoleApi } from "@/lib/rbac/require-role";
import type { UserRole } from "@/lib/rbac/permissions";
import { ApiHandler } from "@/lib/api/response";
import { ApiError, isApiError } from "@/lib/api/error";
import { logDataAccess } from "@/lib/security/audit";
import { TreasuryService, type BankLayoutFormat } from "@/lib/services/treasury-service";

/**
 * GET /api/finance/treasury/runs/[id]/layout
 *
 * Genera el archivo de dispersión bancaria de una corrida de pago.
 *
 * **Generar este archivo es una operación de tesorería, no la lectura de un
 * reporte (AD4).** Antes se autorizaba con `requirePermissionApi("reports",
 * "read")` —un permiso que GERENTE tiene— y el archivo llevaba la CLABE
 * enmascarada, así que era inservible y a nadie le importaba quién lo bajara.
 * Desde A2.3 lleva las CLABEs de 18 dígitos **en claro** de todos los
 * proveedores del grupo: la misma respuesta que era un archivo inútil pasa a
 * ser una fuga de datos bancarios si la autorización no cambia con ella.
 *
 * Por eso van tres cosas juntas, y en este orden:
 *   1. Rol de gate (SUPER_ADMIN / OWNER / ADMIN). Un GERENTE recibe 403.
 *   2. Corrida en `APPROVED` o posterior — lo aplica el servicio: no se genera
 *      archivo de dispersión de una corrida que nadie firmó.
 *   3. Registro en `data_access_logs` con el id de la corrida, para que quede
 *      quién bajó las cuentas bancarias del grupo y cuándo.
 *
 * El registro se escribe **después** de generar y sólo si se generó: lo que se
 * audita es la entrega de las CLABEs, no la intención de pedirlas.
 */

/**
 * Los tres roles que pueden mover dinero de la empresa.
 *
 * Va por `unknown` por la trampa de nombres duplicados que documenta CLAUDE.md:
 * el enum de la base (`roleEnum`, `lib/db/schema/auth.ts`) incluye `OWNER`,
 * pero el tipo `UserRole` de `lib/rbac/permissions.ts` no lo lista. La
 * comparación de `requireRoleApi` es sobre cadenas en tiempo de ejecución, así
 * que un usuario `OWNER` sí pasa; lo que falta es el valor en el tipo. Quitar
 * `OWNER` de aquí dejaría fuera al dueño de su propio archivo de dispersión —
 * es el mismo trío que ya exige la ruta de estado de la corrida.
 */
const ROLES_TESORERIA = ["SUPER_ADMIN", "OWNER", "ADMIN"] as unknown as UserRole[];

/**
 * Un solo formato (A2.6, decisión D3). Los de Banorte y BBVA se quitaron porque
 * estaban inventados; ver la nota en `BankLayoutFormat`. Un `format=BANORTE_TXT`
 * recibe 400 con la lista de los válidos en vez de un archivo que el banco no
 * acepta.
 */
const FORMATOS: BankLayoutFormat[] = ["SPEI_CSV"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: paymentRunId } = await params;

    const { searchParams } = new URL(req.url);
    const pedido = searchParams.get("format") || "SPEI_CSV";
    if (!FORMATOS.includes(pedido as BankLayoutFormat)) {
      throw ApiError.badRequest(
        `Formato de layout desconocido: "${pedido}". Los disponibles son ${FORMATOS.join(", ")}.`
      );
    }
    const format = pedido as BankLayoutFormat;

    // `requireRoleApi` *lanza* (la variante que redirige es para server
    // components). El rol sale de la sesión, nunca del query.
    const { user } = await requireRoleApi(ROLES_TESORERIA);

    if (!user.companyId) {
      throw ApiError.forbidden("No hay una empresa asignada a tu usuario.");
    }

    const layout = await TreasuryService.generateBankDisbursementLayout(
      paymentRunId,
      user.companyId,
      format
    );

    // EXPORT y no READ: lo que sale de aquí es un archivo con datos bancarios
    // en claro, y la diferencia importa cuando alguien audite la bitácora.
    await logDataAccess({
      userId: user.id,
      companyId: user.companyId,
      branchId: user.branchId ?? null,
      action: "EXPORT",
      resource: "payment_runs.bank_layout",
      resourceId: paymentRunId,
      decision: {
        allowed: true,
        reason: `layout ${format}: ${layout.recordCount} transferencias, ${layout.excludedCount} partidas excluidas`,
      },
      req,
    });

    return ApiHandler.success(layout);
  } catch (error) {
    if (isApiError(error)) return ApiHandler.error(error);
    return ApiHandler.error(error);
  }
}
