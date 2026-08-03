'use client';

import { useState } from 'react';
import { OvertimeRequestForm } from '@/components/labor/overtime-request-form';
import { OvertimeApprovalList } from '@/components/labor/overtime-approval-list';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus } from 'lucide-react';

interface OvertimeRequestsClientProps {
    branchId?: string;
    userRole?: string;
}

/**
 * Client island for the overtime requests page. A new request must surface in
 * the pending list without a full page reload: bumping `listKey` remounts the
 * list, which refetches on mount. (Replaces a `window.location.reload()`
 * callback that was being passed from a Server Component — which cannot
 * serialize function props to client components at all.)
 */
export function OvertimeRequestsClient({ branchId, userRole }: OvertimeRequestsClientProps) {
    const [listKey, setListKey] = useState(0);

    return (
        <div className="grid gap-6 md:grid-cols-2">
            {/* Request Form */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Nueva Solicitud</CardTitle>
                            <CardDescription>
                                Solicita horas extras para aprobación
                            </CardDescription>
                        </div>
                        <Plus className="h-5 w-5 text-muted-foreground" />
                    </div>
                </CardHeader>
                <CardContent>
                    <OvertimeRequestForm
                        branchId={branchId || ''}
                        onSuccess={() => setListKey((k) => k + 1)}
                    />
                </CardContent>
            </Card>

            {/* Pending Requests */}
            <Card>
                <CardHeader>
                    <CardTitle>Solicitudes Pendientes</CardTitle>
                    <CardDescription>
                        Revisa y aprueba solicitudes de horas extras
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <OvertimeApprovalList
                        key={listKey}
                        branchId={branchId}
                        userRole={userRole}
                    />
                </CardContent>
            </Card>
        </div>
    );
}
