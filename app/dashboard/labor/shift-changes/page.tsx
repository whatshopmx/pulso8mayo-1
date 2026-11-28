import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hasAccess, type UserRole } from "@/lib/rbac/permissions";
import { resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { ShiftChangeRequestList } from "@/components/labor/shift-change-request-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeftRight, Info } from "lucide-react";

export default async function ShiftChangeRequestsPage() {
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
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Cambios de Turno</h1>
                <p className="text-muted-foreground mt-1">
                    Solicita y gestiona intercambios de turnos con tu equipo
                </p>
            </div>

            {/* Info Alert */}
            <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                    <strong>Cómo funciona:</strong> Solicita un intercambio de turno → Tu compañero acepta o rechaza →
                    Un supervisor aprueba el cambio → Los turnos se intercambian automáticamente
                </AlertDescription>
            </Alert>

            {/* Info Cards */}
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ArrowLeftRight className="h-5 w-5" />
                            Para Empleados
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm text-muted-foreground">
                        <p>
                            <strong className="text-foreground">1.</strong> Selecciona el turno que quieres intercambiar
                        </p>
                        <p>
                            <strong className="text-foreground">2.</strong> Elige un compañero y su turno (opcional)
                        </p>
                        <p>
                            <strong className="text-foreground">3.</strong> Explica la razón del cambio
                        </p>
                        <p>
                            <strong className="text-foreground">4.</strong> Espera la respuesta del compañero y aprobación del supervisor
                        </p>
                    </CardContent>
                </Card>

                {role !== "EMPLEADO" && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Info className="h-5 w-5" />
                                Para Supervisores
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm text-muted-foreground">
                            <p>
                                <strong className="text-foreground">1.</strong> Revisa las solicitudes pendientes de aprobación
                            </p>
                            <p>
                                <strong className="text-foreground">2.</strong> Verifica que ambos empleados estén de acuerdo
                            </p>
                            <p>
                                <strong className="text-foreground">3.</strong> Aprueba o rechaza según convenga
                            </p>
                            <p>
                                <strong className="text-foreground">4.</strong> El sistema actualiza los turnos automáticamente
                            </p>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Shift Change Request List */}
            <ShiftChangeRequestList employees={safeTeammates} />
        </div>
    );
}
