import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import {
  GroupExceptionsService,
  type ExceptionDomain,
} from "@/lib/services/group-exceptions-service";

const GROUP_EXCEPTIONS_READ_ROLES: ReadonlySet<Role> = new Set([
  "SUPER_ADMIN",
  "OWNER",
  "ADMIN",
  "GERENTE",
  "SUPERVISOR",
  "READONLY",
]);

const VALID_DOMAINS: ExceptionDomain[] = [
  "operacion",
  "cumplimiento",
  "equipos",
  "personal",
  "inventario",
  "finanzas",
];

/**
 * GET /api/group/exceptions?domain=&branchId=&limit=
 *
 * Feed unificado de excepciones abiertas (Nivel A — ver
 * lib/services/group-exceptions-service.ts) para las tarjetas de área de
 * `/dashboard` y la lista completa de `/dashboard/exceptions`.
 *
 * GERENTE/SUPERVISOR quedan acotados a su propia sucursal vía
 * `resolveBranchScope`, igual que el resto de la API — no pueden pedir el
 * feed de otra sucursal ni del grupo completo pasando `?branchId=`.
 */
export const GET = withTenantAuth(async (req, { auth }) => {
  if (!GROUP_EXCEPTIONS_READ_ROLES.has(auth.user.role as Role)) {
    return ApiHandler.error(
      ApiError.forbidden("No tienes permiso para consultar excepciones operativas."),
      403
    );
  }

  const { searchParams } = new URL(req.url);
  const requestedBranchId = searchParams.get("branchId");
  const domainParam = searchParams.get("domain");
  const categoryParam = searchParams.get("category");
  const limitParam = searchParams.get("limit");

  const scope = resolveBranchScope(auth.user.role, auth.user.branchId, requestedBranchId);

  if (scope.kind === "NONE") {
    return ApiHandler.success([]);
  }

  const domain =
    domainParam && VALID_DOMAINS.includes(domainParam as ExceptionDomain)
      ? (domainParam as ExceptionDomain)
      : undefined;

  const validCategories = ["DINERO", "INOCUIDAD", "ABASTO", "PERSONAL"];
  const qsrCategory = categoryParam && validCategories.includes(categoryParam.toUpperCase())
    ? (categoryParam.toUpperCase() as any)
    : undefined;

  const limit = limitParam ? Number(limitParam) : undefined;

  const exceptions = await GroupExceptionsService.listOpen(auth.tenantId, {
    branchId: scope.kind === "BRANCH" ? scope.branchId : undefined,
    domain,
    qsrCategory,
    limit: limit && Number.isFinite(limit) && limit > 0 ? limit : undefined,
  });

  return ApiHandler.success(exceptions);
});
