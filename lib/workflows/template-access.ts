/**
 * Política única de acceso a plantillas de workflow (H02).
 *
 * Había dos rutas por el mismo recurso con contratos distintos:
 *
 * - `PATCH /api/templates/[id]` — permiso `workflows:update` y filtro por
 *   empresa en el `WHERE`.
 * - `GET|PATCH|DELETE /api/workflows/templates/[id]` — bastaba con tener
 *   sesión. Cualquier cuenta autenticada podía leer, editar o borrar la
 *   plantilla de otra empresa guessing el id, y el listado de la misma familia
 *   (`/api/workflows/templates`) sí filtraba por empresa: la protección
 *   dependía de qué ruta tomara el navegador.
 *
 * Las dos rutas siguen existiendo —el plan las declara compatibles durante la
 * transición— pero las dos preguntan aquí. La regla vive en un sitio; lo que
 * cambia entre rutas es sólo el verbo HTTP.
 */

import { db } from "@/lib/db";
import { workflowTemplates } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import { requirePermissionApi } from "@/lib/rbac/abac";
import type { Role } from "@/lib/permissions";

/** Verbos de autorización, en los términos de la matriz de `lib/permissions.ts`. */
export type TemplateAction = "read" | "update" | "delete";

/**
 * Identidad autorizada sobre plantillas. La construye la sesión: ni el
 * `companyId` ni el rol llegan del cuerpo de la petición.
 */
export interface TemplateActor {
  userId: string;
  role: Role;
  companyId: string;
}

/**
 * Puerta de autorización: sesión, permiso sobre `workflows` y empresa.
 *
 * Reutiliza `requirePermissionApi` (`lib/rbac/abac.ts`) en vez de una segunda
 * matriz, para que las plantillas no inventen su propia idea de qué rol puede
 * qué. Esa matriz además acotó por sucursal en cuanto la ruta pase la
 * sucursal del recurso; hoy la plantilla es un recurso de empresa y ese eje no
 * aplica.
 *
 * Sin `companyId` la respuesta es 403 y no un `[]` ambiguo: sin empresa no hay
 * contra qué filtrar, y un listado vacío aquí se confunde con "no tienes
 * plantillas".
 */
export async function requireTemplateAccess(action: TemplateAction): Promise<TemplateActor> {
  const { user } = await requirePermissionApi("workflows", action);

  if (!user.companyId) {
    throw ApiError.forbidden(
      "Tu usuario no tiene una empresa asignada. Completa el onboarding antes de gestionar plantillas."
    );
  }

  return {
    userId: user.id,
    role: user.role as Role,
    companyId: user.companyId,
  };
}

/**
 * Fila de plantilla dentro de la empresa del actor, o 404.
 *
 * 404 y no 403 para "no existe" y "es de otra empresa" por la misma razón que en
 * turnos: distinguishable sólo para quien ya sabe el id. Un 403 confirmaría que
 * ese id existe en algún sitio, que es medio mapa de las demás empresas.
 */
export async function cargarPlantillaDeEmpresa(actor: TemplateActor, id: string) {
  const [plantilla] = await db
    .select()
    .from(workflowTemplates)
    .where(and(eq(workflowTemplates.id, id), eq(workflowTemplates.companyId, actor.companyId)));

  if (!plantilla) {
    throw ApiError.notFound("La plantilla no existe.");
  }

  return plantilla;
}

/**
 * Condición de escritura: id **y** empresa, siempre juntas.
 *
 * Repetir el `company_id` en el `WHERE` no es redundancia con la carga previa,
 * es la barrera contra lo que pase entre la lectura y el `UPDATE`.
 */
export function plantillaDeEmpresa(id: string, companyId: string) {
  return and(eq(workflowTemplates.id, id), eq(workflowTemplates.companyId, companyId));
}