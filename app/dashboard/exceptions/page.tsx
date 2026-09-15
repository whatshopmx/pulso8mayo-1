"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { PageContainer, PageHeader, EmptyState, ErrorState } from "@/components/shared";
import { DataTableSkeleton } from "@/components/shared";
import { ArrowRight, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type {
  ExceptionDomain,
  ExceptionSeverity,
  GroupException,
} from "@/lib/services/group-exceptions-service";

const DOMAIN_LABELS: Record<ExceptionDomain, string> = {
  operacion: "Operación",
  cumplimiento: "Cumplimiento",
  equipos: "Equipos",
  personal: "Personal",
  inventario: "Inventario",
};

const SEVERITY_LABELS: Record<ExceptionSeverity, string> = {
  fatal: "Fatal",
  critical: "Crítico",
  high: "Alto",
  warning: "Advertencia",
  info: "Info",
};

const SEVERITY_STYLES: Record<ExceptionSeverity, string> = {
  fatal: "bg-destructive/15 text-destructive border-destructive/30",
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  high: "bg-warning/15 text-warning-text border-warning/30",
  warning: "bg-info/10 text-info border-info/20",
  info: "bg-muted text-muted-foreground border-muted-foreground/20",
};

export default function ExceptionsPage() {
  const [exceptions, setExceptions] = useState<GroupException[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<"domain" | "branch">("domain");

  const fetchExceptions = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      const res = await fetch("/api/group/exceptions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setExceptions(json.data ?? []);
    } catch (err) {
      console.error("Error loading group exceptions:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExceptions();
  }, [fetchExceptions]);

  const filtered = useMemo(
    () =>
      domainFilter === "all"
        ? exceptions
        : exceptions.filter((e) => e.domain === domainFilter),
    [exceptions, domainFilter],
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, GroupException[]>();
    for (const item of filtered) {
      const key =
        groupBy === "domain"
          ? DOMAIN_LABELS[item.domain]
          : item.branchName || "Sin sucursal";
      const bucket = groups.get(key) ?? [];
      bucket.push(item);
      groups.set(key, bucket);
    }
    return Array.from(groups.entries());
  }, [filtered, groupBy]);

  return (
    <PageContainer>
      <PageHeader
        title="Centro de Excepciones"
        description="Todo lo que necesita atención en el grupo, en un solo lugar — de cualquier sucursal, de cualquier área."
        actions={
          <Button variant="outline" size="sm" onClick={fetchExceptions} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={domainFilter} onValueChange={setDomainFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Área" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las áreas</SelectItem>
            {Object.entries(DOMAIN_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as "domain" | "branch")}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Agrupar por" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="domain">Agrupar por área</SelectItem>
            <SelectItem value="branch">Agrupar por sucursal</SelectItem>
          </SelectContent>
        </Select>

        {!loading && !error && (
          <span className="text-sm text-muted-foreground">
            {filtered.length} excepción{filtered.length === 1 ? "" : "es"} abierta
            {filtered.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {loading ? (
        <DataTableSkeleton />
      ) : error ? (
        <ErrorState message="No se pudieron cargar las excepciones del grupo." onRetry={fetchExceptions} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Todo al día"
          description="No hay excepciones abiertas en el grupo con este filtro."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([groupLabel, items]) => (
            <div key={groupLabel} className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {groupLabel}
                <span className="ml-2 font-normal normal-case text-xs">({items.length})</span>
              </h3>
              <Card>
                <CardContent className="p-0 divide-y">
                  {items.map((item) => (
                    <Link
                      key={`${item.sourceTable}-${item.id}`}
                      href={item.deepLinkUrl}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 hover:bg-muted/40 transition-colors"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={SEVERITY_STYLES[item.severity]}>
                            {SEVERITY_LABELS[item.severity]}
                          </Badge>
                          <span className="text-xs font-semibold text-muted-foreground">
                            {DOMAIN_LABELS[item.domain]}
                            {item.branchName ? ` · ${item.branchName}` : ""}
                          </span>
                        </div>
                        <p className="text-sm font-medium truncate text-foreground">
                          {item.title}
                        </p>
                        {item.detectedAt && (
                          <p className="text-xs text-muted-foreground">
                            Detectado hace{" "}
                            {formatDistanceToNow(new Date(item.detectedAt), { locale: es })}
                          </p>
                        )}
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </Link>
                  ))}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
