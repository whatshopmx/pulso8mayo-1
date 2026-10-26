'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileDown, RefreshCw, UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader, ErrorState } from '@/components/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard, MetricGrid } from '@/components/ui/metric-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useBranch } from '@/lib/branch-context';
import { todayInMx } from '@/lib/services/compliance/imss-rules';
import { ImssSubNav } from './imss-sub-nav';
import { ImssAdoptionDialog } from './imss-adoption-dialog';
import { ImssLoading, ImssNotice, ImssStateBadge } from './imss-status';
import { generateImssFile, imssDate, imssQuery, imssReason, imssTerminationReason, useImssResource, type ImssListSummary, type ImssMovementRow } from './imss-client';

interface MovementList { altas?: ImssMovementRow[]; bajas?: ImssMovementRow[]; summary: ImssListSummary; branches: { id: string; name: string }[]; permissions: { canAdopt: boolean } }
export function ImssMovementsPage({ type }: { type: 'ALTA' | 'BAJA' }) {
    const { selectedBranchId } = useBranch();
    const resource = useImssResource<MovementList>(`/api/imss/${type === 'ALTA' ? 'altas' : 'bajas'}${imssQuery(selectedBranchId)}`);
    return <div className="space-y-6"><PageHeader title={type === 'ALTA' ? 'Altas IMSS' : 'Bajas IMSS'} description="Prepara movimientos y confirma su estado con el acuse. Plazo de aviso: cinco días hábiles." icon={type === 'ALTA' ? UserPlus : UserMinus} /><ImssSubNav /><ImssNotice />
        {type === 'BAJA' && <Alert><AlertDescription>Revisa el finiquito o liquidación final con la fecha de baja capturada para cada persona.</AlertDescription></Alert>}
        {resource.loading ? <ImssLoading /> : resource.error ? <ErrorState message={resource.error} onRetry={resource.refresh} /> : resource.data ? <MovementTable key={`${type}-${selectedBranchId || 'all'}`} type={type} data={resource.data} refresh={resource.refresh} /> : null}
    </div>;
}
function MovementTable({ type, data, refresh }: { type: 'ALTA' | 'BAJA'; data: MovementList; refresh: () => void }) {
    const [ids, setIds] = useState<Set<string>>(new Set());
    const [showConfirmed, setShowConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const rows = data.altas || data.bajas || [];
    const visible = rows.filter(row => showConfirmed || row.imssStatus !== 'CONFIRMADO');
    const ready = rows.filter(row => row.status === 'READY');
    async function generate() {
        setBusy(true); setError(null);
        try {
            const result = await generateImssFile({ employeeIds: [...ids], movementType: type, layout: 'IDSE', fechaMovimiento: todayInMx().toISOString().slice(0, 10) });
            toast.success(`${result.included} movimientos en archivo${result.excluded ? `; ${result.excluded} excluidos` : ''}`);
            if (!result.saved) toast.info('Guarda esta descarga: el historial conservará los datos del archivo, sin una copia descargable.');
            setIds(new Set()); refresh();
        } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo generar el archivo'); }
        finally { setBusy(false); }
    }
    return <>
        <MetricGrid columns={4}><MetricCard label="Listos" value={data.summary.ready} subtitle={`${data.summary.overdue} movimientos con plazo vencido`} /><MetricCard label="Datos por completar" value={data.summary.blocked} /><MetricCard label="En archivo" value={data.summary.inFile} /><MetricCard label="Confirmados" value={data.summary.registered} /></MetricGrid>
        {type === 'ALTA' && data.permissions.canAdopt && <Alert><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><p>Si tu plantilla ya estaba registrada antes de Pulso, incorpora esas altas con evidencia y vista previa.</p><ImssAdoptionDialog rows={rows} branches={data.branches} onAdopted={refresh} /></AlertDescription></Alert>}
        <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><Checkbox checked={showConfirmed} onCheckedChange={checked => setShowConfirmed(checked === true)} />Mostrar confirmados</label><Button variant="outline" onClick={refresh} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" />Actualizar</Button></div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Card><CardHeader><CardTitle>{type === 'ALTA' ? 'Altas por preparar y confirmar' : 'Bajas por preparar y confirmar'}</CardTitle><CardDescription>Los movimientos vencidos con datos completos siguen siendo seleccionables.</CardDescription></CardHeader><CardContent className="p-0">
            {!visible.length ? <p className="p-6 text-sm text-muted-foreground">No hay movimientos pendientes en este alcance.</p> : <Table className="min-w-[48rem]"><caption className="sr-only">Movimientos IMSS de {type === 'ALTA' ? 'alta' : 'baja'}</caption><TableHeader><TableRow><TableHead className="w-12"><Checkbox aria-label="Seleccionar todos los movimientos listos" disabled={busy || !ready.length} checked={ready.length > 0 && ids.size === ready.length ? true : ids.size ? 'indeterminate' : false} onCheckedChange={() => setIds(ids.size === ready.length ? new Set() : new Set(ready.map(row => row.userId)))} /></TableHead><TableHead>Persona y sucursal</TableHead><TableHead>NSS</TableHead><TableHead>{type === 'ALTA' ? 'Fecha de alta' : 'Fecha y motivo de baja'}</TableHead><TableHead>Días hábiles</TableHead><TableHead>Estado IMSS</TableHead><TableHead>Preparación</TableHead></TableRow></TableHeader><TableBody>{visible.map(row => <TableRow key={row.userId}>
                <TableCell><Checkbox aria-label={`Seleccionar ${row.name}`} checked={ids.has(row.userId)} disabled={busy || row.status !== 'READY'} onCheckedChange={checked => setIds(previous => { const next = new Set(previous); if (checked) next.add(row.userId); else next.delete(row.userId); return next; })} /></TableCell>
                <TableCell><p className="font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{row.branchName || 'Sin sucursal'} · {row.employeeNumber || 'Sin número'}</p>{row.blockedReasons.length > 0 && <p className="max-w-xs text-xs text-destructive">{row.blockedReasons.map(imssReason).join(' · ')}</p>}</TableCell><TableCell className="font-mono text-xs">{row.nss || '—'}</TableCell>
                <TableCell>{imssDate(type === 'ALTA' ? row.hireDate : row.terminationDate)}{type === 'BAJA' && <p className="max-w-xs text-xs text-muted-foreground">{imssTerminationReason(row.terminationReason)}</p>}</TableCell><TableCell>{type === 'ALTA' ? row.daysSinceHire : row.daysSinceTermination}{row.overdue && <Badge variant="destructive" className="ml-2">Vencido</Badge>}</TableCell><TableCell><ImssStateBadge status={row.imssStatus} /></TableCell><TableCell>{row.status === 'READY' ? 'Listo para archivo' : row.imssStatus === 'EN_ARCHIVO' ? 'Registrar acuse' : row.imssStatus === 'CONFIRMADO' ? 'Confirmación registrada' : 'Completar datos'}</TableCell>
            </TableRow>)}</TableBody></Table>}
        </CardContent></Card>
        <div className="flex flex-wrap items-center justify-between gap-3"><Button asChild variant="outline"><Link href="/dashboard/compliance/imss/reports">Historial y acuses</Link></Button><Button disabled={busy || !ids.size} onClick={generate}><FileDown className="mr-2 h-4 w-4" />{busy ? 'Generando…' : `Generar IDSE (${ids.size})`}</Button></div>
    </>;
}
