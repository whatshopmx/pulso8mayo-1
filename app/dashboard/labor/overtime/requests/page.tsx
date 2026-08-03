import { OvertimeRequestsClient } from './overtime-requests-client';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { requireManagementRole } from '@/lib/rbac/require-role';

export default async function OvertimeRequestsPage() {
  const { session } = await requireManagementRole();

    return (
        <div className="container mx-auto py-8">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="sm" asChild>
                        <Link href="/dashboard/labor">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Volver a Labor
                        </Link>
                    </Button>
                    <div>
                        <h1 className="text-3xl font-bold">Solicitudes de Horas Extras</h1>
                        <p className="text-muted-foreground mt-1">
                            Gestión y aprobación de horas extras
                        </p>
                    </div>
                </div>
            </div>

            <OvertimeRequestsClient
                branchId={session.user.branchId || undefined}
                userRole={session.user.role}
            />
        </div>
    );
}
