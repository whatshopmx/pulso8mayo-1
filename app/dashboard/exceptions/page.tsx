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
import { PageContainer, PageHeader, EmptyState, ErrorState, DataTableSkeleton } from "@/components/shared";
import {
  ArrowRight,
  RefreshCw,
  Coins,
  ShieldAlert,
  PackageX,
  Users,
  AlertTriangle,
  MessageCircle,
  Store,
  ExternalLink,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type {
  ExceptionDomain,
  ExceptionSeverity,
  GroupException,
  QsrRiskCategory,
} from "@/lib/services/group-exceptions-service";

const QSR_CATEGORIES: {
  id: QsrRiskCategory | "ALL";
  label: string;
  icon: typeof Coins;
  description: string;
}[] = [
  { id: "ALL", label: "Todas las Alertas", icon: AlertTriangle, description: "Visión integral de excepciones en la red" },
  { id: "DINERO", label: "Dinero & Caja", icon: Coins, description: "Arqueos descuadrados, TPVs y cancelaciones" },
  { id: "INOCUIDAD", label: "Inocuidad & Frío", icon: ShieldAlert, description: "NOM-251, temperaturas y auditorías" },
  { id: "ABASTO", label: "Mermas & Stock", icon: PackageX, description: "Desabasto en turno y mermas anómalas" },
  { id: "PERSONAL", label: "Personal & Turnos", icon: Users, description: "Faltas, retardos y cobertura de plantilla" },
];

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

const CATEGORY_STYLES: Record<QsrRiskCategory, { badge: string; text: string }> = {
  DINERO: { badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", text: "text-emerald-700 dark:text-emerald-400" },
  INOCUIDAD: { badge: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30", text: "text-rose-700 dark:text-rose-400" },
  ABASTO: { badge: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30", text: "text-purple-700 dark:text-purple-400" },
  PERSONAL: { badge: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30", text: "text-blue-700 dark:text-blue-400" },
};

export default function ExceptionsPage() {
  const [exceptions, setExceptions] = useState<GroupException[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeCategory, setActiveCategory] = useState<QsrRiskCategory | "ALL">("ALL");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

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

  // Lista única de sucursales para el filtro
  const branchList = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of exceptions) {
      if (e.branchId && e.branchName) {
        map.set(e.branchId, e.branchName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [exceptions]);

  // Conteo por categoría
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      ALL: exceptions.length,
      DINERO: 0,
      INOCUIDAD: 0,
      ABASTO: 0,
      PERSONAL: 0,
    };
    for (const e of exceptions) {
      if (e.qsrCategory) {
        counts[e.qsrCategory] = (counts[e.qsrCategory] || 0) + 1;
      }
    }
    return counts;
  }, [exceptions]);

  // Filtrado compuesto
  const filtered = useMemo(() => {
    return exceptions.filter((e) => {
      if (activeCategory !== "ALL" && e.qsrCategory !== activeCategory) {
        return false;
      }
      if (branchFilter !== "all" && e.branchId !== branchFilter) {
        return false;
      }
      if (severityFilter !== "all") {
        if (severityFilter === "critical_fatal" && e.severity !== "critical" && e.severity !== "fatal") {
          return false;
        }
        if (severityFilter === "high" && e.severity !== "high") {
          return false;
        }
      }
      return true;
    });
  }, [exceptions, activeCategory, branchFilter, severityFilter]);

  return (
    <PageContainer>
      <PageHeader
        title="Centro de Excepciones & Riesgos"
        description="Triage operativo de la red de sucursales: resuelve desviaciones de caja, cadena de frío, desabastos y personal en tiempo real."
        actions={
          <Button variant="outline" size="sm" onClick={fetchExceptions} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        }
      />

      {/* Pestañas de categorías QSR con contadores */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {QSR_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const count = categoryCounts[cat.id] ?? 0;
          const isSelected = activeCategory === cat.id;

          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex flex-col text-left p-3.5 rounded-xl border transition-all ${
                isSelected
                  ? "bg-card border-primary ring-2 ring-primary/20 shadow-sm"
                  : "bg-muted/30 hover:bg-muted/60 border-border/70 text-muted-foreground"
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                  <span className={`text-xs font-semibold ${isSelected ? "text-foreground" : ""}`}>
                    {cat.label}
                  </span>
                </div>
                <Badge
                  variant={isSelected ? "default" : "secondary"}
                  className="text-xs px-1.5 py-0 h-5 min-w-[20px] flex items-center justify-center font-bold"
                >
                  {count}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-1">
                {cat.description}
              </p>
            </button>
          );
        })}
      </div>

      {/* Filtros secundarios: Sucursal y Severidad */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Todas las sucursales" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las sucursales</SelectItem>
            {branchList.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Severidad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las severidades</SelectItem>
            <SelectItem value="critical_fatal">Críticas y Fatales</SelectItem>
            <SelectItem value="high">Altas</SelectItem>
          </SelectContent>
        </Select>

        {!loading && !error && (
          <span className="text-xs text-muted-foreground ml-auto">
            Mostrando {filtered.length} de {exceptions.length} excepciones activas
          </span>
        )}
      </div>

      {/* Lista de excepciones QSR con resolución en 1 clic */}
      {loading ? (
        <DataTableSkeleton />
      ) : error ? (
        <ErrorState
          message="No se pudieron cargar las excepciones de la red."
          onRetry={fetchExceptions}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Store}
          title="Sin excepciones activas"
          description="Excelente: no se detectan desvíos en caja, frío, insumos ni plantilla con los filtros seleccionados."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const catStyle = CATEGORY_STYLES[item.qsrCategory] || CATEGORY_STYLES.INOCUIDAD;
            const action = item.action;

            return (
              <Card
                key={`${item.sourceTable}-${item.id}`}
                className="hover:border-primary/40 transition-colors shadow-xs"
              >
                <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={SEVERITY_STYLES[item.severity]}>
                        {SEVERITY_LABELS[item.severity]}
                      </Badge>
                      <Badge variant="outline" className={catStyle.badge}>
                        {item.qsrCategory}
                      </Badge>
                      {item.branchName && (
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1">
                          <Store className="w-3 h-3 text-muted-foreground" />
                          {item.branchName}
                        </span>
                      )}
                      {item.detectedAt && (
                        <span className="text-xs text-muted-foreground">
                          · hace {formatDistanceToNow(new Date(item.detectedAt), { locale: es })}
                        </span>
                      )}
                    </div>

                    <p className="text-sm font-semibold text-foreground">
                      {item.title}
                    </p>

                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {item.description}
                      </p>
                    )}

                    {item.estimatedImpact && (
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted/60 text-[11px] font-medium text-muted-foreground mt-1">
                        <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                        <span>{item.estimatedImpact}</span>
                      </div>
                    )}
                  </div>

                  {/* Acciones resolutivas en 1 clic */}
                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                    {action && action.whatsappSuggestedMessage && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-8 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                        onClick={() => {
                          const url = `https://wa.me/?text=${encodeURIComponent(action.whatsappSuggestedMessage!)}`;
                          window.open(url, "_blank");
                        }}
                      >
                        <MessageCircle className="w-3.5 h-3.5 mr-1" />
                        Avisar Gerente
                      </Button>
                    )}

                    <Button asChild size="sm" className="text-xs h-8">
                      <Link href={action?.url || item.deepLinkUrl}>
                        {action?.label || "Resolver"}
                        <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
