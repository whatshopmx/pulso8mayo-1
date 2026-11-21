"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { detectDelimiter, guessMapping, splitCsv, type SalesColumnMapping } from '@/lib/services/sales-ingest-pure';

export function isPosUploadStep(step: { config?: { posUpload?: unknown }; smartLinkTarget?: unknown }) {
  return step.config?.posUpload === true || step.smartLinkTarget === '/api/workflows/smart-links/upload-pos';
}

const resultSchema = z.object({ fileUrl: z.string().min(1), durable: z.boolean(), matchedCount: z.number().int().nonnegative(),
  warning: z.string().optional(), sales: z.object({ inserted: z.number(), updated: z.number(), skipped: z.number(),
    revenueComplete: z.boolean().optional(), errors: z.array(z.object({ rowNumber: z.number(), message: z.string() })) }).optional() });
type UploadResult = z.infer<typeof resultSchema>;
interface Props {
  branchId?: string;
  workflowInstanceId: string;
  disabled?: boolean;
  savedValue?: string;
  savedReference?: string;
  onChange: (value: string, reference: string) => void;
  onPendingChange: (pending: boolean) => void;
}
const columns: { key: keyof SalesColumnMapping; label: string; required?: boolean }[] = [
  { key: 'recipeRef', label: 'Producto / receta', required: true },
  { key: 'quantitySold', label: 'Cantidad vendida', required: true },
  { key: 'productKey', label: 'Clave del producto' }, { key: 'totalRevenue', label: 'Ingreso' }, { key: 'saleDate', label: 'Fecha del archivo' },
];
function initialDay(saved?: string) {
  try { const value = JSON.parse(saved ?? 'null'); if (/^\d{4}-\d{2}-\d{2}$/.test(value?.businessDate)) return value.businessDate as string; } catch { /* Unsaved or legacy value. */ }
  return '';
}

