import { useQuery } from "@tanstack/react-query"

import { mensajeDeError } from "@/lib/api/client-error"

export interface Branch {
  id: string
  name: string
}

/**
 * Carga las sucursales de la empresa activa.
 *
 * `GET /api/branches` responde siempre `ApiHandler.success(branches)`, es decir
 * `{ success: true, data: Branch[] }` (`app/api/branches/route.ts:17`). Este hook
 * leía `data.branches` —una forma que la API nunca devuelve— así que **devolvía
 * `[]` siempre**. Y `[]` no es un fallo: es "esta empresa no tiene sucursales".
 * Los dos casos se veían igual y el error desaparecía.
 *
 * El `queryFn` **lanza** en vez de devolver vacío, que es lo único que separa
 * `isError` de `data === []` en TanStack Query. Quien consuma este hook tiene
 * que pintar el error; si lo ignora, el problema vuelve una capa más arriba.
 */
export function useBranches() {
  return useQuery<Branch[]>({
    queryKey: ["branches"],
    queryFn: async () => {
      const res = await fetch("/api/branches")
      const json = await res.json().catch(() => null)

      if (!res.ok || !json?.success) {
        throw new Error(mensajeDeError(json, "No se pudieron cargar las sucursales."))
      }

      return Array.isArray(json.data) ? json.data : []
    },
    staleTime: 5 * 60 * 1000,
  })
}
