"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  useApprovalMatrix,
  useSaveApprovalMatrix,
  type MatrixRule,
} from "@/hooks/queries/use-service-orders";
import { APPROVER_ROLES_HIERARCHY } from "@/lib/permissions";
import { Loader2, Plus, Save, Trash2, RotateCcw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

type DocType = "OC" | "OS";

/** Fila editable en pesos (la BD guarda centavos); amountMaxStr vacío = sin tope. */
interface MatrixRowDraft {
  id?: string;
  amountMinStr: string;
  amountMaxStr: string;
  requiredRole: string;
  minQuotesStr: string;
  sequenceStr: string;
  active: boolean;
}

function ruleToRow(r: MatrixRule): MatrixRowDraft {
  return {
    id: r.id,
    amountMinStr: (r.amountMin / 100).toString(),
    amountMaxStr: r.amountMax === null ? "" : (r.amountMax / 100).toString(),
    requiredRole: r.requiredRole,
    minQuotesStr: String(r.minQuotes),
    sequenceStr: String(r.sequence),
    active: r.active,
  };
}

function rowToRule(row: MatrixRowDraft): MatrixRule | { error: string } {
  const minCents = Math.round(parseFloat(row.amountMinStr || "") * 100);
  const maxCents = row.amountMaxStr.trim() === "" ? null : Math.round(parseFloat(row.amountMaxStr) * 100);
  if (!Number.isFinite(minCents) || minCents < 0) return { error: "Monto mínimo inválido" };
  if (maxCents !== null && (!Number.isFinite(maxCents) || maxCents <= 0)) return { error: "Monto máximo inválido" };
  if (maxCents !== null && maxCents < minCents) return { error: "El máximo no puede ser menor al mínimo" };
  const minQuotes = parseInt(row.minQuotesStr || "", 10);
  if (!Number.isInteger(minQuotes) || minQuotes < 1) return { error: "Cotizaciones mínimas debe ser un entero ≥ 1" };
  const sequence = parseInt(row.sequenceStr || "", 10);
  if (!Number.isInteger(sequence) || sequence < 1) return { error: "La secuencia debe ser un entero ≥ 1" };
  return {
    id: row.id,
    amountMin: minCents,
    amountMax: maxCents,
    requiredRole: row.requiredRole,
    minQuotes,
    sequence,
    active: row.active,
  };
}

// Autoridades de mayor a menor para el select de roles.
const ROLE_OPTIONS = Object.entries(APPROVER_ROLES_HIERARCHY)
  .sort((a, b) => b[1] - a[1])
  .map(([role]) => role);

/**
 * Editor de la matriz de autorización OC/OS (R5, solo ADMIN+).
 * Reglas multi-nivel: rangos TRASLAPADOS con secuencias distintas apilan niveles;
 * traslape con la misma secuencia es rechazado por el API (error inline);
 * huecos entre rangos llegan como warnings no bloqueantes.
 */
export function ApprovalMatrixEditor() {
  const [docType, setDocType] = useState<DocType>("OS");
  const query = useApprovalMatrix(docType);
  const saveMutation = useSaveApprovalMatrix(docType);

  // Patrón borrador: null = mostrar lo del servidor sin copiarlo a estado
  // (sin useEffect de sincronización ni cascadas de render).
  const [draft, setDraft] = useState<MatrixRowDraft[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const rows: MatrixRowDraft[] =
    draft ?? (query.data?.rules ?? []).map(ruleToRow);

  const updateRow = (index: number, patch: Partial<MatrixRowDraft>) => {
    setDraft(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    const maxSeq = Math.max(0, ...rows.map((r) => parseInt(r.sequenceStr || "0", 10) || 0));
    setDraft([...rows, { amountMinStr: "", amountMaxStr: "", requiredRole: "ADMIN", minQuotesStr: "2", sequenceStr: String(maxSeq + 1), active: true }]);
  };

  const removeRow = (index: number) => {
    setDraft(rows.filter((_, i) => i !== index));
  };

  const save = async () => {
    const rules: MatrixRule[] = [];
    for (const row of rows) {
      const converted = rowToRule(row);
      if ("error" in converted) {
        toast.error(converted.error);
        return;
      }
      rules.push(converted);
    }
    try {
      const result = await saveMutation.mutateAsync(rules);
      setDraft(null);
      // Los huecos son legítimos pero deben anunciarse (no bloquean).
      setWarnings(result.warnings ?? []);
      toast.success(`Matriz ${docType} guardada (${result.rules.length} reglas)`);
    } catch (err) {
      // Traslapes y datos inválidos llegan aquí con el mensaje del API.
      setWarnings([]);
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    }
  };

  const switchDocType = (next: DocType) => {
    if (next === docType) return;
    setDocType(next);
    setDraft(null);
    setWarnings([]);
  };

  const dirty = draft !== null;

  return (
    <div className="space-y-4">
      {/* Selector de tipo de documento */}
      <div className="flex items-center gap-1 rounded-lg border p-1 w-fit">
        {(["OS", "OC"] as DocType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchDocType(t)}
            aria-pressed={docType === t}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              docType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {t === "OS" ? "Órdenes de Servicio" : "Órdenes de Compra"}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando matriz…
        </div>
      ) : query.isError ? (
        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertDescription>
            {query.error instanceof Error ? query.error.message : "No se pudo cargar la matriz."}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {warnings.length > 0 && (
            <Alert className="border-amber-600/40 text-amber-700 dark:text-amber-400">
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc pl-4 space-y-0.5">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
                <p className="mt-1">Los montos dentro de un hueco usarán la cadena de autorización default.</p>
              </AlertDescription>
            </Alert>
          )}

          {/* Encabezados */}
          <div className="hidden md:grid md:grid-cols-12 gap-2 px-1">
            <span className="col-span-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Mínimo (MXN)</span>
            <span className="col-span-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Máximo (MXN)</span>
            <span className="col-span-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">Rol aprobador</span>
            <span className="col-span-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Cotiz.</span>
            <span className="col-span-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Secuencia</span>
            <span className="col-span-2 text-xs font-medium text-muted-foreground uppercase tracking-wide text-center">Activa</span>
          </div>

          <div className="space-y-2">
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Sin reglas. Agrega una que cubra desde $0 para habilitar el flujo de autorización.
              </p>
            )}
            {rows.map((row, i) => (
              <div key={row.id ?? `new-${i}`} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-center border-b pb-2 last:border-0 md:border-0 md:pb-0">
                <Input
                  inputMode="decimal"
                  value={row.amountMinStr}
                  onChange={(e) => updateRow(i, { amountMinStr: e.target.value.replace(/[^0-9.]/g, "") })}
                  placeholder="0.00"
                  aria-label={`Regla ${i + 1}: monto mínimo`}
                  className="md:col-span-2"
                />
                <Input
                  inputMode="decimal"
                  value={row.amountMaxStr}
                  onChange={(e) => updateRow(i, { amountMaxStr: e.target.value.replace(/[^0-9.]/g, "") })}
                  placeholder="Sin límite"
                  aria-label={`Regla ${i + 1}: monto máximo`}
                  className="md:col-span-2"
                />
                <Select value={row.requiredRole} onValueChange={(v) => updateRow(i, { requiredRole: v })}>
                  <SelectTrigger aria-label={`Regla ${i + 1}: rol aprobador`} className="md:col-span-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((role) => (
                      <SelectItem key={role} value={role}>{role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  inputMode="numeric"
                  value={row.minQuotesStr}
                  onChange={(e) => updateRow(i, { minQuotesStr: e.target.value.replace(/[^0-9]/g, "") })}
                  aria-label={`Regla ${i + 1}: cotizaciones mínimas`}
                  className="md:col-span-1"
                />
                <Input
                  inputMode="numeric"
                  value={row.sequenceStr}
                  onChange={(e) => updateRow(i, { sequenceStr: e.target.value.replace(/[^0-9]/g, "") })}
                  aria-label={`Regla ${i + 1}: secuencia`}
                  className="md:col-span-1"
                />
                <div className="flex items-center justify-center gap-2 md:col-span-2">
                  <Switch
                    checked={row.active}
                    onCheckedChange={(v) => updateRow(i, { active: v })}
                    aria-label={`Regla ${i + 1}: activa`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRow(i)}
                    aria-label={`Eliminar regla ${i + 1}`}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Multi-nivel: dos reglas con rangos traslapados y secuencias distintas crean una cadena acumulativa
            (ej. GERENTE seq 1 [0–∞] + ADMIN seq 2 [0–∞]). El máximo vacío significa sin límite superior.
          </p>

          <div className="flex flex-wrap gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={addRow}>
              <Plus className="h-4 w-4 mr-1.5" /> Agregar regla
            </Button>
            {dirty && (
              <Button variant="ghost" size="sm" onClick={() => { setDraft(null); setWarnings([]); }}>
                <RotateCcw className="h-4 w-4 mr-1.5" /> Descartar cambios
              </Button>
            )}
            <div className="ml-auto">
              <Button size="sm" onClick={save} disabled={saveMutation.isPending || !dirty}>
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                Guardar cambios
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