/** Stores evidence first; only the server's sales summary confirms ingestion. */
export function PosUploadStep({ branchId, workflowInstanceId, disabled, savedValue, savedReference, onChange, onPendingChange }: Props) {
  const id = useId(), input = useRef<HTMLInputElement>(null), readingVersion = useRef(0), flight = useRef(false);
  const [file, setFile] = useState<File | null>(null), [day, setDay] = useState(() => initialDay(savedValue));
  const [headers, setHeaders] = useState<string[]>([]), [mapping, setMapping] = useState<SalesColumnMapping>({ recipeRef: '', quantitySold: '' });
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null), [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false), [reference, setReference] = useState(savedReference ?? '');
  useEffect(() => {
    // Read the browser's civil day after hydration, never the SSR server's UTC day.
    const now = new Date();
    setDay(previous => previous || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  }, []);
  const invalidate = (pending: boolean) => { setResult(null); setError(null); setSessionExpired(false); setReference(''); onChange('', ''); onPendingChange(pending); };
  const selectFile = async (selected: File | null) => {
    const version = ++readingVersion.current;
    setFile(selected); setHeaders([]); setReading(false); invalidate(!!selected);
    if (!selected) return;
    if (selected.size === 0 || selected.size > 10 * 1024 * 1024) { setError('El archivo debe contener datos y pesar como máximo 10 MiB.'); return; }
    if (!/\.csv$/i.test(selected.name) && selected.type !== 'text/csv') return;
    setReading(true);
    try {
      const text = await selected.text();
      if (version !== readingVersion.current) return;
      const names = splitCsv(text, detectDelimiter(text))[0] ?? [];
      if (!names.length) throw new Error('El CSV no contiene encabezados.');
      setHeaders(names);
      setMapping({ ...(guessMapping(names) ?? { recipeRef: '', quantitySold: '' }), productKey: names.find(name => /^(sku|c[oó]digo|productkey)$/i.test(name.trim())) });
    } catch { if (version === readingVersion.current) setError('No se pudo leer el CSV. Revisa el archivo y vuelve a seleccionarlo.'); }
    finally { if (version === readingVersion.current) setReading(false); }
  };
  const submit = async () => {
    if (flight.current || !file || !branchId || !day || reading) return;
    flight.current = true; setBusy(true); invalidate(true);
    try {
      const data = new FormData();
      data.set('file', file); data.set('branchId', branchId); data.set('businessDate', day); data.set('workflowInstanceId', workflowInstanceId);
      if (headers.length) data.set('mapping', JSON.stringify(mapping));
      const response = await fetch('/api/workflows/smart-links/upload-pos', { method: 'POST', body: data });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 401) { setSessionExpired(true); throw new Error('Tu sesión expiró. Inicia sesión y vuelve a intentar.'); }
        throw new Error(typeof body.error?.message === 'string' ? body.error.message : 'No se pudo guardar el archivo del POS.');
      }
      const uploaded = resultSchema.parse(body.data);
      setResult(uploaded);
      if (uploaded.durable) {
        setReference(uploaded.fileUrl);
        onChange(JSON.stringify({ businessDate: day, fileName: file.name, sales: uploaded.sales ?? null, warning: uploaded.warning ?? null }), uploaded.fileUrl);
        onPendingChange(false);
      }
    } catch (failure) { setError(failure instanceof z.ZodError ? 'La respuesta no confirma el archivo. Vuelve a intentar.' : failure instanceof TypeError ? 'No se pudo confirmar el envío. Revisa tu conexión y vuelve a intentar.' : failure instanceof Error ? failure.message : 'No se pudo confirmar el envío. Revisa tu conexión y vuelve a intentar.'); }
    finally { flight.current = false; setBusy(false); }
  };
  const validFile = !!file && file.size > 0 && file.size <= 10 * 1024 * 1024;
  const mappingReady = !headers.length || !!(mapping.recipeRef && mapping.quantitySold);
  const pendingResult = result && (result.warning || !result.sales || result.sales.errors.length || result.sales.revenueComplete !== true || result.matchedCount === 0);
  return <div className="min-w-0 space-y-4 break-words">
    <p className="text-sm text-muted-foreground">Sube el archivo de esta sucursal. Un CSV con producto y cantidad permite registrar ventas; revisa el resultado antes de continuar.</p>
    {!branchId && <p role="alert" className="text-sm text-destructive">La ejecución no tiene una sucursal. Abre el cierre desde una ejecución con sucursal asignada.</p>}
    <fieldset disabled={disabled || busy || reading || !branchId} className="min-w-0 space-y-4">
      <div className="space-y-2"><Label htmlFor={`${id}-file`}>Archivo del POS</Label>
        <Input ref={input} id={`${id}-file`} type="file" accept=".csv,.txt,.xls,.xlsx,.json" onChange={event => void selectFile(event.target.files?.[0] ?? null)} className="max-w-full" />
        <p className="text-xs text-muted-foreground">Máximo 10 MiB. CSV, texto, Excel o JSON.</p></div>
      <div className="space-y-2"><Label htmlFor={`${id}-day`}>Día del corte</Label>
        <Input id={`${id}-day`} type="date" value={day} onChange={event => { setDay(event.target.value); invalidate(!!file); }} /></div>
      {headers.length > 0 && <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Usa el SKU estable del POS cuando sea distinto del nombre de la receta.</p>
        {columns.map(column => <div className="space-y-1" key={column.key}><Label htmlFor={`${id}-${column.key}`}>{column.label}</Label>
          <select id={`${id}-${column.key}`} value={mapping[column.key] ?? ''} className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            onChange={event => { setMapping(previous => ({ ...previous, [column.key]: event.target.value || undefined })); invalidate(!!file); }}>
            <option value="">{column.required ? 'Selecciona una columna' : column.key === 'productKey' ? 'Usar receta' : 'Sin columna'}</option>
            {headers.map((name, index) => <option key={index} value={name}>{name}</option>)}</select></div>)}
      </div>}
      {!mappingReady && <p className="text-sm text-muted-foreground">Selecciona producto y cantidad para procesar este CSV.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void submit()} disabled={!validFile || !day || !mappingReady}>{busy ? 'Guardando archivo…' : reading ? 'Leyendo CSV…' : 'Guardar archivo POS'}</Button>
        {file && <Button type="button" variant="ghost" onClick={() => { if (input.current) input.current.value = ''; void selectFile(null); }}>Quitar archivo</Button>}
      </div>
    </fieldset>
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p>{sessionExpired && <a href="/sign-in" target="_blank" rel="noopener noreferrer" className="underline">Iniciar sesión en otra pestaña</a>}</div>}
    {!result && reference && <p className="text-sm">Archivo POS previamente registrado.</p>}
    {result && <section role="region" aria-label="Resultado del archivo POS" aria-live="polite" className={`space-y-2 rounded-md border p-3 text-sm ${!result.durable ? 'border-destructive' : pendingResult ? 'border-warning' : 'border-border'}`}>
      <p className="font-semibold">{!result.durable ? 'Archivo sin almacenamiento durable' : pendingResult ? 'Archivo guardado con pendientes' : 'Archivo guardado'}</p>
      {!result.durable && <p>El archivo no quedó guardado de forma durable. Vuelve a subirlo cuando el almacenamiento esté disponible.</p>}
      <p>{result.matchedCount ? `Vinculado a ${result.matchedCount} corte(s).` : 'No se encontraron cortes para vincular.'}</p>
      {result.sales ? <><p>{result.sales.inserted} nuevas · {result.sales.updated} corregidas · {result.sales.skipped} sin cambios</p>
        <p>{result.sales.revenueComplete === true ? 'Ingreso completo' : result.sales.revenueComplete === false ? 'Ingreso incompleto' : 'Cobertura de ingreso no disponible'}</p>
        <p className="text-muted-foreground">Totales por producto y día. Repetir el mismo total no vuelve a descontar inventario.</p>
        {!!result.sales.errors.length && <ul className="list-disc space-y-1 pl-5">{result.sales.errors.map((failure, index) => <li key={index}>Fila {failure.rowNumber}: {failure.message}</li>)}</ul>}</> : <p>No se confirmó la generación de ventas.</p>}
      {result.warning && <p>{result.warning}</p>}
    </section>}
  </div>;
}
