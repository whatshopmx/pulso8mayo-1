'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, AlertTriangle, XCircle } from 'lucide-react';

interface IncidentAlertProps {
    incident: {
        id: string;
        severity: 'CRITICAL' | 'WARNING' | 'FATAL';
        title: string;
        description?: string;
        status: 'DETECTED' | 'IN_REMEDIATION' | 'RESOLVED' | 'ESCALATED';
        remediationProtocol?: unknown;
    };
    onRemediate?: () => void;
    onDismiss?: () => void;
}

const SEVERITY_LABELS: Record<string, string> = {
    CRITICAL: 'Crítico',
    WARNING: 'Advertencia',
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

    return (
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
                        <Button size="sm" variant="outline" onClick={onRemediate}>
                            Iniciar remediación
                        </Button>
                    )}
                    {onDismiss && (
                        <Button size="sm" variant="ghost" onClick={onDismiss}>
                            Descartar
                        </Button>
                    )}
                </div>
            </div>
        </Alert>
    );
}