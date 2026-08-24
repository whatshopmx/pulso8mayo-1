import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { enforceBranchScope } from '@/lib/branch-scope';
import { BRANCH_COOKIE_NAME } from '@/lib/branch-cookies';
import type { Role } from '@/lib/permissions';
import { Card, CardContent } from '@/components/ui/card';
import { BarChart3 } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/shared';
import { OperationalReportsClient } from './operational-reports-client';

export const metadata = {
    title: 'Reportes Operativos de Inventario | Pulso',
};

/**
 * Reportes operativos: uso, COGS, nivel par, valorización y mermas.
 * Misma resolución de sucursal que el resto del módulo de inventario:
 * GERENTE/SUPERVISOR quedan fijos a su sucursal de sesión; los roles
 * corporativos usan la cookie del header.
 */
export default async function OperationalReportsPage() {
    const session = await getSession();
    if (!session?.user) {
        redirect("/sign-in");
    }

    const cookieStore = await cookies();
    const requestedBranchId = cookieStore.get(BRANCH_COOKIE_NAME)?.value ?? null;
    const role = (session.user as { role?: Role }).role ?? "ADMIN";
    const branchId = enforceBranchScope(role, session.user.branchId, requestedBranchId);

    if (!branchId) {
        return (
            <PageContainer>
                <PageHeader
                    title="Reportes Operativos"
                    description="Uso, COGS, niveles par, valorización y mermas de tu inventario"
                    icon={BarChart3}
                />
                <Card>
                    <CardContent className="p-8 text-center">
                        <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <h2 className="text-xl font-semibold mb-2">Selecciona una Sucursal</h2>
                        <p className="text-muted-foreground">
                            Los reportes operativos se calculan por sucursal. Elige una en el selector del encabezado.
                        </p>
                    </CardContent>
                </Card>
            </PageContainer>
        );
    }

    return (
        <PageContainer>
            <PageHeader
                title="Reportes Operativos"
                description="Uso, COGS, niveles par, valorización y mermas de tu inventario"
                icon={BarChart3}
            />
            <div className="mt-6">
                <OperationalReportsClient branchId={branchId} />
            </div>
        </PageContainer>
    );
}
