"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { StockCountGrid } from "@/components/inventory/stock-count-grid";
import type { StockCountRow } from "@/lib/workflows/stock-count-grid";
import { buildInitialValues, parseActiveCountId } from "@/lib/inventory/stock-count-launcher";

interface BranchOption { id: string; name: string }
interface CategoryOption { value: string; label: string; count: number }

interface Props {
  branches: BranchOption[];
  scopedBranch: BranchOption | null;
  categories: CategoryOption[];
  hasHighValueItems: boolean;
  blindCount: boolean;
  defaultCategory?: string;
}

/**
 * B2 — al seleccionar una categoría aparece su conteo en la misma pantalla:
 * un renglón por producto y lote disponibles (con su vencimiento, FEFO) y los
 * productos sin lote. Al confirmar se crea la instancia conservando lo
 * capturado; el servidor valida las filas contra el alcance real.
 */
export function StockCountLauncher({ branches, scopedBranch, categories, hasHighValueItems, blindCount, defaultCategory }: Props) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(scopedBranch?.id ?? "");
  const [selected, setSelected] = useState<string[]>(defaultCategory ? [defaultCategory] : []);
  const [highOnly, setHighOnly] = useState(false);
  const [rowsByCategory, setRowsByCategory] = useState<Record<string, StockCountRow[]>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reload, setReload] = useState(0);
  const scopeRef = useRef(`${scopedBranch?.id ?? ""}|false`);

  const toggle = (value: string) =>
    setSelected(previous => previous.includes(value) ? previous.filter(item => item !== value) : [...previous, value]);

  useEffect(() => {
    const scope = `${branchId}|${highOnly}`;
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      setValues({});
      setRowsByCategory({});
    }
    if (!branchId || selected.length === 0) {
      setRowsByCategory({});
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    Promise.all(selected.map(async category => {
      const params = new URLSearchParams({ branchId, category, highValueOnly: String(highOnly) });
      const response = await fetch(`/api/inventory/stock-count/rows?${params.toString()}`, { signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar los productos.");
      return [category, (data.rows || []) as StockCountRow[]] as const;
    })).then(entries => {
      if (!active) return;
      const next = Object.fromEntries(entries);
      setRowsByCategory(next);
      // Conserva la captura de las categorías que siguen seleccionadas.
      setValues(previous => Object.fromEntries(Object.entries(previous).filter(([category]) => category in next)));
    }).catch(err => {
      if (active && err?.name !== "AbortError") setError(err instanceof Error ? err.message : "No se pudieron cargar los productos.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [branchId, highOnly, selected, reload]);

  const start = async () => {
    if (!branchId || selected.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/inventory/stock-count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          categories: selected,
          highValueOnly: highOnly,
          initialValues: buildInitialValues(values),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const activeId = parseActiveCountId(data.error);
        if (activeId) { router.push(`/dashboard/workflows/${activeId}/execute`); return; }
        throw new Error(data.error || "No se pudo iniciar el conteo.");
      }
      const instanceId = data?.instance?.id;
      if (!instanceId) throw new Error("No se pudo iniciar el conteo.");
      router.push(`/dashboard/workflows/${instanceId}/execute`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar el conteo.");
    } finally {
      setSubmitting(false);
    }
  };

  const gridReady = selected.length > 0 && Object.keys(rowsByCategory).length > 0;
  const captured = Object.keys(buildInitialValues(values)).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo Conteo</CardTitle>
        <CardDescription>
          Selecciona la categoría: sus productos y lotes (con vencimiento) aparecen aquí para capturar.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="branchId">Sucursal</Label>
          {scopedBranch ? (
            <div
              id="branchId"
              className="flex h-9 w-full items-center rounded-md border border-input bg-muted/30 px-3 py-1 text-sm text-muted-foreground"
            >
              {scopedBranch.name}
            </div>
          ) : (
            <select
              id="branchId"
              value={branchId}
              onChange={event => setBranchId(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              required
            >
              <option value="">Seleccionar sucursal</option>
              {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          )}
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Categorías</legend>
          {categories.map(item => (
            <label key={item.value} className="flex min-h-11 items-center gap-3 rounded-lg border p-3 text-sm">
              <input type="checkbox" checked={selected.includes(item.value)} onChange={() => toggle(item.value)} />
              <span className="min-w-0 flex-1 break-words">{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.count} productos</span>
            </label>
          ))}
          {!categories.length && <p className="text-sm text-muted-foreground">Registra productos activos en Inventario para iniciar un conteo.</p>}
        </fieldset>

        <div className="flex items-start gap-3 rounded-lg border bg-muted/10 p-3">
          <input
            id="highValueOnly"
            type="checkbox"
            checked={highOnly}
            onChange={event => setHighOnly(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-input text-primary focus:ring-primary"
          />
          <div className="space-y-1">
            <label htmlFor="highValueOnly" className="text-sm font-medium leading-none cursor-pointer">
              Contar solo SKUs de alto valor (80/20 Pareto)
            </label>
            <p className="text-xs text-muted-foreground">
              {hasHighValueItems
                ? "Filtra automáticamente los artículos de mayor costo acumulado. Desmarca para auditar todo el catálogo de la categoría."
                : "No hay productos marcados como alto valor en el catálogo. Mantén esta opción desmarcada para auditar todos los artículos."}
            </p>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <div className="space-y-1">
              <AlertDescription className="font-medium">{error}</AlertDescription>
              <Button variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>Reintentar</Button>
            </div>
          </Alert>
        )}

        {loading && <p role="status" className="text-sm text-muted-foreground">Cargando productos y lotes…</p>}

        {!loading && selected.length > 0 && Object.entries(rowsByCategory).map(([category, rows]) => (
          <div key={category} className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">Conteo · {category}</p>
            <StockCountGrid
              rows={rows}
              value={values[category]}
              onChange={next => setValues(previous => ({ ...previous, [category]: next }))}
              blindCount={blindCount}
            />
          </div>
        ))}

        <Button type="button" onClick={start} disabled={!branchId || selected.length === 0 || loading || submitting} className="w-full mt-2">
          {submitting ? "Iniciando…" : captured > 0 ? `Iniciar Conteo (${captured} categoría${captured === 1 ? "" : "s"} capturada${captured === 1 ? "" : "s"})` : "Iniciar Conteo"}
        </Button>
        {gridReady && <p className="text-xs text-muted-foreground">Lo capturado aquí se guarda como borrador del conteo; el ajuste de existencias requiere aprobación en la revisión.</p>}
      </CardContent>
    </Card>
  );
}
