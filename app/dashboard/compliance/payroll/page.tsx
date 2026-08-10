'use client';

import { useEffect, useState } from 'react';
import { PayrollExport } from '@/components/compliance/payroll-export';
import { DollarSign } from 'lucide-react';
import { PageHeader } from '@/components/shared';

export default function PayrollPage() {
  const [companyId, setCompanyId] = useState<string>('');

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch('/api/me');
        if (res.ok) {
          const data = await res.json();
          setCompanyId(data.user?.companyId || '');
        }
      } catch (e) {
        console.error('Error fetching user:', e);
      }
    };
    fetchUser();
  }, []);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <PageHeader
        title="Exportación de Nómina"
        description="Genera archivos de exportación para tu sistema de nómina"
        icon={DollarSign}
      />

      {companyId ? (
        <PayrollExport companyId={companyId} />
      ) : (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      )}
    </div>
  );
}

