"use client";

// T9 (plan-inventario-desconexion): carga masiva de ventas.
// 9a — upload CSV + sucursal (respetando scope del header) + mapeo de columnas
//      persistido en localStorage, con preview local de las primeras filas.
// 9b — confirmación → POST bulk → resultado con errores accionables por fila.
//
// El parseo del preview corre en el cliente contra `sales-ingest-pure` (módulo
// sin conexión a DB); la escritura idempotente vive server-side en la ruta
// bulk. El mapeo se auto-adivina con `guessMapping` y se guarda por empresa.

import { useMemo, useRef, useState } from "react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileUp, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import {
  buildRows,
  detectDelimiter,
  guessMapping,
  splitCsv,
  type SalesColumnMapping,
} from "@/lib/services/sales-ingest-pure";

interface BranchOption {
  id: string;
  name: string;
}

interface BulkResponse {
  inserted?: number;
  updated?: number;
  skipped?: number;
  revenueComplete?: boolean;
  errors?: { rowNumber: number; message: string }[];
  error?: string;
  message?: string;
}

const PREVIEW_ROWS = 8;

function RowErrors({ errors, limit }: { errors: NonNullable<BulkResponse["errors"]>; limit: number }) {
  const list = (items: typeof errors) => <ul className="list-disc pl-4 space-y-1 text-sm">
    {items.map((error, index) => <li key={`${error.rowNumber}-${index}`}>Fila {error.rowNumber}: {error.message}</li>)}
  </ul>;
  return <>{list(errors.slice(0, limit))}{errors.length > limit && <details className="mt-2 text-sm">
    <summary className="cursor-pointer">Ver {errors.length - limit} errores más</summary>
    {list(errors.slice(limit))}
  </details>}</>;
}

