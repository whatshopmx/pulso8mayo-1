"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Notification {
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

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/notifications?limit=20", {
        credentials: "include",
        signal,
      });
      if (!res.ok) return;
      const json = await res.json();
      setNotifications(json.data || []);
      setUnreadCount(json.unreadCount ?? 0);
    } catch {
      // ignore abort or network errors
    } finally {
      setIsLoading(false);
    }
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
        credentials: "include",
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n,
          ),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch {
      // ignore
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllAsRead: true }),
        credentials: "include",
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => ({ ...n, read: true, readAt: new Date().toISOString() })),
        );
        setUnreadCount(0);
      }
    } catch {
      // ignore
    }
  }, []);

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
    markAsRead,
    markAllAsRead,
    refresh: fetchNotifications,
  };
}
