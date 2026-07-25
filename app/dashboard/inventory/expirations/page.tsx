import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ExpirationReport } from '@/components/inventory/expiration-report';
import { PageHeader, PageContainer } from '@/components/shared';
import { Calendar } from 'lucide-react';

export default async function ExpirationsPage() {
  const session = await auth.api.getSession();

  if (!session?.user) {
    redirect('/sign-in');
  }

  return (
    <PageContainer>
      <PageHeader
        title="Reporte de Vencimientos"
        description="Monitoreo de productos próximos a vencer (FIFO)"
        icon={Calendar}
      />
      <ExpirationReport />
    </PageContainer>
  );
}
