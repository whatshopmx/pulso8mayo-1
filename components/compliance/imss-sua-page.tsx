'use client';

import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader, ErrorState } from '@/components/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useBranch } from '@/lib/branch-context';
import { todayInMx } from '@/lib/services/compliance/imss-rules';
import { getImssBimester } from '@/lib/services/compliance/imss-period';
import { calculateSDI } from '@/lib/services/compliance/imss-parser';
import { ImssSubNav } from './imss-sub-nav';
import { ImssLoading, ImssNotice } from './imss-status';
import { generateImssFile, imssDate, imssMoney, imssQuery, imssReason, useImssResource } from './imss-client';

interface Candidate { userId: string; name: string; nss: string | null; branchName: string | null; baseSalaryPesos: number | null; sdiPesos: number | null; contractId: string | null; yearsOfService: number; blockedReasons: string[] }
export function ImssSuaPage() {
    const { selectedBranchId } = useBranch();
    return <div className="space-y-6"><PageHeader title="Actualización salarial SUA" description="Prepara movimientos con salario del contrato y SDI calculado" icon={FileDown} /><ImssSubNav /><ImssNotice /><SuaEditor key={selectedBranchId || 'all'} branchId={selectedBranchId} /></div>;
}
function SuaEditor({ branchId }: { branchId: string | null }) {
    const current = getImssBimester();
    const [bimestre, setBimestre] = useState(current.key);
    const [date, setDate] = useState(todayInMx().toISOString().slice(0, 10));
    const window = getImssBimester(bimestre);
    const query = new URLSearchParams(imssQuery(branchId).slice(1));
    query.set('bimestre', bimestre); if (date) query.set('fechaMovimiento', date);
    const resource = useImssResource<{ candidates: Candidate[] }>(`/api/imss/sua-candidatos?${query}`);
    const [ids, setIds] = useState<Set<string>>(new Set());
    const [salaries, setSalaries] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const baseDate = new Date(`${current.start}T00:00:00Z`);
    const periods = Array.from({ length: 12 }, (_, index) => getImssBimester(new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() - index * 2, 1)).toISOString().slice(0, 7)));
    const salary = (row: Candidate) => {
        if (salaries[row.userId] === undefined) return row.baseSalaryPesos;
        const value = Math.round(Number(salaries[row.userId]) * 100) / 100;
        return Number.isFinite(value) && value > 0 ? value : null;
    };
    const selectedRows = resource.data?.candidates.filter(row => ids.has(row.userId)) || [];
    const validSelection = selectedRows.length === ids.size && selectedRows.every(row => !row.blockedReasons.length && !!row.contractId && salary(row) !== null);
    async function generate() {
        setBusy(true); setError(null);
        try {
            const rows = resource.data!.candidates.filter(row => ids.has(row.userId));
            const result = await generateImssFile({ layout: 'SUA', movementType: 'MOD_SALARIO', employeeIds: rows.map(row => row.userId),
                fechaMovimiento: date, bimestre, newSalaries: Object.fromEntries(rows.map(row => [row.userId, salary(row)])) });
            toast.success(`${result.included} modificaciones en archivo`);
            if (!result.saved) toast.info('Guarda esta descarga: el historial conservará los datos del archivo, sin una copia descargable.');
            setIds(new Set()); resource.refresh();
        } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo generar SUA'); }
        finally { setBusy(false); }
    }
    return <>
        <Card><CardContent className="grid gap-4 pt-6 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="sua-period">Bimestre de trabajo</Label><select id="sua-period" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={bimestre} disabled={busy} onChange={event => { const period = getImssBimester(event.target.value); setBimestre(period.key); setDate(period.key === current.key ? todayInMx().toISOString().slice(0, 10) : period.start); setIds(new Set()); setSalaries({}); setError(null); }}>{periods.map(period => <option key={period.key} value={period.key}>{imssDate(period.start)} – {imssDate(period.end)}</option>)}</select></div><div className="space-y-2"><Label htmlFor="sua-date">Fecha del movimiento</Label><Input id="sua-date" type="date" value={date} min={window.start} max={window.end} disabled={busy} onChange={event => { setDate(event.target.value); setIds(new Set()); setError(null); }} /></div><p className="text-xs text-muted-foreground sm:col-span-2">La fecha debe pertenecer al bimestre seleccionado. Este período de trabajo permite preparar correcciones extemporáneas; el plazo de presentación depende del tipo de salario.</p></CardContent></Card>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {resource.loading ? <ImssLoading /> : resource.error ? <ErrorState message={resource.error} onRetry={resource.refresh} /> : resource.data && <Card><CardHeader><CardTitle>Personas y salarios</CardTitle><CardDescription>Selecciona las personas que irán en el archivo. Los importes son diarios y están expresados en pesos.</CardDescription></CardHeader><CardContent className="p-0">{!resource.data.candidates.length ? <p className="p-6 text-sm text-muted-foreground">No hay candidatos SUA en este alcance.</p> : <Table className="min-w-[56rem]"><caption className="sr-only">Candidatos SUA y SDI del movimiento</caption><TableHeader><TableRow><TableHead>Seleccionar</TableHead><TableHead>Persona y sucursal</TableHead><TableHead>NSS</TableHead><TableHead>Base del contrato</TableHead><TableHead>Salario del movimiento</TableHead><TableHead>SDI del movimiento</TableHead></TableRow></TableHeader><TableBody>{resource.data.candidates.map(row => {
            const value = salary(row);
            const blocked = row.blockedReasons.length > 0 || !row.contractId;
            return <TableRow key={row.userId}><TableCell><Checkbox aria-label={`Seleccionar ${row.name}`} disabled={busy || blocked || value === null} checked={ids.has(row.userId)} onCheckedChange={checked => setIds(previous => { const next = new Set(previous); if (checked) next.add(row.userId); else next.delete(row.userId); return next; })} /></TableCell><TableCell><p className="font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{row.branchName || 'Sin sucursal'}</p>{row.blockedReasons.length > 0 && <p className="max-w-xs text-xs text-destructive">{row.blockedReasons.map(imssReason).join(' · ')}</p>}</TableCell><TableCell className="font-mono text-xs">{row.nss || '—'}</TableCell><TableCell>{imssMoney(row.baseSalaryPesos)}</TableCell><TableCell><Input aria-label={`Salario diario de ${row.name}`} type="number" min="0.01" step="0.01" className="w-36" disabled={busy || blocked} value={salaries[row.userId] ?? (row.baseSalaryPesos === null ? '' : String(row.baseSalaryPesos))} onChange={event => { const next = event.target.value; setSalaries(previous => ({ ...previous, [row.userId]: next })); if (!next || Number(next) <= 0) setIds(previous => { const selected = new Set(previous); selected.delete(row.userId); return selected; }); }} /></TableCell><TableCell data-testid={`sdi-${row.userId}`}>{imssMoney(value === null ? null : calculateSDI(value, row.yearsOfService))}</TableCell></TableRow>;
        })}</TableBody></Table>}</CardContent></Card>}
        <div className="flex justify-end"><Button disabled={busy || resource.loading || !!resource.error || !ids.size || !validSelection || !date || date < window.start || date > window.end} onClick={generate}><FileDown className="mr-2 h-4 w-4" />{busy ? 'Generando…' : `Generar SUA (${ids.size})`}</Button></div>
    </>;
}
