import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import { WasteClient } from './waste-client';
import { PageHeader, PageContainer } from '@/components/shared';

export const metadata = {
  title: 'Registro de Mermas | Pulso',
};

interface Props {
  searchParams: Promise<{ item?: string }>;
}

export default async function WastePage({ searchParams }: Props) {
  const session = await getSession();
  const params = await searchParams;
  const preselectedItemId = params.item;

  if (!session?.user) {
    redirect('/login');
  }

  const branchId = session.user.branchId;

  if (!branchId) {
    return (
      <PageContainer>
        <PageHeader
          title="Registro de Mermas"
          description="Registra productos vencidos, dañados o con problemas de calidad"
          icon={AlertTriangle}
        />
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Selecciona una Sucursal</h2>
            <p className="text-muted-foreground">
              Necesitas estar en el contexto de una sucursal para registrar mermas.
            </p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Registro de Mermas"
        description="Registra productos vencidos, dañados o con problemas de calidad"
        icon={AlertTriangle}
      />
      <WasteClient branchId={branchId} preselectedItemId={preselectedItemId} />
    </PageContainer>
  );
}
