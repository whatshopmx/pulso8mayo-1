"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { BranchLiveStatus } from "@/lib/services/live-command-service";
import { 
  Store, 
  CheckCircle2, 
  Clock, 
  AlertOctagon, 
  ThermometerSnowflake, 
  Users, 
  DollarSign, 
  Search, 
  ExternalLink,
  ChevronRight
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface LiveCommandMatrixProps {
  branches: BranchLiveStatus[];
}

export function LiveCommandMatrix({ branches }: LiveCommandMatrixProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<"ALL" | "ISSUES_ONLY">("ALL");

  const filteredBranches = useMemo(() => {
    return branches.filter((b) => {
      // Filtro de búsqueda
      const matchesSearch =
        b.branchName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (b.code && b.code.toLowerCase().includes(searchTerm.toLowerCase()));

      if (!matchesSearch) return false;

      // Filtro de solo incidencias
      if (filterMode === "ISSUES_ONLY") {
        const hasOpeningIssue = b.opening.status === "DELAYED";
        // `UNKNOWN` = falta configuración de dotación, no una alerta operativa.
        const hasStaffIssue = b.staff.status !== "NORMAL" && b.staff.status !== "UNKNOWN";
        const hasNomIssue = b.nom251.status !== "OK";
        const hasAlerts = b.activeAlerts.length > 0;
        return hasOpeningIssue || hasStaffIssue || hasNomIssue || hasAlerts;
      }

      return true;
    });
  }, [branches, searchTerm, filterMode]);

  const issuesCount = useMemo(() => {
    return branches.filter((b) => {
      return (
        b.opening.status === "DELAYED" ||
        (b.staff.status !== "NORMAL" && b.staff.status !== "UNKNOWN") ||
        b.nom251.status !== "OK" ||
        b.activeAlerts.length > 0
      );
    }).length;
  }, [branches]);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Barra de control y filtros */}
      <div className="p-4 sm:p-5 border-b border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/20">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight text-foreground">
              Matriz Operativa de Red (3 a 15 Sucursales)
            </h3>
            <Badge variant="outline" className="text-xs font-mono">
              {branches.length} tiendas
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Estado de apertura, dotación de personal, control de frío NOM-251 y ventas del día
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar sucursal..."
              aria-label="Buscar sucursal"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8.5 text-xs pl-8 bg-background"
            />
          </div>

          <div className="flex items-center rounded-lg border border-border/70 p-0.5 bg-background">
            <button
              onClick={() => setFilterMode("ALL")}
              aria-pressed={filterMode === "ALL"}
              className={`px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-md transition-colors ${
                filterMode === "ALL"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Todas ({branches.length})
            </button>
            <button
              onClick={() => setFilterMode("ISSUES_ONLY")}
              aria-pressed={filterMode === "ISSUES_ONLY"}
              className={`px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                filterMode === "ISSUES_ONLY"
                  ? "bg-destructive text-destructive-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>Con Alertas</span>
              {issuesCount > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${
                  filterMode === "ISSUES_ONLY" ? "bg-destructive-foreground/20 text-destructive-foreground" : "bg-destructive/15 text-destructive"
                }`}>
                  {issuesCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Lista / Grid de Sucursales */}
      {filteredBranches.length === 0 ? (
        <div className="p-8 text-center">
          <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">
            {filterMode === "ISSUES_ONLY" 
              ? "Excelente: No hay sucursales con alertas operativas en este momento"
              : "No se encontraron sucursales con los filtros aplicados"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {filterMode === "ISSUES_ONLY" ? "Todas las unidades operan bajo parámetros normales." : "Intenta con otro término de búsqueda."}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {filteredBranches.map((b) => {
            const hasCriticalIssue =
              b.opening.status === "DELAYED" ||
              b.nom251.status === "CRITICAL" ||
              b.staff.status === "CRITICAL" ||
              b.activeAlerts.some((a) => a.severity === "critical");

            const salesMxn = new Intl.NumberFormat("es-MX", {
              style: "currency",
              currency: "MXN",
              maximumFractionDigits: 0,
            }).format(b.sales.totalCents / 100);

            return (
              <div
                key={b.branchId}
                className={`p-4 transition-colors hover:bg-muted/30 ${
                  hasCriticalIssue ? "bg-destructive/5 border border-destructive/20 rounded-md" : ""
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Identidad de la Sucursal */}
                  <div className="flex items-start gap-3 min-w-[220px]">
                    <div className={`p-2 rounded-lg mt-0.5 ${
                      hasCriticalIssue ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"
                    }`}>
                      <Store className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/dashboard/branches/${b.branchId}`}
                          className="text-sm font-bold text-foreground hover:text-primary transition-colors flex items-center gap-1"
                        >
                          {b.branchName}
                          <ExternalLink className="h-3 w-3 text-muted-foreground opacity-70" />
                        </Link>
                        {b.code && (
                          <Badge variant="outline" className="text-xs px-1.5 py-0 font-mono text-muted-foreground">
                            {b.code}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {hasCriticalIssue ? (
                          <span className="text-xs font-medium text-destructive flex items-center gap-1">
                            <AlertOctagon className="h-3 w-3" /> Requiere supervisión
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-success-text flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Operación normal
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 4 Semáforos QSR */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
                    {/* Semáforo 1: Apertura */}
                    <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Apertura
                        </span>
                        {b.opening.status === "ON_TIME" && (
                          <Badge className="bg-success/15 text-success-text border-success/30 text-xs px-1.5 py-0">
                            A tiempo
                          </Badge>
                        )}
                        {b.opening.status === "DELAYED" && (
                          <Badge variant="destructive" className="text-xs px-1.5 py-0">
                            Retraso
                          </Badge>
                        )}
                        {b.opening.status === "PENDING" && (
                          <Badge variant="secondary" className="text-xs px-1.5 py-0">
                            Pendiente
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-foreground mt-1">
                        {b.opening.label}
                      </p>
                    </div>

                    {/* Semáforo 2: Personal */}
                    <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <Users className="h-3 w-3" /> Personal
                        </span>
                        {b.staff.status === "NORMAL" && (
                          <Badge className="bg-info/15 text-info border-info/30 text-xs px-1.5 py-0">
                            Completo
                          </Badge>
                        )}
                        {b.staff.status === "WARNING" && (
                          <Badge className="bg-warning/15 text-warning-text border-warning/30 text-xs px-1.5 py-0">
                            Incompleto
                          </Badge>
                        )}
                        {b.staff.status === "CRITICAL" && (
                          <Badge variant="destructive" className="text-xs px-1.5 py-0">
                            Faltantes
                          </Badge>
                        )}
                        {b.staff.status === "UNKNOWN" && (
                          <Badge variant="secondary" className="text-xs px-1.5 py-0 text-muted-foreground">
                            Sin dotación
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-foreground mt-1">
                        {b.staff.status === "UNKNOWN" ? (
                          <span className="font-normal text-muted-foreground">
                            Sin dotación configurada
                          </span>
                        ) : (
                          <>
                            {b.staff.activeCount} de {b.staff.expectedCount} activos
                            {b.staff.lateCount > 0 && (
                              <span className="text-warning-text text-xs font-normal ml-1">
                                ({b.staff.lateCount} tarde)
                              </span>
                            )}
                          </>
                        )}
                      </p>
                    </div>

                    {/* Semáforo 3: Inocuidad & Frío NOM-251 */}
                    <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <ThermometerSnowflake className="h-3 w-3" /> Frío NOM-251
                        </span>
                        {b.nom251.status === "OK" && (
                          <Badge className="bg-success/15 text-success-text border-success/30 text-xs px-1.5 py-0">
                            Cumple
                          </Badge>
                        )}
                        {b.nom251.status === "WARNING" && (
                          <Badge className="bg-warning/15 text-warning-text border-warning/30 text-xs px-1.5 py-0">
                            Fuera de rango
                          </Badge>
                        )}
                        {b.nom251.status === "NOT_LOGGED" && (
                          <Badge variant="secondary" className="text-xs px-1.5 py-0 text-muted-foreground">
                            Sin registro
                          </Badge>
                        )}
                        {b.nom251.status === "CRITICAL" && (
                          <Badge variant="destructive" className="text-xs px-1.5 py-0 animate-pulse">
                            ¡Fuera de norma!
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-foreground mt-1">
                        {b.nom251.lastTempCelsius !== null
                          ? `${b.nom251.lastTempCelsius}°C último log`
                          : "Sin lectura hoy"}
                      </p>
                    </div>

                    {/* Semáforo 4: Venta del Día POS */}
                    <div className="rounded-lg border border-border/50 bg-background/50 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <DollarSign className="h-3 w-3" /> Venta Hoy
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {b.sales.cutStatus === "VALIDATED" ? "Cerrado" : "En curso"}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-foreground mt-1">
                        {salesMxn}
                      </p>
                    </div>
                  </div>

                  {/* Acciones Rápidas */}
                  <div className="flex items-center gap-2 justify-end">
                    {b.activeAlerts.length > 0 ? (
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-9 min-w-[36px] text-xs font-medium border-destructive/40 text-destructive hover:bg-destructive/10"
                      >
                        <Link href={`/dashboard/exceptions?branch=${b.branchId}`}>
                          Ver {b.activeAlerts.length} alerta{b.activeAlerts.length > 1 ? "s" : ""}
                          <ChevronRight className="h-3 w-3 ml-1" />
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        className="h-9 min-w-[36px] text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        <Link href={`/dashboard/branches/${b.branchId}`}>
                          Ficha 360°
                          <ChevronRight className="h-3 w-3 ml-1" />
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
