'use client';

import { useState } from 'react';
import { FileDown, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader, ErrorState } from '@/components/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard, MetricGrid } from '@/components/ui/metric-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useBranch } from '@/lib/branch-context';
import { ImssSubNav } from './imss-sub-nav';
import { ImssLoading, ImssNotice } from './imss-status';
import { downloadImss, imssDate, imssJson, imssQuery, useImssResource } from './imss-client';

interface ImssFile {
    id: string; fileName: string; layout: string; layoutVersion: string; movementType: string; fechaMovimiento: string; createdAt: string;
    lineCount: number; status: string; acuseFolio: string | null; rejectionReason: string | null; downloadAvailable: boolean;
}
interface History {
    files: ImssFile[]; pagination: { page: number; pageSize: number; total: number }; permissions: { canAcknowledge: boolean };
    stats: { idseCount: number; suaCount: number; acceptedCount: number; rejectedCount: number; acceptanceRate: number | null };
}
const fileState = (status: string) => ({ GENERADO: 'Generado', ENVIADO: 'Enviado', ACEPTADO: 'Aceptado', RECHAZADO: 'Rechazado' } as Record<string, string>)[status] || status;
const movementName = (type: string) => ({ ALTA: 'Alta', BAJA: 'Baja', MOD_SALARIO: 'Modificación salarial' } as Record<string, string>)[type] || type;

