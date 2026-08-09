'use client';

import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertCircle, AlertTriangle, XCircle, Loader2 } from 'lucide-react';

interface IncidentAlertProps {
    incident: {
        id: string;
        severity: 'CRITICAL' | 'HIGH' | 'WARNING' | 'FATAL';
        title: string;
        description?: string;
        status: 'DETECTED' | 'IN_REMEDIATION' | 'RESOLVED' | 'ESCALATED';
        remediationProtocol?: unknown;
    };
    onRemediate?: () => void | Promise<void>;
    onDismiss?: () => void | Promise<void>;
}

const SEVERITY_LABELS: Record<string, string> = {
    CRITICAL: 'Crítico',
    WARNING: 'Advertencia',
    HIGH: 'Alto',
    FATAL: 'Fatal',
};

const STATUS_LABELS: Record<string, string> = {
    DETECTED: 'Detectado',
    IN_REMEDIATION: 'En remediación',
    RESOLVED: 'Resuelto',
    ESCALATED: 'Escalado',
};

const severityConfig = {
    CRITICAL: {
        icon: XCircle,
        variant: 'destructive' as const,
    },
    WARNING: {
        icon: AlertTriangle,
        variant: 'default' as const,
    },
    FATAL: {
        icon: AlertCircle,
        variant: 'destructive' as const,
    },
};

const statusVariants: Record<string, string> = {
    DETECTED: 'bg-destructive/10 text-destructive border-destructive/20',
    IN_REMEDIATION: 'bg-warning/10 text-warning-foreground border-warning/20',
    RESOLVED: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
    ESCALATED: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20',
};

export function IncidentAlert({ incident, onRemediate, onDismiss }: IncidentAlertProps) {
    const config = severityConfig[incident.severity];
    const Icon = config.icon;

    const [isRemediating, setIsRemediating] = useState(false);
    const [isDismissing, setIsDismissing] = useState(false);
    const [showDismissConfirm, setShowDismissConfirm] = useState(false);

    const isBusy = isRemediating || isDismissing;

    const handleRemediate = async () => {
        if (!onRemediate) return;
        setIsRemediating(true);
        try {
            await onRemediate();
        } finally {
            setIsRemediating(false);
        }
    };

    const handleDismissConfirm = async () => {
        if (!onDismiss) return;
        setIsDismissing(true);
        try {
            await onDismiss();
            setShowDismissConfirm(false);
        } finally {
            setIsDismissing(false);
        }
    };

    return (
        <>
            <Alert variant={config.variant}>
                <Icon className="h-5 w-5" />
                <div className="flex items-start justify-between w-full">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                            <AlertTitle className="mb-0">{incident.title}</AlertTitle>
                            <Badge variant="outline" className={statusVariants[incident.status] || ''}>
                                {STATUS_LABELS[incident.status] || incident.status}
                            </Badge>
                            <Badge variant="outline">
                                {SEVERITY_LABELS[incident.severity] || incident.severity}
                            </Badge>
                        </div>
                        {incident.description && (
                            <AlertDescription className="mt-2 text-sm">
                                {incident.description}
                            </AlertDescription>
                        )}
                    </div>
                    <div className="flex gap-2 ml-4">
                        {incident.remediationProtocol && incident.status !== 'RESOLVED' && onRemediate && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleRemediate}
                                disabled={isBusy}
                            >
                                {isRemediating ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                        Iniciando…
                                    </>
                                ) : (
                                    'Iniciar remediación'
                                )}
                            </Button>
                        )}
                        {onDismiss && (
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setShowDismissConfirm(true)}
                                disabled={isBusy}
                            >
                                Descartar
                            </Button>
                        )}
                    </div>
                </div>
            </Alert>

            <AlertDialog open={showDismissConfirm} onOpenChange={setShowDismissConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Descartar este incidente?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Se descartará <strong>{incident.title}</strong> sin marcarlo como resuelto.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDismissing}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDismissConfirm}
                            disabled={isDismissing}
                        >
                            {isDismissing ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                    Descartando…
                                </>
                            ) : (
                                'Descartar'
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
