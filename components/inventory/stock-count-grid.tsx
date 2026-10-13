"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { readStockCount, stockCountRowKey, type StockCountRow } from "@/lib/workflows/stock-count-grid";

export interface StockCountGridHandle { flush: () => Promise<void> }
interface Props {
  rows: StockCountRow[];
  value?: unknown;
  onChange?: (value: string) => void;
  onSave?: (value: string) => Promise<void>;
  blindCount?: boolean;
  readOnly?: boolean;
}

/** A category is captured together; empty inputs remain pending, including zero-stock products. */
export const StockCountGrid = forwardRef<StockCountGridHandle, Props>(function StockCountGrid(
  { rows, value, onChange, onSave, blindCount, readOnly }, ref,
) {
  const [query, setQuery] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef<string | null>(null);
  const saved = useRef<string | null>(null);
  const flight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useRef(onSave);
  useEffect(() => { save.current = onSave; }, [onSave]);

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    if (flight.current) return flight.current;
    const task = async () => {
      while (latest.current !== saved.current && latest.current !== null && save.current) {
        const snapshot = latest.current;
        setSaveState("saving");
        try {
          await save.current(snapshot);
          saved.current = snapshot;
        } catch (error) {
          setSaveState("error");
          throw error;
        }
      }
      setSaveState("saved");
    };
    flight.current = task().finally(() => { flight.current = null; });
    return flight.current;
  };
  useImperativeHandle(ref, () => ({ flush }));
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (latest.current !== saved.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("beforeunload", warn);
    };
  }, []);

  const captured = new Map((readStockCount(value)?.rows || []).map(row => [stockCountRowKey(row), row.countedQuantity]));
  const quantity = (row: StockCountRow) => captured.get(stockCountRowKey(row)) ?? "";
  const valid = (row: StockCountRow) => quantity(row) !== "" && Number.isFinite(Number(quantity(row))) && Number(quantity(row)) >= 0 && Number(quantity(row)) < 100000000;
  const completed = rows.filter(valid).length;
  const visible = rows.filter(row =>
    (!pendingOnly || !valid(row) || stockCountRowKey(row) === focusedKey) &&
    `${row.name} ${row.sku} ${row.lotNumber || ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const change = (row: StockCountRow, input: string) => {
    const next = JSON.stringify({ kind: "stock_count", rows: rows.map(item => ({
      itemId: item.itemId, batchId: item.batchId,
      countedQuantity: stockCountRowKey(item) === stockCountRowKey(row) ? (input === "" ? null : input) : quantity(item) === "" ? null : quantity(item),
    })) });
    latest.current = next;
    onChange?.(next);
    if (onSave) {
      setSaveState("pending");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void flush().catch(() => {}); }, 700);
    }
  };

  if (!rows.length) return <p className="text-sm text-muted-foreground">Los productos y lotes de esta categoría se cargarán al iniciar el conteo en la sucursal.</p>;
  return <div ref={root} className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p>{completed} de {rows.length} lotes capturados</p>
      {onSave && !readOnly && <div role="status" aria-live="polite" className={saveState === "error" ? "text-destructive" : "text-muted-foreground"}>
        {saveState === "saved" ? "Borrador guardado" : saveState === "error" ? "No se pudo guardar" : saveState === "saving" ? "Guardando…" : "Cambios pendientes"}
        {saveState === "error" && <Button variant="outline" size="sm" className="ml-2" onClick={() => { void flush().catch(() => {}); }}>Reintentar</Button>}
      </div>}
    </div>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Input type="search" aria-label="Buscar producto o lote" placeholder="Buscar producto, SKU o lote" value={query} onChange={event => setQuery(event.target.value)} className="sm:max-w-sm" />
      {!readOnly && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={pendingOnly} onChange={event => setPendingOnly(event.target.checked)} />Solo pendientes</label>}
    </div>
    <div className="divide-y rounded-lg border">
      {visible.map(row => {
        const key = stockCountRowKey(row);
        const invalid = quantity(row) !== "" && !valid(row);
        return <div key={key} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,1fr)_8rem]">
          <div className="min-w-0"><p className="break-words text-sm font-medium">{row.name}</p><p className="text-xs text-muted-foreground">{row.sku} · {row.unit}</p>
            <p className="mt-1 text-xs text-muted-foreground sm:hidden">Lote: {row.lotNumber || "Sin lote"}{row.expirationDate ? ` · Vence ${row.expirationDate}` : ""}</p>
            {!blindCount && <p className="mt-1 text-xs text-muted-foreground">Sistema: {row.systemQuantity} {row.unit}</p>}
          </div>
          <div className="hidden text-sm sm:block"><p>{row.lotNumber || "Sin lote"}</p>{row.expirationDate && <p className="text-xs text-muted-foreground">Vence {row.expirationDate}</p>}</div>
          <div>{readOnly ? <p className="text-right text-sm tabular-nums">{quantity(row) === "" ? "Pendiente" : quantity(row)} {row.unit}</p> : <>
            <Input data-count-input type="number" inputMode="decimal" min="0" max="99999999.9999" step="0.0001" placeholder="Cantidad" aria-label={`Cantidad de ${row.name}, lote ${row.lotNumber || "sin lote"}`} aria-invalid={invalid} value={quantity(row)} disabled={readOnly} onFocus={() => setFocusedKey(key)} onBlur={() => setFocusedKey(null)} onChange={event => change(row, event.target.value)} onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                const inputs = Array.from(root.current?.querySelectorAll<HTMLInputElement>("[data-count-input]") || []);
                inputs[inputs.indexOf(event.currentTarget) + 1]?.focus();
              }
            }} className="h-11 text-right tabular-nums" />
            {invalid && <p className="mt-1 text-xs text-destructive">Ingresa una cantidad válida.</p>}
          </>}</div>
        </div>;
      })}
      {!visible.length && <p className="p-4 text-sm text-muted-foreground">{query ? "No hay coincidencias." : "Todos los lotes están capturados."}</p>}
    </div>
    {!readOnly && <p className="text-xs text-muted-foreground">Usa Tab o Enter para avanzar. Ingresa 0 cuando no encuentres existencias; un campo vacío queda pendiente. Al finalizar se guardará para revisión.</p>}
  </div>;
});
