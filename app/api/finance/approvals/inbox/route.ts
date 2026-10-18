import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { resolveBranchScope } from "@/lib/branch-scope";
import { listUnifiedApprovalInbox } from "@/lib/services/unified-approval-inbox-service";

/**
 * GET /api/finance/approvals/inbox — bandeja unificada de aprobaciones.
 *
 * Fusiona las tres fuentes de aprobación de dinero OC/OS, gastos operativos y
 * corridas de pago con doble firma aplicando, por fuente, las mismas reglas de
 * elegibilidad que su API de acción. Es solo lectura: aprobar sigue ocurriendo
 * en la pantalla/API de cada flujo; esta bandeja contesta "qué puedo resolver
 * hoy" y enlaza al lugar de resolución.
 */
export const GET = withRoleAuth(
  ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"],
  async (_req, { auth }) => {
    // Alcance de sesión, nunca del query: un GERENTE fijado a una sucursal
    // ve su bandeja y nada más (el `NONE` de un rol acotado sin sucursal
    // devuelve lista vacía, no el libro del grupo).
    const scope = resolveBranchScope(auth.user.role as never, auth.branchId);

    if (scope.kind === "NONE") {
      return ApiHandler.success({ items: [], total: 0 });
    }

    const items = await listUnifiedApprovalInbox({
      companyId: auth.tenantId,
      actorId: auth.user.id,
      actorRole: auth.user.role,
      scope,
    });

    return ApiHandler.success({ items, total: items.length });
  }
);
