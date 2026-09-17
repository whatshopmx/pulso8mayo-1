"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: "info" | "warning" | "error" | "success";
  actionUrl: string | null;
  actionLabel: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

const POLL_INTERVAL = 30_000;

interface UseNotificationsOptions {
  /** Cuántas notificaciones traer. El bell muestra 10; la página lista más. */
  limit?: number;
}

export function useNotifications({ limit = 20 }: UseNotificationsOptions = {}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/notifications?limit=${limit}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) {
        throw new Error("No se pudieron cargar las notificaciones");
      }
      const json = await res.json();
      setNotifications(json.data || []);
      setUnreadCount(json.unreadCount ?? 0);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      // Error silencioso en polling, pero logueado para depuración
      console.warn("[useNotifications] Error al obtener notificaciones:", err);
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  const markAsRead = useCallback(
    async (id: string, targetReadState: boolean = true) => {
      // Instant snapshot for optimistic rollback
      const prevNotifications = [...notifications];
      const prevUnreadCount = unreadCount;
      const targetItem = notifications.find((n) => n.id === id);

      if (!targetItem || targetItem.read === targetReadState) {
        return;
      }

      setMutatingId(id);

      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id
            ? {
                ...n,
                read: targetReadState,
                readAt: targetReadState ? new Date().toISOString() : null,
              }
            : n,
        ),
      );
      setUnreadCount((prev) =>
        targetReadState ? Math.max(0, prev - 1) : prev + 1,
      );

      try {
        const res = await fetch(`/api/notifications/${id}/read`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ read: targetReadState }),
          credentials: "include",
        });

        if (!res.ok) {
          throw new Error("Error en el servidor al actualizar notificación");
        }
      } catch (err) {
        console.error("[useNotifications] Error en markAsRead:", err);
        // Rollback optimistic state
        setNotifications(prevNotifications);
        setUnreadCount(prevUnreadCount);
        toast.error("No se pudo actualizar la notificación. Revisa tu conexión.");
      } finally {
        setMutatingId(null);
      }
    },
    [notifications, unreadCount],
  );

  const markAllAsRead = useCallback(async () => {
    if (unreadCount === 0) return;

    const prevNotifications = [...notifications];
    const prevUnreadCount = unreadCount;
    const unreadItems = prevNotifications.filter((n) => !n.read);

    setIsMutating(true);

    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => ({
        ...n,
        read: true,
        readAt: new Date().toISOString(),
      })),
    );
    setUnreadCount(0);

    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllAsRead: true }),
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error("Error al marcar todas las notificaciones como leídas");
      }

      toast.success("Todas las notificaciones marcadas como leídas", {
        action: {
          label: "Deshacer",
          onClick: async () => {
            // Restore local optimistic state immediately
            setNotifications(prevNotifications);
            setUnreadCount(prevUnreadCount);

            // Rollback on server
            try {
              await Promise.allSettled(
                unreadItems.map((item) =>
                  fetch(`/api/notifications/${item.id}/read`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ read: false }),
                    credentials: "include",
                  }),
                ),
              );
              toast.info("Se restauraron las notificaciones no leídas.");
            } catch {
              toast.error("No se pudieron restaurar todas las notificaciones.");
            }
          },
        },
      });
    } catch (err) {
      console.error("[useNotifications] Error en markAllAsRead:", err);
      // Rollback
      setNotifications(prevNotifications);
      setUnreadCount(prevUnreadCount);
      toast.error("No se pudieron marcar como leídas. Revisa tu conexión.");
    } finally {
      setIsMutating(false);
    }
  }, [notifications, unreadCount]);

  useEffect(() => {
    const controller = new AbortController();
    fetchNotifications(controller.signal);

    intervalRef.current = setInterval(() => {
      // Only poll when tab is visible
      if (document.visibilityState === "visible") {
        fetchNotifications();
      }
    }, POLL_INTERVAL);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchNotifications();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      controller.abort();
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchNotifications]);

  return {
    notifications,
    unreadCount,
    isLoading,
    isMutating,
    mutatingId,
    markAsRead,
    markAllAsRead,
    refresh: fetchNotifications,
  };
}

