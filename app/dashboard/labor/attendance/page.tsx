"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AttendanceDashboard } from "@/components/labor/attendance-dashboard";
import { useRequireRole } from "@/hooks/use-session";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

function AbsenceFocusBanner() {
    const searchParams = useSearchParams();
    const focusSessionId = searchParams.get("sessionId");

    if (!focusSessionId) return null;

    return (
        <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="text-xs font-semibold">Alerta de Ausencia / Retardo Detectada</AlertTitle>
            <AlertDescription className="text-xs mt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span>
                    Se ha detectado una incidencia en la sesión identificada como <code className="font-mono bg-destructive/20 px-1.5 py-0.5 rounded text-xs">{focusSessionId.slice(0, 8)}</code>.
                </span>
                <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                    <Link href={`/dashboard/labor/attendance`}>
                        Limpiar enfoque
                    </Link>
                </Button>
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
            <AttendanceDashboard />
        </div>
    );
}