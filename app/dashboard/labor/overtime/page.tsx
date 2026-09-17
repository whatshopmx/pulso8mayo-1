"use client";

import { OvertimeDashboard } from "@/components/labor/overtime-dashboard"
import { useRequireRole } from "@/hooks/use-session"

export default function OvertimeReportsPage() {
    const { session, loading } = useRequireRole(['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR']);

    if (loading) {
        return null;
    }

    return (
        <div className="space-y-6">
            <OvertimeDashboard 
                branchId={session?.user?.branchId || undefined}
                userRole={session?.user?.role || undefined}
            />
        </div>
    )
}
