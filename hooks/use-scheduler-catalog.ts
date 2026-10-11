"use client";

import { useState, useEffect, useCallback } from "react";
import { getSchedulerCatalog, type SchedulerCatalog } from "@/app/actions/shifts";

/**
 * Catálogo del planificador: sucursales, empleados y roles reales.
 *
 * Existe como hook y no como `useState` dentro del contenedor porque lo
 * consumen tres piezas —conteos, filtros y editor— y porque su estado de carga
 * y de error tiene que ser **compartido**: si el catálogo falló, el editor no
 * puede abrirse para dejar escribir ids inventados (H03).
 *
 * Regla de la pantalla: si `isError`, no hay datos y no se escribe. Un error de
 * carga con listas vacías parece una empresa sin personal, y el operador
 * acabaría guardando el primer turno con un id en blanco.
 */
export interface UseSchedulerCatalogReturn extends SchedulerCatalog {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const CATALOGO_VACIO: SchedulerCatalog = {
  branches: [],
  employees: [],
  roles: [],
  sinAlcance: false,
};

export function useSchedulerCatalog(): UseSchedulerCatalogReturn {
  const [catalogo, setCatalogo] = useState<SchedulerCatalog>(CATALOGO_VACIO);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setIsError(false);
    setError(null);
    try {
      setCatalogo(await getSchedulerCatalog());
    } catch (err) {
      // El catálogo se vacía al fallar: conservar el anterior haría creer que la
      // pantalla sigue teniendo personal cuando lo que falló fue la consulta.
      setCatalogo(CATALOGO_VACIO);
      setIsError(true);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { ...catalogo, isLoading, isError, error, refetch };
}