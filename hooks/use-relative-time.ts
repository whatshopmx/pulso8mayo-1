"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Returns a Spanish relative-time string for an ISO-8601 timestamp
 * (e.g. "hace 3 min", "hace 1 h", "hace 2 días"), updating on a timer so
 * it stays fresh while visible. Returns null when `iso` is falsy so callers
 * can render nothing instead of "Actualizado · —".
 *
 * Labelled as last fetch time, not last physical count (see Task 5 tooltip).
 */
export function useRelativeTime(iso?: string | null, intervalMs = 60_000): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [iso, intervalMs]);

  return useMemo(() => {
    if (!iso) return null;
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return null;

    const seconds = Math.max(0, Math.floor((now - then) / 1000));

    if (seconds < 60) return "hace un momento";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `hace ${days} ${days === 1 ? "día" : "días"}`;
    const months = Math.floor(days / 30);
    return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
  }, [iso, now]);
}
