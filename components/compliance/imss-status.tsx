'use client';

import Link from 'next/link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MetricCard, MetricGrid } from '@/components/ui/metric-card';
import { ErrorState } from '@/components/shared';
import { AlertTriangle, CheckCircle, Info, Users } from 'lucide-react';
import { useBranch } from '@/lib/branch-context';
import { imssQuery, imssReason, useImssResource, type ImssConfig, type ImssSummary } from './imss-client';

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

/**
 * Motivos de bloqueo con salida (T5).
 *
 * Hasta este plan, `SIN_REGISTRO_PATRONAL` era texto plano: la fila decía qué
 * faltaba y la persona no tenía forma de resolverlo desde ahí, porque el dato
 * sólo se capturaba dentro de una sucursal en `/dashboard/company`, pantalla
 * que `GERENTE`/`SUPERVISOR` no pueden abrir. Con permiso, el motivo lleva a
 * Configuración; sin permiso, dice a quién pedírselo en vez de ofrecer un
 * enlace que termina en 403.
 */
export function ImssBlockedReasons({ reasons, branchName, canConfigure }: {
    reasons: string[]; branchName?: string | null; canConfigure?: boolean;
}) {
    if (!reasons.length) return null;
    return <p className="max-w-xs text-xs text-destructive">
        {reasons.map((reason, index) => <span key={reason}>
            {index > 0 && ' · '}{imssReason(reason, { branchName })}
            {reason === 'SIN_REGISTRO_PATRONAL' && (canConfigure
                ? <> <Link className="font-medium underline underline-offset-2" href="/dashboard/compliance/imss/configuracion">Capturar registro</Link></>
                : <span className="text-muted-foreground"> Pide a un administrador que lo capture.</span>)}
        </span>)}
    </p>;
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

/** Configuración vigente: la comparten el arranque (T6) y la pantalla de T3. */
export function useImssConfig() {
    return useImssResource<ImssConfig>('/api/imss/config');
}

/**
 * Arranque honesto (T6): sin ninguna sucursal configurada no se listan N filas
 * bloqueadas —no hay deuda que mostrar, hay un dato que falta—. Se explica qué
 * capturar y se ofrece el camino, o se dice quién puede hacerlo.
 */
export function ImssConfigStartBanner({ config }: { config: ImssConfig }) {
    if (config.configuredCount > 0) return null;
    if (!config.branches.length) {
        return <Alert><Info className="h-4 w-4" /><AlertDescription>
            Aún no hay sucursales en esta empresa. Crea una en Organización → Sucursales y captura su registro patronal IMSS: sin ese dato no se puede armar un archivo.
        </AlertDescription></Alert>;
    }
    return <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
            Ninguna de tus {config.branches.length} {config.branches.length === 1 ? 'sucursal tiene' : 'sucursales tiene'} registro patronal IMSS capturado.
            Sin ese dato no se puede preparar un movimiento, así que no hay movimientos bloqueados que mostrar todavía.
        </span>
        {config.canConfigure
            ? <Button asChild size="sm" variant="outline"><Link href="/dashboard/compliance/imss/configuracion">Configurar registro patronal</Link></Button>
            : <span className="text-xs text-muted-foreground">Pide a un administrador que capture el registro patronal de tus sucursales.</span>}
    </AlertDescription></Alert>;
}

/** Versión autocontenida para el Resumen, donde nadie más pidió la configuración. */
export function ImssConfigBanner() {
    const config = useImssConfig();
    if (!config.data) return null;
    return <ImssConfigStartBanner config={config.data} />;
}
