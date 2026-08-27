import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { enforceBranchScope } from '@/lib/branch-scope';
import { BRANCH_COOKIE_NAME } from '@/lib/branch-cookies';
import type { Role } from '@/lib/permissions';
import { BranchService } from '@/lib/services/branch-service';
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

  const cookieStore = await cookies();
  const requestedBranchId = cookieStore.get(BRANCH_COOKIE_NAME)?.value ?? null;
  const role = (session.user as { role?: Role }).role ?? "ADMIN";
  const branchId = enforceBranchScope(role, session.user.branchId, requestedBranchId);

  const branches = await BranchService.listBranches(session.user.companyId);

  if (branches.length === 0) {
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
            <h2 className="text-xl font-semibold mb-2">Sin Sucursales</h2>
            <p className="text-muted-foreground">
              Registra una sucursal en el sistema para comenzar a gestionar la producción.
            </p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const activeBranchId = branchId || branches[0].id;
  const activeBranch = branches.find(b => b.id === activeBranchId);

  return (
    <PageContainer>
      <PageHeader
        title="Producción"
        description="Planifica y registra producción batch cooking"
        icon={CookingPot}
        branchName={activeBranch?.name}
      />
      <ProductionClient
        branchId={activeBranchId}
        branches={branches}
      />
    </PageContainer>
  );
}

