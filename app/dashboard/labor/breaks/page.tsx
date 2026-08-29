"use client";

import { BreakManagementDashboard } from '@/components/labor/break-management-dashboard';
import { ArrowLeft, Coffee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useRequireRole } from "@/hooks/use-session";

export default function LaborBreaksPage() {
    const { loading, session } = useRequireRole(['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR']);

    if (loading) {
        return null;
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Button variant="outline" size="icon" className="h-8 w-8" asChild>
                        <Link href="/dashboard/labor" title="Volver a Labor">
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                            <Coffee className="h-6 w-6 text-primary" />
                            Control de Descansos (NOM-035)
                        </h1>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Monitoreo en tiempo real de pausas laborales y cumplimiento de descansos según Art. 63 LFT
                        </p>
                    </div>
                </div>
            </div>

            {/* Main Live Dashboard */}
            <BreakManagementDashboard 
                companyId={session?.user?.companyId}
                userRole={session?.user?.role}
                userBranchId={session?.user?.branchId}
            />
        </div>
    );
}
