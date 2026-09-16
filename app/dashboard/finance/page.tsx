"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBranch } from "@/lib/branch-context";
import { formatCents, statusBadgeClasses } from "@/lib/utils";
import { computeCashVariance } from "@/lib/sales/cash-variance";
import { CashFlowSummaryCard } from "@/components/finance/cash-flow-summary-card";
import {
  HoyCaseDossier,
  type HoyCaseItem,
  type CaseSourceType,
} from "@/components/finance/hoy-case-dossier";
import {
  Clock,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  Wallet,
  Receipt,
  BarChart3,
  Loader2,
  ChevronRight,
} from "lucide-react";

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

const SEVERITY_ORDER: Record<string, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

export default function FinanceTodayPage() {
  const { selectedBranchId } = useBranch();
  const branchId = selectedBranchId ?? "ALL";

  const [items, setItems] = useState<HoyCaseItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<"ALL" | CaseSourceType>("ALL");

  const loadCases = useCallback(
    async (isCancelled?: () => boolean) => {
      setLoading(true);
      setError(null);
      setFailedSources([]);

      try {
        const url = new URL("/api/finance/attention", window.location.origin);
        if (branchId !== "ALL") url.searchParams.set("branchId", branchId);

        const res = await fetch(url.toString());
        const json = await res.json().catch(() => ({}));

        if (isCancelled?.()) return;

        if (res.ok && json.success) {
          const collected: HoyCaseItem[] = json.data?.items ?? [];
          const statuses = json.data?.sourceStatuses ?? {};
          const failures: string[] = [];
          if (statuses.violations === "unavailable") failures.push("excepciones de control");
          if (statuses.expenses === "unavailable") failures.push("gastos por autorizar");
          if (statuses.cuts === "unavailable") failures.push("arqueos y conciliaciones TPV");
          setFailedSources(failures);

          setItems(collected);
          if (collected.length > 0) {
            setSelectedCaseId((prev) =>
              prev && collected.some((i) => i.id === prev) ? prev : collected[0].id
            );
          } else {
            setSelectedCaseId(null);
          }
        } else {
          setError(json?.error || "No se pudo consultar la bandeja de pendientes financieros.");
          setItems(null);
        }
      } catch (err) {
        if (isCancelled?.()) return;
        console.error("Failed to load today cases:", err);
        setError("Error de conexión al cargar la bandeja de pendientes.");
        setItems(null);
      } finally {
        if (!isCancelled?.()) {
          setLoading(false);
        }
      }
    },
    [branchId]
  );

  useEffect(() => {
    let cancelled = false;
    loadCases(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadCases]);

  // Atajo de teclado para recargar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        loadCases();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loadCases]);

  const handleCaseResolved = (resolvedCaseId: string) => {
    setItems((prev) => {
      if (!prev) return null;
      const next = prev.filter((c) => c.id !== resolvedCaseId);
      if (selectedCaseId === resolvedCaseId) {
        setSelectedCaseId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
  };

  const filteredItems = useMemo(() => {
    if (!items) return [];
    if (activeFilter === "ALL") return items;
    if (activeFilter === "cut") {
      return items.filter(
        (i) => i.sourceType === "cut" || i.sourceType === "cut_cash" || i.sourceType === "cut_tpv"
      );
    }
    return items.filter((i) => i.sourceType === activeFilter);
  }, [items, activeFilter]);

  const selectedCase = useMemo(() => {
    if (!items || !selectedCaseId) return null;
    return items.find((i) => i.id === selectedCaseId) ?? null;
  }, [items, selectedCaseId]);

  const counts = useMemo(() => {
    const all = items ?? [];
    return {
      total: all.length,
      high: all.filter((i) => i.severity === "HIGH").length,
      expense: all.filter((i) => i.sourceType === "expense").length,
      cut: all.filter(
        (i) => i.sourceType === "cut" || i.sourceType === "cut_cash" || i.sourceType === "cut_tpv"
      ).length,
      violation: all.filter((i) => i.sourceType === "violation").length,
    };
  }, [items]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Encabezado del espacio Hoy */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Clock className="h-7 w-7 text-primary" /> Hoy
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full border border-border bg-muted font-medium">
              Bandeja de acción
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1 max-w-[75ch]">
            Todo lo que requiere revisión, firma o resolución en tu operación hoy. Selecciona un caso para ver su expediente y resolverlo sin salir.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild className="h-9 text-xs gap-1.5 font-medium">
            <Link href="/dashboard/finance/results">
              <BarChart3 className="w-4 h-4 text-primary" /> Ver Resultados (P&L)
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadCases()}
            disabled={loading}
            className="h-9 text-xs gap-1.5"
            title="Recargar bandeja (Ctrl+Shift+R)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Recargar</span>
          </Button>
        </div>
      </div>

      {/* Chips de filtro / resumen de pendientes */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
        <button
          type="button"
          onClick={() => setActiveFilter("ALL")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
            activeFilter === "ALL"
              ? "bg-foreground text-background border-foreground font-semibold"
              : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          <span>Todos</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-muted/30">
            {counts.total}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter("expense")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
            activeFilter === "expense"
              ? "bg-foreground text-background border-foreground font-semibold"
              : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          <Receipt className="w-3.5 h-3.5" />
          <span>Gastos por autorizar</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-muted/30">
            {counts.expense}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter("cut")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
            activeFilter === "cut"
              ? "bg-foreground text-background border-foreground font-semibold"
              : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          <Wallet className="w-3.5 h-3.5" />
          <span>Diferencias en arqueo</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-muted/30">
            {counts.cut}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveFilter("violation")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
            activeFilter === "violation"
              ? "bg-foreground text-background border-foreground font-semibold"
              : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Control interno</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-muted/30">
            {counts.violation}
          </span>
        </button>

        {counts.high > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-destructive/20 bg-destructive/10 text-destructive font-semibold shrink-0">
            <AlertCircle className="w-3.5 h-3.5" /> {counts.high} caso{counts.high === 1 ? "" : "s"} crítico{counts.high === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Aviso de fallos parciales o truncamiento */}
      {failedSources.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3.5 py-2.5 text-xs text-warning-text">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">
            Información parcial: no se pudieron consultar o están truncados{" "}
            {failedSources.join(" ni ")}. La bandeja puede no reflejar el total absoluto.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadCases()}
            className="h-6 px-2 text-xs"
          >
            Reintentar
          </Button>
        </div>
      )}

      {/* Zona principal: Maestro - Detalle (Split view) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Bandeja de pendientes (Izquierda, 7 cols) */}
        <div className="lg:col-span-7 space-y-3">
          <Card className="border-border">
            <CardHeader className="pb-3 border-b border-border/50">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <span>Pendientes ({filteredItems.length})</span>
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  Ordenado por urgencia e importe
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-3">
              {loading ? (
                <div className="py-16 flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span>Cargando bandeja operativa...</span>
                </div>
              ) : error ? (
                <div className="py-12 flex flex-col items-center text-center gap-3">
                  <p className="text-sm text-muted-foreground">{error}</p>
                  <Button variant="outline" size="sm" onClick={() => loadCases()}>
                    Reintentar
                  </Button>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="py-16 flex flex-col items-center text-center gap-2">
                  <CheckCircle2 className="w-10 h-10 text-success" />
                  <p className="text-sm font-semibold">Sin pendientes en este filtro</p>
                  <p className="text-xs text-muted-foreground max-w-sm">
                    No hay casos abiertos que requieran tu atención en la sucursal seleccionada.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredItems.map((item) => {
                    const isSelected = item.id === selectedCaseId;

                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedCaseId(item.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedCaseId(item.id);
                          }
                        }}
                        className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
                          isSelected
                            ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                            : "border-border hover:bg-muted/40 hover:border-muted-foreground/30"
                        }`}
                      >
                        <span
                          className={`mt-0.5 shrink-0 rounded-full border p-1.5 ${statusBadgeClasses(
                            item.severity === "HIGH"
                              ? "destructive"
                              : item.severity === "MEDIUM"
                                ? "warning"
                                : "neutral"
                          )}`}
                        >
                          {item.sourceType === "expense" ? (
                            <Receipt className="w-3.5 h-3.5" />
                          ) : item.sourceType === "cut" ? (
                            <Wallet className="w-3.5 h-3.5" />
                          ) : (
                            <ShieldAlert className="w-3.5 h-3.5" />
                          )}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-semibold truncate text-foreground">
                              {item.title}
                            </span>
                            {item.amountCents !== null && (
                              <span className="text-sm font-bold tabular-nums shrink-0 text-foreground">
                                {formatCents(item.amountCents)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                            {item.detail}
                          </p>
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-2">
                            <span>{item.branchName || "Sucursal"}</span>
                            <span>•</span>
                            <span>{item.dateOrAge || "Hoy"}</span>
                            {item.requiredRole && (
                              <>
                                <span>•</span>
                                <span className="font-medium text-foreground/80">
                                  Firma: {item.requiredRole}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <ChevronRight
                          className={`w-4 h-4 shrink-0 mt-2 transition-transform ${
                            isSelected ? "text-primary translate-x-0.5" : "text-muted-foreground/50"
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Panel lateral: Expediente del caso seleccionado (Derecha, 5 cols) */}
        <div className="lg:col-span-5 sticky top-16">
          <HoyCaseDossier
            selectedCase={selectedCase}
            onCaseResolved={handleCaseResolved}
          />
        </div>
      </div>

      {/* Sección inferior: Liquidez y proyección a 30 días */}
      <div className="pt-4 border-t border-border">
        <CashFlowSummaryCard branchId={branchId} />
      </div>
    </div>
  );
}
