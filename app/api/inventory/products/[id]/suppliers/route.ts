// Proveedores de un insumo: principal y alternos (manual loteprod §4).
//
// La lista sale ordenada por preferencia; el PATCH promueve a principal o saca
// del orden. Se usa `withTenantAuth` (no `requireAuth` de tenant-context, que es
// la ruta vieja) para que companyId venga de la sesión y nunca del cuerpo.

import { NextRequest } from "next/server";
import { withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { hasPermission } from "@/lib/permissions";
import type { Role } from "@/lib/permissions";
import {
  listItemSuppliers,
  setPrimarySupplier,
  addAlternateSupplier,
  clearSupplierPreference,
} from "@/lib/services/supplier-preference-service";

/** GET /api/inventory/products/[id]/suppliers */
export const GET = withTenantAuth(
  async (_req: NextRequest, { auth, params }: any) => {
    const { id } = await params;
    const proveedores = await listItemSuppliers(auth.tenantId, id);
    return ApiHandler.success({ suppliers: proveedores });
  }
);

/**
 * PATCH /api/inventory/products/[id]/suppliers
 * body: { supplierId, action: "SET_PRIMARY" | "ADD_ALTERNATE" | "CLEAR" }
 *
 * Cambiar quién surte un insumo mueve dinero: exige permiso de escritura de
 * inventario, igual que editar el producto.
 */
export const PATCH = withTenantAuth(
  async (req: NextRequest, { auth, params }: any) => {
    const { id } = await params;

    if (!hasPermission(auth.user.role as Role, "inventory", "update")) {
      throw ApiError.forbidden("No tienes permiso para cambiar los proveedores del insumo");
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw ApiError.badRequest("Cuerpo de la petición inválido");
    }

    const supplierId = typeof body.supplierId === "string" ? body.supplierId : null;
    const acciones = ["SET_PRIMARY", "ADD_ALTERNATE", "CLEAR"] as const;
    const action = acciones.includes(body.action as never)
      ? (body.action as (typeof acciones)[number])
      : "SET_PRIMARY";
    if (!supplierId) throw ApiError.badRequest("Falta supplierId");

    const resultado =
      action === "CLEAR"
        ? await clearSupplierPreference(auth.tenantId, id, supplierId)
        : action === "ADD_ALTERNATE"
          ? await addAlternateSupplier(auth.tenantId, id, supplierId)
          : await setPrimarySupplier(auth.tenantId, id, supplierId);

    // null = proveedor o insumo ajeno al tenant (o sin fila en el catálogo):
    // 404 y no 403, para no confirmar la existencia de un id de otra empresa.
    if (!resultado) throw ApiError.notFound("No se encontró el proveedor para este insumo");

    const proveedores = await listItemSuppliers(auth.tenantId, id);
    return ApiHandler.success({ suppliers: proveedores });
  }
);