export function ImssReportsPage() {
    const { selectedBranchId } = useBranch();
    return <div className="space-y-6"><PageHeader title="Archivos y acuses IMSS" description="Historial de archivos generados y respuestas registradas" icon={FileDown} /><ImssSubNav /><ImssNotice /><HistoryTable key={selectedBranchId || 'all'} branchId={selectedBranchId} /></div>;
}
function HistoryTable({ branchId }: { branchId: string | null }) {
    const [page, setPage] = useState(1);
    const query = imssQuery(branchId);
    const resource = useImssResource<History>(`/api/imss/files${query}${query ? '&' : '?'}page=${page}&pageSize=25`);
    const [selected, setSelected] = useState<ImssFile | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    async function download(file: ImssFile) {
        setDownloading(file.id); setError(null);
        try { await downloadImss(await fetch(`/api/imss/files/${file.id}`, { cache: 'no-store' })); }
        catch (error) { setError(error instanceof Error ? error.message : 'No se pudo descargar el archivo'); }
        finally { setDownloading(null); }
    }
    if (resource.loading) return <ImssLoading />;
    if (resource.error) return <ErrorState message={resource.error} onRetry={resource.refresh} />;
    if (!resource.data) return null;
    const { files, stats, pagination, permissions } = resource.data;
    return <>
        <MetricGrid columns={4}><MetricCard label="Archivos IDSE" value={stats.idseCount} /><MetricCard label="Archivos SUA" value={stats.suaCount} /><MetricCard label="Acuses registrados" value={stats.acceptedCount + stats.rejectedCount} /><MetricCard label="Acuses aceptados" value={stats.acceptanceRate === null ? '—' : `${stats.acceptanceRate}%`} subtitle="Sobre los acuses registrados" /></MetricGrid>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Card><CardHeader className="flex flex-wrap items-center justify-between gap-3 sm:flex-row"><CardTitle>Historial de archivos</CardTitle><Button variant="outline" onClick={resource.refresh}><RefreshCw className="mr-2 h-4 w-4" />Actualizar</Button></CardHeader><CardContent className="p-0">
            {!files.length ? <p className="p-6 text-sm text-muted-foreground">Sin archivos generados en este alcance. Prepara el primer archivo desde Altas, Bajas o SUA.</p> : <Table className="min-w-[64rem]"><caption className="sr-only">Archivos IMSS guardados y acuses</caption><TableHeader><TableRow><TableHead>Archivo y versión</TableHead><TableHead>Movimiento</TableHead><TableHead>Fecha de movimiento</TableHead><TableHead>Personas</TableHead><TableHead>Estado</TableHead><TableHead>Acuse</TableHead><TableHead>Acciones</TableHead></TableRow></TableHeader><TableBody>{files.map(file => <TableRow key={file.id}>
                <TableCell><p className="font-medium">{file.fileName}</p><p className="text-xs text-muted-foreground">{file.layout} · {file.layoutVersion}</p><p className="text-xs text-muted-foreground">Generado {new Date(file.createdAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}</p></TableCell><TableCell>{movementName(file.movementType)}</TableCell><TableCell>{imssDate(file.fechaMovimiento)}</TableCell><TableCell>{file.lineCount}</TableCell><TableCell><Badge variant={file.status === 'RECHAZADO' ? 'destructive' : file.status === 'ACEPTADO' ? 'default' : 'secondary'}>{fileState(file.status)}</Badge></TableCell><TableCell>{file.acuseFolio || '—'}{file.rejectionReason && <p className="max-w-xs text-xs text-destructive">{file.rejectionReason}</p>}</TableCell><TableCell><div className="flex flex-wrap gap-2">{file.downloadAvailable ? <Button variant="outline" size="sm" disabled={downloading === file.id} onClick={() => download(file)}>{downloading === file.id ? 'Descargando…' : 'Descargar'}</Button> : <span className="text-xs text-muted-foreground">Contenido no disponible</span>}{permissions.canAcknowledge && ['GENERADO', 'ENVIADO'].includes(file.status) && <Button size="sm" onClick={() => setSelected(file)}>Registrar acuse</Button>}</div></TableCell>
            </TableRow>)}</TableBody></Table>}
        </CardContent></Card>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><p>{pagination.total} archivos · Página {page} de {Math.max(1, Math.ceil(pagination.total / pagination.pageSize))}</p><div className="flex gap-2"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Anterior</Button><Button variant="outline" disabled={page * pagination.pageSize >= pagination.total} onClick={() => setPage(value => value + 1)}>Siguiente</Button></div></div>
        {selected && <AcuseDialog file={selected} close={() => setSelected(null)} saved={() => { setSelected(null); resource.refresh(); }} />}
    </>;
}
function AcuseDialog({ file, close, saved }: { file: ImssFile; close: () => void; saved: () => void }) {
    const [accepted, setAccepted] = useState(true);
    const [folio, setFolio] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    async function save() {
        setBusy(true); setError(null);
        try { await imssJson(`/api/imss/files/${file.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accepted, acuseFolio: folio.trim() || undefined, reason: accepted ? undefined : reason.trim() }) }); toast.success(accepted ? 'Acuse aceptado registrado' : 'Rechazo registrado'); saved(); }
        catch (error) { setError(error instanceof Error ? error.message : 'No se pudo registrar el acuse'); }
        finally { setBusy(false); }
    }
    return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}><DialogContent><DialogHeader><DialogTitle>Registrar acuse</DialogTitle><DialogDescription>{file.fileName} · {file.lineCount} personas. Registra la respuesta recibida para este archivo.</DialogDescription></DialogHeader>
        <div className="space-y-2"><Label htmlFor="acuse-result">Resultado del acuse</Label><select id="acuse-result" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={accepted ? 'accepted' : 'rejected'} disabled={busy} onChange={event => setAccepted(event.target.value === 'accepted')}><option value="accepted">Aceptado</option><option value="rejected">Rechazado</option></select></div>
        <div className="space-y-2"><Label htmlFor="acuse-folio">{accepted ? 'Folio del acuse' : 'Folio del acuse (opcional)'}</Label><Input id="acuse-folio" maxLength={200} value={folio} disabled={busy} onChange={event => setFolio(event.target.value)} /></div>
        {!accepted && <div className="space-y-2"><Label htmlFor="acuse-reason">Motivo del rechazo</Label><Textarea id="acuse-reason" maxLength={2000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></div>}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={close}>Cancelar</Button><Button disabled={busy || (accepted ? !folio.trim() : !reason.trim())} onClick={save}>{busy ? 'Guardando…' : 'Guardar acuse'}</Button></DialogFooter>
    </DialogContent></Dialog>;
}
