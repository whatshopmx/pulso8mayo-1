import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ExpirationReport } from '@/components/inventory/expiration-report';
import { PageHeader, PageContainer } from '@/components/shared';
import { Calendar } from 'lucide-react';

export default async function ExpirationsPage() {
  const session = await getSession();

  if (!session?.user) {
    redirect('/sign-in');
  }

  return (
    <PageContainer>
      <PageHeader
        title="Reporte de Vencimientos"
        description="Monitoreo de productos próximos a vencer (FEFO: se usa primero lo que caduca primero)"
        icon={Calendar}
      />
      <ExpirationReport />
    </PageContainer>
  );
}
