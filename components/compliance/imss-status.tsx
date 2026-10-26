'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { MetricCard, MetricGrid } from '@/components/ui/metric-card';
import { ErrorState } from '@/components/shared';
import { AlertTriangle, CheckCircle, Info, Users } from 'lucide-react';
import { useBranch } from '@/lib/branch-context';
import { imssQuery, useImssResource, type ImssSummary } from './imss-client';

export function ImssNotice() {
    return <Alert><Info className="h-4 w-4" /><AlertDescription>Layout no validado contra el portal IMSS; úsese como archivo de trabajo. La confirmación se registra con el acuse.</AlertDescription></Alert>;
}
export function ImssLoading() {
    return <div role="status" aria-label="Cargando IMSS" className="space-y-3 py-4">{[0, 1, 2].map(row => <div key={row} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>;
}
export function ImssStateBadge({ status }: { status: string }) {
    const text = ({ SIN_ALTA: 'Sin alta', SIN_BAJA: 'Sin baja', PENDIENTE: 'Sin confirmación', EN_ARCHIVO: 'En archivo', CONFIRMADO: 'Confirmada', RECHAZADO: 'Rechazada' } as Record<string, string>)[status] || status;
    return <Badge variant={status === 'RECHAZADO' ? 'destructive' : status === 'CONFIRMADO' ? 'default' : 'secondary'}>{text}</Badge>;
}
export function ImssSummaryCards({ branchId }: { branchId?: string | null }) {
    const { selectedBranchId } = useBranch();
    const scope = branchId === undefined ? selectedBranchId : branchId;
    const resource = useImssResource<{ stats: ImssSummary }>(`/api/imss/summary${imssQuery(scope)}`);
    if (resource.loading) return <ImssLoading />;
    if (resource.error) return <ErrorState message={resource.error} onRetry={resource.refresh} />;
    if (!resource.data) return null;
    return <ImssSummaryMetrics stats={resource.data.stats} />;
}
export function ImssSummaryMetrics({ stats }: { stats: ImssSummary }) {
    return <MetricGrid columns={4}>
        <MetricCard label="Plantilla activa" value={stats.totalEmployees} icon={<Users className="h-4 w-4" />} subtitle="Empleados que requieren alta" />
        <MetricCard label="Altas pendientes" value={stats.pendingAltas} icon={<AlertTriangle className="h-4 w-4" />} tone={stats.pendingAltas ? 'warning' : 'neutral'} subtitle={`${stats.overdueAltas} con plazo vencido`} />
        <MetricCard label="Bajas pendientes" value={stats.pendingBajas} icon={<AlertTriangle className="h-4 w-4" />} tone={stats.pendingBajas ? 'warning' : 'neutral'} subtitle={`${stats.overdueBajas} con plazo vencido`} />
        <MetricCard label="Movimientos confirmados" value={stats.complianceRate === null ? '—' : `${stats.complianceRate}%`} icon={<CheckCircle className="h-4 w-4" />} tone={stats.complianceRate === 100 ? 'success' : 'neutral'} subtitle={`${stats.confirmedMovements} de ${stats.requiredMovements} movimientos requeridos`} />
    </MetricGrid>;
}
