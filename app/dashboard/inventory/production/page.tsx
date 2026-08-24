import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { enforceBranchScope } from '@/lib/branch-scope';
import { BRANCH_COOKIE_NAME } from '@/lib/branch-cookies';
import type { Role } from '@/lib/permissions';
import { Card, CardContent } from '@/components/ui/card';
import { CookingPot } from 'lucide-react';
import { ProductionClient } from './production-client';
import { PageHeader, PageContainer } from '@/components/shared';

export const metadata = {
  title: 'Producción | Pulso',
};

export default async function ProductionPage() {
  const session = await getSession();

  if (!session?.user) {
    redirect("/sign-in");
  }

  // Misma resolución que waste/stock-count: GERENTE/SUPERVISOR quedan fijos a su
  // sucursal de sesión; para los demás manda el alcance del header (cookie).
  const cookieStore = await cookies();
  const requestedBranchId = cookieStore.get(BRANCH_COOKIE_NAME)?.value ?? null;
  const role = (session.user as { role?: Role }).role ?? "ADMIN";
  const branchId = enforceBranchScope(role, session.user.branchId, requestedBranchId);

  if (!branchId) {
    return (
      <PageContainer>
        <PageHeader
          title="Producción"
          description="Gestiona órdenes de producción y registro de batch cooking"
          icon={CookingPot}
        />
        <Card>
          <CardContent className="p-8 text-center">
            <CookingPot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Selecciona una Sucursal</h2>
            <p className="text-muted-foreground">
              Necesitas estar en el contexto de una sucursal para gestionar producción.
            </p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Producción"
        description="Planifica y registra producción batch cooking"
        icon={CookingPot}
      />
      <ProductionClient branchId={branchId} />
    </PageContainer>
  );
}
