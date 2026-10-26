'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { todayInMx } from '@/lib/services/compliance/imss-rules';
import { imssJson, type ImssMovementRow } from './imss-client';

interface Preview { adoptedCount: number; userIds: string[]; previewToken: string }
export function ImssAdoptionDialog({ rows, branches, onAdopted }: { rows: ImssMovementRow[]; branches: { id: string; name: string }[]; onAdopted: () => void }) {
    const [open, setOpen] = useState(false);
    const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : '');
    const [ids, setIds] = useState<Set<string>>(new Set());
    const [date, setDate] = useState(todayInMx().toISOString().slice(0, 10));
    const [nota, setNota] = useState('');
    const [preview, setPreview] = useState<Preview | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const candidates = rows.filter(row => row.branchId === branchId && !['CONFIRMADO', 'EN_ARCHIVO'].includes(row.imssStatus));
    const changed = () => { setPreview(null); setError(null); };
    async function submit(dryRun: boolean) {
        setBusy(true); setError(null);
        try {
            const result = await imssJson<Preview>('/api/imss/adoption', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userIds: [...ids], branchId, effectiveDate: date, nota, dryRun, previewToken: dryRun ? undefined : preview?.previewToken }) });
            if (dryRun) setPreview(result);
            else { toast.success(`${result.adoptedCount} altas históricas incorporadas`); setOpen(false); setPreview(null); setIds(new Set()); onAdopted(); }
        } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo incorporar la plantilla'); setPreview(null); }
        finally { setBusy(false); }
    }
    return <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); changed(); } }}>
        <DialogTrigger asChild><Button variant="outline">Incorporar plantilla histórica</Button></DialogTrigger>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
            <DialogHeader><DialogTitle>Incorporar registros anteriores a Pulso</DialogTitle><DialogDescription>Selecciona las personas cuya alta ya estaba confirmada. Quedarán tu nota y el folio MIGRACION en la auditoría.</DialogDescription></DialogHeader>
            <div className="space-y-2"><Label htmlFor="adoption-branch">Sucursal de la plantilla</Label><select id="adoption-branch" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={branchId} disabled={busy} onChange={event => { setBranchId(event.target.value); setIds(new Set()); changed(); }}><option value="">Selecciona una sucursal</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="adoption-date">Fecha del registro histórico</Label><Input id="adoption-date" type="date" value={date} max={todayInMx().toISOString().slice(0, 10)} disabled={busy} onChange={event => { setDate(event.target.value); changed(); }} /></div>
            {branchId && <div className="space-y-2"><Button variant="ghost" size="sm" disabled={busy || !candidates.length} onClick={() => { setIds(new Set(candidates.map(row => row.userId))); changed(); }}>Seleccionar plantilla de esta sucursal</Button>
                <div className="max-h-48 space-y-3 overflow-y-auto rounded-md border p-3">{candidates.length ? candidates.map(row => <label key={row.userId} className="flex items-center gap-3 text-sm"><Checkbox disabled={busy} checked={ids.has(row.userId)} aria-label={`Incorporar ${row.name}`} onCheckedChange={checked => { setIds(previous => { const next = new Set(previous); if (checked) next.add(row.userId); else next.delete(row.userId); return next; }); changed(); }} />{row.name}</label>) : <p className="text-sm text-muted-foreground">No hay altas disponibles para incorporar en esta sucursal.</p>}</div>
            </div>}
            <div className="space-y-2"><Label htmlFor="adoption-note">Nota y evidencia del registro previo</Label><Textarea id="adoption-note" maxLength={2000} value={nota} disabled={busy} onChange={event => { setNota(event.target.value); changed(); }} placeholder="Indica dónde verificaste que estas altas ya estaban registradas" /></div>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            {preview && <Alert><AlertDescription>Vista previa: se incorporarán {preview.adoptedCount} registros como confirmados. Folio MIGRACION. Esta vista previa vence en 15 minutos.</AlertDescription></Alert>}
            <DialogFooter><Button variant="outline" disabled={busy || !branchId || !ids.size || !date || !nota.trim()} onClick={() => submit(true)}>{busy ? 'Procesando…' : 'Previsualizar incorporación'}</Button><Button disabled={busy || !preview || preview.adoptedCount === 0} onClick={() => submit(false)}>Confirmar incorporación</Button></DialogFooter>
        </DialogContent>
    </Dialog>;
}
