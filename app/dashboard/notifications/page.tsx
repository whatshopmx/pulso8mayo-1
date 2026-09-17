"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bell,
  Check,
  CheckCheck,
  Inbox,
  Search,
  ArrowRight,
  RotateCcw,
  SlidersHorizontal,
  ShieldAlert,
  Package,
  Users,
  Wrench,
  Sparkles,
  X,
} from "lucide-react";
import { PageHeader, PageContainer } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useNotifications, type Notification } from "@/hooks/use-notifications";
import { formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

type CategoriaFiltro =
  | "todas"
  | "no-leidas"
  | "calidad"
  | "inventario"
  | "turnos"
  | "mantenimiento";

type CategoriaModulo = "calidad" | "inventario" | "turnos" | "mantenimiento" | "sistema";

interface CategoriaConfig {
  id: CategoriaFiltro;
  etiqueta: string;
  icono: React.ComponentType<{ className?: string }>;
}

const CATEGORIAS: CategoriaConfig[] = [
  { id: "todas", etiqueta: "Todas", icono: Bell },
  { id: "no-leidas", etiqueta: "Sin leer", icono: Sparkles },
  { id: "calidad", etiqueta: "Calidad NOM-251", icono: ShieldAlert },
  { id: "inventario", etiqueta: "Inventario", icono: Package },
  { id: "turnos", etiqueta: "Turnos y RH", icono: Users },
  { id: "mantenimiento", etiqueta: "Mantenimiento", icono: Wrench },
];

function detectarCategoria(n: Notification): CategoriaModulo {
  const texto = `${n.title} ${n.message} ${n.actionUrl ?? ""}`.toLowerCase();

  if (
    texto.includes("nom-251") ||
    texto.includes("temperatura") ||
    texto.includes("cámara") ||
    texto.includes("camara") ||
    texto.includes("higiene") ||
    texto.includes("sanidad") ||
    texto.includes("bitacora") ||
    texto.includes("bitácora") ||
    texto.includes("inspeccion") ||
    texto.includes("inspección") ||
    texto.includes("auditoria") ||
    texto.includes("auditoría") ||
    texto.includes("alimento") ||
    texto.includes("desinfeccion") ||
    texto.includes("desinfección")
  ) {
    return "calidad";
  }

  if (
    texto.includes("stock") ||
    texto.includes("inventario") ||
    texto.includes("merma") ||
    texto.includes("recepcion") ||
    texto.includes("recepción") ||
    texto.includes("proveedor") ||
    texto.includes("reorden") ||
    texto.includes("almacen") ||
    texto.includes("almacén")
  ) {
    return "inventario";
  }

  if (
    texto.includes("turno") ||
    texto.includes("asistencia") ||
    texto.includes("retardo") ||
    texto.includes("falta") ||
    texto.includes("imss") ||
    texto.includes("nomina") ||
    texto.includes("nómina") ||
    texto.includes("vacacion") ||
    texto.includes("vacación") ||
    texto.includes("personal") ||
    texto.includes("empleado")
  ) {
    return "turnos";
  }

  if (
    texto.includes("mantenimiento") ||
    texto.includes("equipo") ||
    texto.includes("reparacion") ||
    texto.includes("reparación") ||
    texto.includes("falla") ||
    texto.includes("preventivo") ||
    texto.includes("calibracion") ||
    texto.includes("calibración")
  ) {
    return "mantenimiento";
  }

  return "sistema";
}

const ETIQUETA_MODULO: Record<CategoriaModulo, string> = {
  calidad: "NOM-251",
  inventario: "Inventario",
  turnos: "RH y Turnos",
  mantenimiento: "Equipo",
  sistema: "Operación",
};

export default function NotificationsPage() {
  const {
    notifications,
    unreadCount,
    isLoading,
    isMutating,
    mutatingId,
    markAsRead,
    markAllAsRead,
  } = useNotifications({ limit: 100 });

  const [categoria, setCategoria] = React.useState<CategoriaFiltro>("todas");
  const [busqueda, setBusqueda] = React.useState("");

  // Métricas por categoría para los chips de filtro
  const conteosPorCategoria = React.useMemo(() => {
    const counts: Record<CategoriaFiltro, number> = {
      todas: notifications.length,
      "no-leidas": unreadCount,
      calidad: 0,
      inventario: 0,
      turnos: 0,
      mantenimiento: 0,
    };

    for (const n of notifications) {
      const cat = detectarCategoria(n);
      if (cat === "calidad") counts.calidad++;
      else if (cat === "inventario") counts.inventario++;
      else if (cat === "turnos") counts.turnos++;
      else if (cat === "mantenimiento") counts.mantenimiento++;
    }

    return counts;
  }, [notifications, unreadCount]);

  // Filtrado compuesto: categoría + búsqueda
  const visibles = React.useMemo(() => {
    return notifications.filter((n) => {
      // Filtro de categoría
      if (categoria === "no-leidas" && n.read) return false;
      if (categoria !== "todas" && categoria !== "no-leidas") {
        const cat = detectarCategoria(n);
        if (cat !== categoria) return false;
      }

      // Filtro de texto de búsqueda
      if (busqueda.trim()) {
        const query = busqueda.toLowerCase().trim();
        const texto = `${n.title} ${n.message} ${n.actionLabel ?? ""}`.toLowerCase();
        if (!texto.includes(query)) return false;
      }

      return true;
    });
  }, [notifications, categoria, busqueda]);

  // Chunking temporal: Hoy, Ayer, Anteriores
  const gruposTemporales = React.useMemo(() => {
    const hoy: Notification[] = [];
    const ayer: Notification[] = [];
    const anteriores: Notification[] = [];

    for (const n of visibles) {
      const date = new Date(n.createdAt);
      if (isToday(date)) {
        hoy.push(n);
      } else if (isYesterday(date)) {
        ayer.push(n);
      } else {
        anteriores.push(n);
      }
    }

    return [
      { id: "hoy", titulo: "Hoy", items: hoy },
      { id: "ayer", titulo: "Ayer", items: ayer },
      { id: "anteriores", titulo: "Anteriores", items: anteriores },
    ].filter((g) => g.items.length > 0);
  }, [visibles]);

  return (
    <PageContainer>
      <PageHeader
        title="Centro de Alertas y Notificaciones"
        description="Supervisión de incidentes NOM-251, escalaciones de inventario y tareas de sucursales."
        icon={Bell}
        badge={unreadCount > 0 ? `${unreadCount} pendientes` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <Link href="/dashboard/profile">
                <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
                Preferencias
              </Link>
            </Button>
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAllAsRead()}
                disabled={isMutating}
                className="text-xs font-medium"
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1.5 text-primary" />
                Marcar todo como leído
              </Button>
            )}
          </div>
        }
      />

      {/* Barra de Filtros Operacionales y Búsqueda */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Pills de Categorías Operativas */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {CATEGORIAS.map((cat) => {
              const Icono = cat.icono;
              const count = conteosPorCategoria[cat.id];
              const activo = categoria === cat.id;

              return (
                <button
                  key={cat.id}
                  onClick={() => setCategoria(cat.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors border",
                    activo
                      ? "bg-foreground text-background border-foreground shadow-none"
                      : "bg-background text-muted-foreground border-border hover:text-foreground hover:bg-muted/50",
                  )}
                >
                  <Icono className="h-3.5 w-3.5 shrink-0" />
                  <span>{cat.etiqueta}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold leading-none",
                        activo
                          ? "bg-background text-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Buscador Rápido */}
          <div className="relative w-full sm:w-64 shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar alertas o folio..."
              className="h-8 pl-8 pr-7 text-xs bg-card"
            />
            {busqueda && (
              <button
                onClick={() => setBusqueda("")}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Contenido de Notificaciones */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : visibles.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={
            busqueda
              ? "Sin coincidencias de búsqueda"
              : categoria === "no-leidas"
                ? "Bandeja al día"
                : "Sin avisos en esta categoría"
          }
          description={
            busqueda
              ? `No se encontraron alertas con el término "${busqueda}".`
              : categoria === "no-leidas"
                ? "No tienes alertas operativas pendientes de confirmación."
                : "Cuando se generen tareas, incidencias o alertas en esta área, aparecerán aquí."
          }
          action={
            busqueda || categoria !== "todas" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBusqueda("");
                  setCategoria("todas");
                }}
                className="text-xs"
              >
                Restablecer filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {gruposTemporales.map((grupo) => (
            <div key={grupo.id} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {grupo.titulo}
                </span>
                <span className="text-xs text-muted-foreground/70">
                  ({grupo.items.length})
                </span>
                <div className="flex-1 h-px bg-border/60 ml-2" />
              </div>

              <div className="space-y-2">
                {grupo.items.map((n) => {
                  const modulo = detectarCategoria(n);
                  const isItemMutating = isMutating && mutatingId === n.id;

                  return (
                    <Card
                      key={n.id}
                      className={cn(
                        "transition-colors border",
                        !n.read
                          ? "bg-card border-border border-l-2 border-l-primary/80"
                          : "bg-muted/15 border-border/70 opacity-90",
                      )}
                    >
                      <CardContent className="p-4 sm:p-4.5">
                        <div className="flex items-start gap-3">
                          {/* Indicador No Leído Accesible */}
                          <div className="pt-0.5 shrink-0">
                            {!n.read ? (
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full bg-destructive"
                                title="Alerta no leída"
                              >
                                <span className="sr-only">No leída</span>
                              </span>
                            ) : (
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-full bg-transparent"
                                aria-hidden="true"
                              />
                            )}
                          </div>

                          {/* Contenido Central */}
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p
                                className={cn(
                                  "text-sm leading-tight text-foreground",
                                  !n.read ? "font-semibold" : "font-medium",
                                )}
                              >
                                {n.title}
                              </p>

                              {/* Badge Semántico de Severidad */}
                              <Badge
                                variant={
                                  n.type === "error"
                                    ? "destructive"
                                    : "outline"
                                }
                                className={cn(
                                  "text-xs px-2 py-0.5 font-medium",
                                  n.type === "warning" &&
                                    "border-amber-500/40 text-amber-700 bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30",
                                  n.type === "success" &&
                                    "border-emerald-500/40 text-emerald-700 bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30",
                                )}
                              >
                                {n.type === "error"
                                  ? "Crítico"
                                  : n.type === "warning"
                                    ? "Aviso"
                                    : n.type === "success"
                                      ? "Listo"
                                      : "Info"}
                              </Badge>

                              {/* Tag Operativo de Módulo */}
                              <span className="text-xs font-medium text-muted-foreground/80 px-1.5 py-0.5 rounded bg-muted/60">
                                {ETIQUETA_MODULO[modulo]}
                              </span>
                            </div>

                            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                              {n.message}
                            </p>

                            <p className="text-xs text-muted-foreground/80 pt-0.5">
                              {formatDistanceToNow(new Date(n.createdAt), {
                                addSuffix: true,
                                locale: es,
                              })}
                            </p>
                          </div>

                          {/* Acciones Desacopladas (Triage en Sitio + Navegación Explícita) */}
                          <div className="flex items-center gap-1.5 shrink-0 pl-1 self-center sm:self-start">
                            {/* Botón en sitio para Marcar / Reabrir */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground shrink-0 gap-1"
                              title={
                                n.read
                                  ? "Marcar como no leída"
                                  : "Marcar como atendida"
                              }
                              onClick={() => markAsRead(n.id, !n.read)}
                              disabled={isItemMutating}
                            >
                              {n.read ? (
                                <>
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  <span className="hidden md:inline">Reabrir</span>
                                </>
                              ) : (
                                <>
                                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                  <span className="hidden md:inline">Atendida</span>
                                </>
                              )}
                              <span className="sr-only">
                                {n.read
                                  ? "Marcar como no leída"
                                  : "Marcar como atendida"}
                              </span>
                            </Button>

                            {/* Botón Explícito de Navegación */}
                            {n.actionUrl && (
                              <Button
                                asChild
                                variant="outline"
                                size="sm"
                                className="h-8 px-2.5 text-xs font-medium shrink-0 gap-1.5 border-border hover:bg-muted/70"
                                onClick={() => {
                                  if (!n.read) markAsRead(n.id, true);
                                }}
                              >
                                <Link href={n.actionUrl}>
                                  <span>{n.actionLabel || "Atender"}</span>
                                  <ArrowRight className="h-3 w-3" />
                                </Link>
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
