"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AttendanceDashboard } from "@/components/labor/attendance-dashboard"
import { useRequireRole } from "@/hooks/use-session";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

function AbsenceFocusBanner() {
    const searchParams = useSearchParams();
    const focusSessionId = searchParams.get("sessionId");

    if (!focusSessionId) return null;

    return (
        <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
                Llegaste desde una alerta de ausencia (sesión {focusSessionId.slice(0, 8)}…).
                Revisa el registro correspondiente en el dashboard de asistencia.
            </AlertDescription>
        </Alert>
    );
}

export default function AttendanceReportsPage() {
    const { loading } = useRequireRole(['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR']);

    if (loading) {
        return null;
    }

    return (
        <div className="space-y-6">
            <Suspense fallback={null}>
                <AbsenceFocusBanner />
            </Suspense>
            <AttendanceDashboard initialData={{ data: [], summary: {
                totalRecords: 0,
                totalWorkMinutes: 0,
                totalBreakMinutes: 0,
                totalOvertimeMinutes: 0,
                completedShifts: 0,
                activeShifts: 0,
                uniqueEmployees: 0
            } }} />
        </div>
    )
}