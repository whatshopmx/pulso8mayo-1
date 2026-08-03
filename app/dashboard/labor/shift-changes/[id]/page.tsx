"use client";

import { useRequireRole } from "@/hooks/use-session"
import { ShiftChangeRequestList } from "@/components/labor/shift-change-request-list"
import { ArrowLeftRight } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function ShiftChangeRequestDetailPage({ params }: { params: { id: string } }) {
    const { loading } = useRequireRole(['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR']);

    if (loading) {
        return null;
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <ArrowLeftRight className="h-7 w-7" />
                        Cambio de Turno
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Revisa y responde a esta solicitud de cambio de turno
                    </p>
                </div>
                <Button variant="outline" asChild>
                    <Link href="/dashboard/labor/shift-changes">Ver todas</Link>
                </Button>
            </div>

            <ShiftChangeRequestList focusId={params.id} />
        </div>
    )
}