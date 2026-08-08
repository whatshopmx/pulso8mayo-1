"use client";

import { useCallback, useEffect, useState } from "react";

export interface Branch {
  id: string;
  name: string;
}

export interface UseBranchesResult {
  branches: Branch[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Carga las sucursales de la empresa activa.
 *
 * `GET /api/branches` responde siempre `ApiHandler.success(branches)`, es decir
 * `{ success: true, data: Branch[] }` (app/api/branches/route.ts:17). Se parsea
 * esa forma y solo esa: la cadena de fallbacks
 * `data.data || data.branches || (Array.isArray(data) ? data : [])` que estaba
 * copiada en siete páginas defendía de formas que la API nunca devuelve, y
 * enmascaraba los fallos reales como "no hay sucursales".
 */
export function useBranches(): UseBranchesResult {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/branches");
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        setBranches([]);
        setError(json?.error || "No se pudieron cargar las sucursales.");
        return;
      }

      setBranches(Array.isArray(json.data) ? json.data : []);
    } catch (err) {
      console.error("Error fetching branches:", err);
      setBranches([]);
      setError("Error de conexión al cargar las sucursales. Revisa tu red e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  return { branches, loading, error, refetch: fetchBranches };
}
