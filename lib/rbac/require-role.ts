import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api/error";
import type { UserRole } from "@/lib/rbac/permissions";

const MANAGEMENT_ROLES: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'];

/**
 * Server-component guard: redirects to sign-in if unauthenticated,
 * redirects to /dashboard/workflows if not management.
 */
export async function requireManagementRole() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/sign-in");
  }

  const userRole = ((session.user as any).role || 'EMPLEADO') as UserRole;

  if (!MANAGEMENT_ROLES.includes(userRole)) {
    redirect("/dashboard/workflows");
  }

  return { session, userRole };
}

/**
 * Server-component guard: redirects to sign-in if unauthenticated,
 * redirects to /dashboard/workflows if role not allowed.
 */
export async function requireRole(allowedRoles: UserRole[]) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/sign-in");
  }

  const userRole = ((session.user as any).role || 'EMPLEADO') as UserRole;

  if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
    redirect("/dashboard/workflows");
  }

  return { session, userRole };
}

// ---------------------------------------------------------------------------
// API-route guards (throw ApiError instead of redirect)
// ---------------------------------------------------------------------------

/**
 * API-route guard: throws 401/403 instead of redirecting.
 * Use in API route handlers when you need role-based access control.
 */
export async function requireRoleApi(allowedRoles: UserRole[]) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    throw ApiError.unauthorized();
  }

  const userRole = ((session.user as any).role || 'EMPLEADO') as UserRole;

  if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
    throw ApiError.forbidden(
      `Role '${userRole}' is not allowed. Required: ${allowedRoles.join(", ")}`
    );
  }

  return {
    session,
    userRole,
    user: session.user as { id: string; role: UserRole; companyId?: string | null; branchId?: string | null; email: string; name?: string },
  };
}

/**
 * API-route guard: throws 401 if not authenticated, 403 if not management.
 */
export async function requireManagementRoleApi() {
  return requireRoleApi(MANAGEMENT_ROLES);
}
