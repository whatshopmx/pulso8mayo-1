"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { BRANCH_COOKIE_NAME } from "@/lib/tenant-context";
import { resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";

export async function switchBranch(branchId: string) {
  const session = await auth.api.getSession({
    headers: await headers()
  });

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const userRole = (session.user as any).role as Role;
  const userBranchId = ((session.user as any).branchId as string | undefined) ?? null;

  // El guard anterior era `if (userBranchId && branchId !== userBranchId)`, así
  // que con `userBranchId` nulo cortaba en el primer operando y se saltaba
  // entero: un GERENTE sin sucursal asignada pasaba derecho y, cuatro líneas más
  // abajo, esta misma acción le ESCRIBE `users.branchId`. O sea, se auto-asignaba
  // la sucursal que quisiera del grupo. `resolveBranchScope` separa ese caso.
  const scope = resolveBranchScope(userRole, userBranchId, branchId);

  if (scope.kind === "NONE") {
    throw new Error(
      "Tu usuario no tiene una sucursal asignada. Pídele a un administrador que te asigne una."
    );
  }

  if (scope.kind === "BRANCH" && scope.branchId !== branchId) {
    throw new Error("Access denied: you can only access your assigned branch");
  }

  const branch = await db.query.branches.findFirst({
    where: (branches, { eq, and }) => and(
      eq(branches.id, branchId),
      eq(branches.companyId, session.user.companyId!)
    )
  });

  if (!branch) {
    throw new Error("Branch not found or access denied");
  }

  // Update user's current branch in DB
  await db.update(users)
  .set({ branchId: branchId })
  .where(eq(users.id, session.user.id));

  // Set cookie for the selected branch (used for filtering data)
  const cookieStore = await cookies();
  cookieStore.set(BRANCH_COOKIE_NAME, branchId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  });

  // Revalidate dashboard to reflect changes
  revalidatePath("/dashboard");

  return { success: true };
}