export function SalesEntryClient({
  branches,
  scopedBranchId,
}: {
  branches: BranchOption[];
  scopedBranchId: string | null;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string>("");
  const [delimiter, setDelimiter] = useState<string>(",");
  const [headers, setHeaders] = useState<string[]>([]);
  const [branchId, setBranchId] = useState<string>(scopedBranchId ?? "");
  const [defaultDay, setDefaultDay] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [mapping, setMapping] = useState<SalesColumnMapping | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reading, setReading] = useState(false);
  const fileRead = useRef(0);
  const [result, setResult] = useState<BulkResponse | null>(null);

  const mappingKey =
    typeof window !== "undefined"
      ? `sales-entry-mapping:${window.location.hostname}`
      : "";

  async function onFile(file: File) {
    const read = ++fileRead.current;
    setResult(null);
    setFileName(file.name);
    setCsvText("");
    setHeaders([]);
    setMapping(null);
    setReading(true);
    try {
      const text = await file.text();
      if (read !== fileRead.current) return;
      setCsvText(text);
      const delim = detectDelimiter(text);
      setDelimiter(delim);
      const cols = (splitCsv(text, delim)[0] ?? []).filter(Boolean);
      setHeaders(cols);

      // Mapeo guardado de la última importación que siga siendo válido; si no,
      // intento adivinarlo de los encabezados.
      let saved: SalesColumnMapping | null = null;
      try {
        const raw = localStorage.getItem(mappingKey);
        if (raw) {
          const parsed = JSON.parse(raw) as SalesColumnMapping;
          const valid =
            cols.includes(parsed.recipeRef) && cols.includes(parsed.quantitySold)
            && [parsed.productKey, parsed.saleDate, parsed.totalRevenue].every(column => !column || cols.includes(column));
          if (valid) saved = parsed;
        }
      } catch {
        // localStorage indisponible: solo se pierde el recordatorio del mapeo
      }
      setMapping(saved ?? guessMapping(cols));
    } catch {
      if (read === fileRead.current) setResult({ error: "No se pudo leer el archivo. Selecciónalo de nuevo." });
    } finally {
      if (read === fileRead.current) setReading(false);
    }
  }

  function changeMapping(value: SalesColumnMapping) { setResult(null); setMapping(value); }

  function persistMapping(m: SalesColumnMapping) {
    try {
      if (mappingKey) localStorage.setItem(mappingKey, JSON.stringify(m));
    } catch {
      // ídem
    }
  }

  const preview = useMemo(() => {
    if (!csvText || !mapping?.recipeRef || !mapping?.quantitySold) return null;
    return buildRows(csvText, mapping, { defaultDay, delimiter });
  }, [csvText, mapping, defaultDay, delimiter]);

  const canSubmit =
    !!csvText &&
    !!branchId &&
    !!mapping?.recipeRef &&
    !!mapping?.quantitySold &&
    (preview?.rows.length ?? 0) > 0 &&
    !reading &&
    !submitting;

  async function onImport() {
    if (!mapping || !canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/inventory/sales-entry/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          csvText,
          mapping,
          defaultDay,
          delimiter: delimiter === "\t" ? "\t" : delimiter === ";" ? ";" : ",",
        }),
      });
      const data = (await res.json()) as BulkResponse;
      setResult(res.ok ? data : { ...data, error: data.error ?? data.message ?? "Error al importar" });
      if (res.ok) persistMapping(mapping);
    } catch {
      setResult({ error: "No se pudo contactar al servidor" });
    } finally {
      setSubmitting(false);
    }
  }

  const selectCls =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  return (
    <div className="space-y-6">
      <fieldset disabled={submitting} className="min-w-0 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Archivo del POS</CardTitle>
          <CardDescription>
            CSV genérico con columnas de producto, cantidad y fecha. El
            delimitador (coma, punto y coma o tabulador) se detecta solo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="pos-file">Archivo CSV</Label>
            <input
              id="pos-file"
              type="file"
              accept=".csv,text/csv,text/plain,.txt,.tsv"
              className="text-sm file:mr-3 file:h-8 file:rounded-md file:border-0 file:bg-primary file:px-3 file:text-sm file:text-primary-foreground hover:file:bg-primary/90"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            {fileName && (
              <p className="text-xs text-muted-foreground">Seleccionado: {fileName}</p>
            )}
            {reading && <p role="status" className="text-sm text-muted-foreground">Leyendo archivo…</p>}
          </div>

          {!scopedBranchId && (
            <div className="grid gap-2">
              <Label htmlFor="branch">Sucursal destino</Label>
              <select
                id="branch"
                className={selectCls}
                value={branchId}
                onChange={(e) => { setResult(null); setBranchId(e.target.value); }}
                required
              >
                <option value="">Seleccionar sucursal</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-2 max-w-[220px]">
            <Label htmlFor="default-day">Día del corte (si el archivo no trae fecha)</Label>
            <input
              id="default-day"
              type="date"
              className={selectCls}
              value={defaultDay}
              onChange={(e) => { setResult(null); setDefaultDay(e.target.value); }}
            />
          </div>
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Mapeo de columnas</CardTitle>
            <CardDescription>
              Indica qué columna del archivo corresponde a cada campo. Se
              recuerda para la próxima importación.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="map-product">Producto / receta *</Label>
                <select
                  id="map-product"
                  className={selectCls}
                  value={mapping?.recipeRef ?? ""}
                  onChange={(e) =>
                    changeMapping({ ...(mapping ?? ({} as SalesColumnMapping)), recipeRef: e.target.value })
                  }
                >
                  <option value="">—</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="map-qty">Cantidad vendida *</Label>
                <select
                  id="map-qty"
                  className={selectCls}
                  value={mapping?.quantitySold ?? ""}
                  onChange={(e) =>
                    changeMapping({ ...(mapping ?? ({} as SalesColumnMapping)), quantitySold: e.target.value })
                  }
                >
                  <option value="">—</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="map-date">Fecha (opcional)</Label>
                <select
                  id="map-date"
                  className={selectCls}
                  value={mapping?.saleDate ?? ""}
                  onChange={(e) =>
                    changeMapping({
                      ...(mapping ?? ({} as SalesColumnMapping)),
                      saleDate: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">Usar día del corte</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="map-revenue">Ingreso $ (opcional)</Label>
                <select
                  id="map-revenue"
                  className={selectCls}
                  value={mapping?.totalRevenue ?? ""}
                  onChange={(e) =>
                    changeMapping({
                      ...(mapping ?? ({} as SalesColumnMapping)),
                      totalRevenue: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">Sin ingreso</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="map-key">Clave del producto (opcional)</Label>
                <select id="map-key" className={selectCls} value={mapping?.productKey ?? ""}
                  onChange={e => changeMapping({ ...(mapping ?? ({} as SalesColumnMapping)), productKey: e.target.value || undefined })}>
                  <option value="">Usar producto / receta</option>
                  {headers.map(header => <option key={header} value={header}>{header}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">Usa el SKU o código estable del POS si es distinto de la receta.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>Vista previa</CardTitle>
            <CardDescription>
              {preview.rows.length} fila(s) válidas ·{" "}
              {preview.errors.length > 0 ? (
                <span className="text-destructive">{preview.errors.length} con error</span>
              ) : (
                "sin errores"
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div role="region" aria-label="Vista previa de ventas" tabIndex={0}
              className="overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Producto</th>
                    <th className="px-3 py-2 font-medium text-right">Cantidad</th>
                    <th className="px-3 py-2 font-medium">Día</th>
                    <th className="px-3 py-2 font-medium text-right">Ingreso</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, PREVIEW_ROWS).map((r) => (
                    <tr key={r.rowNumber} className="border-t">
                      <td className="px-3 py-1.5 text-muted-foreground">{r.rowNumber}</td>
                      <td className="px-3 py-1.5">{r.recipeRef}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.quantitySold}</td>
                      <td className="px-3 py-1.5 tabular-nums">{r.saleDay}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.totalRevenueCents != null
                          ? `$${(r.totalRevenueCents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`
                          : "No reportado"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground sm:hidden">Desliza para ver todas las columnas.</p>
            {preview.rows.length > PREVIEW_ROWS && (
              <p className="text-xs text-muted-foreground">
                Mostrando {PREVIEW_ROWS} de {preview.rows.length} filas.
              </p>
            )}
            {preview.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <RowErrors errors={preview.errors} limit={5} />
                  <p>Los productos y días con errores no se importan parcialmente. Los grupos válidos pueden continuar.</p>
                </AlertDescription>
              </Alert>
            )}
            <Button onClick={onImport} disabled={!canSubmit} className="w-full sm:w-auto">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importando…
                </>
              ) : (
                <>
                  <FileUp className="mr-2 h-4 w-4" /> Importar {preview.rows.length} fila(s)
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
      </fieldset>

      {result && (
        <Card role="region" aria-label="Resultado de importación" aria-live="polite" aria-atomic="true">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.error || (result.errors?.length ?? 0) > 0 || result.revenueComplete !== true ? (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-success" />
              )}
              {result.error ? "Importación no completada" : (result.errors?.length ?? 0) > 0 || result.revenueComplete !== true ? "Importación con pendientes" : "Importación completada"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.error ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{result.error}</AlertDescription>
              </Alert>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{result.inserted ?? 0} {(result.inserted ?? 0) === 1 ? "nueva" : "nuevas"}</Badge>
                {(result.updated ?? 0) > 0 && <Badge variant="secondary">{result.updated} {result.updated === 1 ? "corregida" : "corregidas"}</Badge>}
                {(result.skipped ?? 0) > 0 && (
                  <Badge variant="secondary">{result.skipped} sin cambios</Badge>
                )}
                {(result.errors?.length ?? 0) > 0 && (
                  <Badge variant="outline" className="border-warning text-warning-text">
                    {result.errors!.length} con error
                  </Badge>
                )}
                <p className="text-sm text-muted-foreground w-full">
                  Totales por producto y día. Repetir la misma venta no vuelve a mover inventario.
                </p>
              </div>
            )}
            {!result.error && result.revenueComplete !== true && <div className="rounded-md border border-warning p-3 text-sm">
              <p className="font-medium">{result.revenueComplete === false ? "Ingreso incompleto" : "Cobertura de ingreso no disponible"}</p>
              <p className="mt-1 text-muted-foreground">No uses el importe de esta importación como ingreso total. Revisa los errores y los productos sin ingreso reportado.</p>
            </div>}
            {(result.errors?.length ?? 0) > 0 && (
              <div className="rounded-md border p-3">
                <RowErrors errors={result.errors!} limit={20} />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
