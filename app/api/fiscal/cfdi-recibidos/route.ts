// Buzón fiscal: CFDIs recibidos vía descarga masiva SAT.
//
// GET — lista paginada para el dashboard, scoped al tenant de la sesión.
//       Filtros: ?status=CONCILIADA|SIN_MATCH&limit=&offset=
//
// Roles tipo finanzas (mismo criterio que /api/expenses): los montos colindan
// con costos de proveedor; EMPLEADO y READONLY no entran ni por fetch directo.

import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { listarRecibidos } from "@/lib/services/cfdi-recibidos-service";

const ROLES_FINANZAS = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

export const GET = withRoleAuth([...ROLES_FINANZAS], async (req, { auth }) => {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  if (statusParam && statusParam !== "CONCILIADA" && statusParam !== "SIN_MATCH") {
    throw ApiError.badRequest(`status inválido: '${statusParam}'. Usa CONCILIADA o SIN_MATCH.`);
  }
  const limit = url.searchParams.get("limit");
  const offset = url.searchParams.get("offset");

  const resultado = await listarRecibidos(auth.tenantId, {
    status: (statusParam as "CONCILIADA" | "SIN_MATCH" | null) ?? undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
    offset: offset ? parseInt(offset, 10) : undefined,
  });

  return ApiHandler.success(resultado);
});
