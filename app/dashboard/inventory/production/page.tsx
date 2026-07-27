import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
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

  const branchId = session.user.branchId;

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
