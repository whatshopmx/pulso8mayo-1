import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import { ApiError } from "./api/error";
import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./db/schema";
import type { Role } from "./permissions";

export const TENANT_HEADER = "x-pulso-tenant-id";
export const BRANCH_COOKIE_NAME = "pulso_selected_branch";

export async function getCurrentTenant() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    throw ApiError.unauthorized();
  }

  // Try to get selected branch from cookie first (user's active selection)
  const cookieStore = await cookies();
  const selectedBranchId = cookieStore.get(BRANCH_COOKIE_NAME)?.value;

  // First, try to get tenant from header (for explicit tenant selection in the future)
  const headerTenantId = (await headers()).get(TENANT_HEADER);

  if (headerTenantId) {
    // Verify the user belongs to the requested tenant before accepting the header.
    // Until multi-tenant membership exists, the header must match the session's companyId.
    if (headerTenantId !== session.user.companyId) {
      throw ApiError.forbidden("You do not have access to the requested tenant.");
    }
    return {
      id: headerTenantId,
      userId: session.user.id,
      branchId: selectedBranchId || (session.user as any).branchId || null
    };
  }

  // Fall back to user's default company
  const user = session.user;
  if (user.companyId) {
    return {
      id: user.companyId,
      userId: session.user.id,
      // Prioritize cookie selection, then user's assigned branch
      branchId: selectedBranchId || (user as any).branchId || null
    };
  }

  // No tenant available
  return {
    id: null,
    userId: session.user.id,
    unassigned: true,
    branchId: null
  };
}

export async function requireTenant() {
  const tenant = await getCurrentTenant();
  if (!tenant?.id && !tenant?.unassigned) {
    throw ApiError.badRequest("Tenant header or selection is missing.");
  }
  return tenant;
}

/**
 * Get authenticated user with role information
 * Throws if not authenticated
 */
export async function requireAuth() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    throw ApiError.unauthorized();
  }

  return {
    user: session.user as { id: string; role: Role; companyId?: string | null; branchId?: string | null; email: string; name?: string },
    session: session.session,
  };
}
