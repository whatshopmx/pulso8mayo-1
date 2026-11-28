import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hasAccess, type UserRole } from "@/lib/rbac/permissions";
import { resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { ShiftChangeRequestList } from "@/components/labor/shift-change-request-list";
import { Button } from "@/components/ui/button";

export default async function ShiftChangeRequestDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const session = await getSession();
    if (!session?.user?.id) redirect("/sign-in");
    if (!session.user.companyId) redirect("/onboarding");

    const role = (session.user.role ?? "EMPLEADO") as UserRole;
    if (!hasAccess(role, "/dashboard/labor/shift-changes")) {
        redirect("/dashboard/unauthorized");
    }

    const scope = resolveBranchScope(role as Role, session.user.branchId ?? null, null);
    const conditions = [
        eq(users.companyId, session.user.companyId),
        isNull(users.deletedAt),
    ];
    if (scope.kind === "BRANCH") {
        conditions.push(eq(users.branchId, scope.branchId));
    }

    const teammates =
        scope.kind === "NONE"
            ? []
            : await db
                .select({
                    id: users.id,
                    name: users.name,
                    role: users.role,
                    image: users.image,
                })
                .from(users)
                .where(and(...conditions));

    const safeTeammates = teammates.map((u) => ({
        id: u.id,
        name: u.name ?? "Sin nombre",
        role: u.role,
        image: u.image ?? undefined,
    }));

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <ArrowLeftRight className="h-7 w-7" />
                        Cambio de Turno
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Revisa y responde a esta solicitud de cambio de turno
                    </p>
                </div>
                <Button variant="outline" asChild>
                    <Link href="/dashboard/labor/shift-changes">Ver todas</Link>
                </Button>
            </div>

            <ShiftChangeRequestList employees={safeTeammates} focusId={id} />
        </div>
    );
}