"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { PageHeader, PageContainer } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotifications } from "@/hooks/use-notifications";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

type Filtro = "todas" | "no-leidas";

const TIPO_VARIANTE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  error: "destructive",
  warning: "secondary",
  success: "outline",
  info: "outline",
};

const TIPO_ETIQUETA: Record<string, string> = {
  error: "Error",
  warning: "Aviso",
  success: "Listo",
  info: "Info",
};

export default function NotificationsPage() {
  const { notifications, unreadCount, isLoading, markAsRead, markAllAsRead } =
    useNotifications({ limit: 100 });
  const [filtro, setFiltro] = React.useState<Filtro>("todas");

  const visibles = React.useMemo(
    () => (filtro === "no-leidas" ? notifications.filter((n) => !n.read) : notifications),
    [notifications, filtro],
  );

  return (
    <PageContainer>
      <PageHeader
        title="Notificaciones"
        description="Avisos de incidentes, escalaciones y tareas pendientes."
        icon={Bell}
        badge={unreadCount > 0 ? `${unreadCount} sin leer` : undefined}
        actions={
          unreadCount > 0 ? (
            <Button variant="outline" size="sm" onClick={() => markAllAsRead()}>
              <CheckCheck className="h-4 w-4 mr-2" />
              Marcar todo como leído
            </Button>
          ) : undefined
        }
      />

      <div className="flex gap-2">
        <Button
          variant={filtro === "todas" ? "default" : "outline"}
          size="sm"
          onClick={() => setFiltro("todas")}
        >
          Todas
        </Button>
        <Button
          variant={filtro === "no-leidas" ? "default" : "outline"}
          size="sm"
          onClick={() => setFiltro("no-leidas")}
        >
          Sin leer{unreadCount > 0 ? ` (${unreadCount})` : ""}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : visibles.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={filtro === "no-leidas" ? "Nada sin leer" : "Sin notificaciones"}
          description={
            filtro === "no-leidas"
              ? "Ya revisaste todo lo pendiente."
              : "Cuando se detecte un incidente o se escale una tarea, el aviso aparece aquí."
          }
        />
      ) : (
        <div className="space-y-2">
          {visibles.map((n) => {
            const cuerpo = (
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  {!n.read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  )}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium leading-none">{n.title}</p>
                      <Badge variant={TIPO_VARIANTE[n.type] ?? "outline"} className="text-xs">
                        {TIPO_ETIQUETA[n.type] ?? n.type}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{n.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(n.createdAt), {
                        addSuffix: true,
                        locale: es,
                      })}
                    </p>
                  </div>
                  {n.actionLabel && (
                    <span className="text-xs text-primary shrink-0">{n.actionLabel}</span>
                  )}
                </div>
              </CardContent>
            );

            return (
              <Card
                key={n.id}
                className={`transition-colors ${!n.read ? "bg-muted/40" : ""} ${
                  n.actionUrl ? "hover:bg-muted/60 cursor-pointer" : ""
                }`}
                onClick={() => {
                  if (!n.read) markAsRead(n.id);
                }}
              >
                {n.actionUrl ? (
                  <Link href={n.actionUrl} className="block">
                    {cuerpo}
                  </Link>
                ) : (
                  cuerpo
                )}
              </Card>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
