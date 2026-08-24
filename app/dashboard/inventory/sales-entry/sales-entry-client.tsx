"use client";

// T9 (plan-inventario-desconexion): carga masiva de ventas.
// 9a — upload CSV + sucursal (respetando scope del header) + mapeo de columnas
//      persistido en localStorage, con preview local de las primeras filas.
// 9b — confirmación → POST bulk → resultado con errores accionables por fila.
//
// El parseo del preview corre en el cliente contra `sales-ingest-pure` (módulo
// sin conexión a DB); la escritura idempotente vive server-side en la ruta
// bulk. El mapeo se auto-adivina con `guessMapping` y se guarda por empresa.

import { useMemo, useState } from "react";
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
  type SalesColumnMapping,
} from "@/lib/services/sales-ingest-pure";

interface BranchOption {
  id: string;
  name: string;
}

interface BulkResponse {
  inserted?: number;
  skipped?: number;
  errors?: { rowNumber: number; message: string }[];
  error?: string;
  message?: string;
}

const PREVIEW_ROWS = 8;

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
  const [result, setResult] = useState<BulkResponse | null>(null);

  const mappingKey =
    typeof window !== "undefined"
      ? `sales-entry-mapping:${window.location.hostname}`
      : "";

  function onFile(file: File) {
    setResult(null);
    setFileName(file.name);
    file.text().then((text) => {
      setCsvText(text);
      const delim = detectDelimiter(text);
      setDelimiter(delim);
      const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
      const cols = firstLine.split(delim).map((h) => h.trim()).filter(Boolean);
      setHeaders(cols);

      // Mapeo guardado de la última importación que siga siendo válido; si no,
      // intento adivinarlo de los encabezados.
      let saved: SalesColumnMapping | null = null;
      try {
        const raw = localStorage.getItem(mappingKey);
        if (raw) {
          const parsed = JSON.parse(raw) as SalesColumnMapping;
          const valid =
            cols.includes(parsed.recipeRef) && cols.includes(parsed.quantitySold);
          if (valid) saved = parsed;
        }
      } catch {
        // localStorage indisponible: solo se pierde el recordatorio del mapeo
      }
      setMapping(saved ?? guessMapping(cols));
    });
  }

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
    !submitting;

  async function onImport() {
    if (!mapping || !branchId || !csvText) return;
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
      setResult(res.ok ? data : { error: data.error ?? "Error al importar" });
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
          </div>

          {!scopedBranchId && (
            <div className="grid gap-2">
              <Label htmlFor="branch">Sucursal destino</Label>
              <select
                id="branch"
                className={selectCls}
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
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
              onChange={(e) => setDefaultDay(e.target.value)}
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
                    setMapping({ ...(mapping ?? ({} as SalesColumnMapping)), recipeRef: e.target.value })
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
                    setMapping({ ...(mapping ?? ({} as SalesColumnMapping)), quantitySold: e.target.value })
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
                    setMapping({
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
                    setMapping({
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
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
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
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > PREVIEW_ROWS && (
              <p className="text-xs text-muted-foreground">
                Mostrando {PREVIEW_ROWS} de {preview.rows.length} filas.
              </p>
            )}
            {preview.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {preview.errors.slice(0, 5).map((err, i) => (
                      <li key={i}>
                        Fila {err.rowNumber}: {err.message}
                      </li>
                    ))}
                  </ul>
                  {preview.errors.length > 5 && (
                    <p className="mt-1 text-xs">
                      …y {preview.errors.length - 5} más. Las filas con error no
                      bloquean el resto de la importación.
                    </p>
                  )}
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

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.error ? (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-success" />
              )}
              Resultado
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
                <Badge>{result.inserted ?? 0} insertadas</Badge>
                {(result.skipped ?? 0) > 0 && (
                  <Badge variant="secondary">{result.skipped} ya existían (actualizadas)</Badge>
                )}
                {(result.errors?.length ?? 0) > 0 && (
                  <Badge variant="outline" className="border-warning text-warning-text">
                    {result.errors!.length} con error
                  </Badge>
                )}
                <p className="text-sm text-muted-foreground w-full">
                  Las ventas registradas descontaron consumo teórico de inventario.
                </p>
              </div>
            )}
            {(result.errors?.length ?? 0) > 0 && (
              <div className="rounded-md border p-3">
                <ul className="list-disc pl-4 space-y-1 text-sm">
                  {result.errors!.slice(0, 20).map((err, i) => (
                    <li key={i}>
                      Fila {err.rowNumber}: {err.message}
                    </li>
                  ))}
                </ul>
                {(result.errors!.length) > 20 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    …y {result.errors!.length - 20} errores más.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
