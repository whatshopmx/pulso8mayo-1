import { useEffect, useRef, useCallback } from "react";

interface MetricsUpdate {
  activeWorkflows: number;
  openIncidents: number;
  timestamp: string;
}

type EventCallback = {
  connected?: () => void;
  metrics?: (data: MetricsUpdate) => void;
  error?: (error: Event) => void;
};

export function useAnalyticsSSE(branchId?: string, callbacks?: EventCallback) {
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    const params = new URLSearchParams();
    if (branchId && branchId !== "all") params.set("branchId", branchId);

    const es = new EventSource(`/api/analytics/realtime?${params}`);

    es.addEventListener("connected", () => {
      callbacks?.connected?.();
    });

    es.addEventListener("metrics", (event) => {
      const data = JSON.parse(event.data) as MetricsUpdate;
      callbacks?.metrics?.(data);
    });

    es.onerror = (error) => {
      callbacks?.error?.(error);
      es.close();
    };

    eventSourceRef.current = es;
  }, [branchId, callbacks]);

  const disconnect = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { disconnect, reconnect: connect };
}
