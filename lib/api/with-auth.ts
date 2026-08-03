import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { ApiError } from "./error";
import type { UserRole } from "@/lib/rbac/permissions";

/**
 * Session payload after successful authentication.
 * All fields guaranteed present (no `any` casts in consuming code).
 */
export interface AuthUser {
  id: string;
  role: UserRole;
  companyId: string | null;
  branchId: string | null;
  email: string;
  name?: string;
}

export interface TenantAuthContext {
  user: AuthUser;
  tenantId: string;
  branchId: string | null;
}

/**
 * Authenticate the current request and extract user + tenantId from the session.
 *
 * Rules (hard, must not be violated by any handler):
 * 1. tenantId ALWAYS comes from session (`user.companyId`), NEVER from query param or body.
 * 2. userId, approvedBy, escalatedBy, createdBy ALWAYS from session, NEVER from body.
 * 3. 403 if user has no companyId (unassigned).
 */
export async function requireTenantAuth(): Promise<TenantAuthContext> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    throw ApiError.unauthorized("No session found. Please sign in.");
  }

  const user = session.user as Record<string, unknown>;

  const authUser: AuthUser = {
    id: user.id as string,
    role: (user.role as UserRole) || "EMPLEADO",
    companyId: (user.companyId as string) || null,
    branchId: (user.branchId as string) || null,
    email: user.email as string,
    name: user.name as string | undefined,
  };

  if (!authUser.companyId) {
    throw ApiError.forbidden(
      "No company assigned to your account. Please complete onboarding."
    );
  }

  return {
    user: authUser,
    tenantId: authUser.companyId,
    branchId: authUser.branchId,
  };
}

/**
 * Authenticate the current request. Does NOT require a companyId.
 * Use for endpoints where the user may not have a company yet
 * (e.g., onboarding, company creation, profile).
 */
export async function requireAuth(): Promise<{ user: AuthUser }> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    throw ApiError.unauthorized("No session found. Please sign in.");
  }

  const user = session.user as Record<string, unknown>;

  return {
    user: {
      id: user.id as string,
      role: (user.role as UserRole) || "EMPLEADO",
      companyId: (user.companyId as string) || null,
      branchId: (user.branchId as string) || null,
      email: user.email as string,
      name: user.name as string | undefined,
    },
  };
}

/**
 * Authenticate AND check role membership.
 * Throws 403 if the user's role is not in the allowed list.
 */
export async function requireRoleAuth(
  allowedRoles: UserRole[]
): Promise<TenantAuthContext> {
  const ctx = await requireTenantAuth();

  if (!allowedRoles.includes(ctx.user.role)) {
    throw ApiError.forbidden(
      `Role '${ctx.user.role}' is not allowed. Required: ${allowedRoles.join(", ")}`
    );
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// Higher-order wrappers for the "throw ApiError" pattern (API routes)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiRouteHandler = (req: Request, ctx?: any) => Promise<Response>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthenticatedHandler = (req: Request, ctx: any & { auth: TenantAuthContext }) => Promise<Response>;

/**
 * Wrap an API route handler with tenant authentication.
 *
 * Usage:
 *   export const GET = withTenantAuth(async (req, { params, auth }) => {
 *     // auth.tenantId is guaranteed from session
 *     // auth.user.id is the authenticated user
 *     ...
 *   });
 *
 * The wrapper handles ApiError exceptions and returns proper JSON error responses.
 */
export function withTenantAuth(handler: AuthenticatedHandler): ApiRouteHandler {
  return async (req, ctx) => {
    try {
      const auth = await requireTenantAuth();
      return handler(req, { ...ctx, auth });
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json(
          { success: false, error: { message: error.message, details: error.details } },
          { status: error.statusCode }
        );
      }
      console.error("[withTenantAuth] Unhandled error:", error);
      return Response.json(
        { success: false, error: { message: "Internal Server Error" } },
        { status: 500 }
      );
    }
  };
}

/**
 * Wrap a handler with authentication + role check.
 */
export function withRoleAuth(
  allowedRoles: UserRole[],
  handler: AuthenticatedHandler
): ApiRouteHandler {
  return async (req, ctx) => {
    try {
      const auth = await requireRoleAuth(allowedRoles);
      return handler(req, { ...ctx, auth });
    } catch (error) {
      if (error instanceof ApiError) {
        return Response.json(
          { success: false, error: { message: error.message, details: error.details } },
          { status: error.statusCode }
        );
      }
      console.error("[withRoleAuth] Unhandled error:", error);
      return Response.json(
        { success: false, error: { message: "Internal Server Error" } },
        { status: 500 }
      );
    }
  };
}
