import { NextRequest } from "next/server";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { db } from "@/lib/db";
import { dailySalesCuts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveBranchScope } from "@/lib/branch-scope";
import {
  POS_UPLOAD_URL_TTL_SECONDS,
  resolvePosUploadUrl,
} from "@/lib/storage/pos-upload";

/**
 * Mismos roles que la lectura del módulo de ventas (`app/api/sales/cuts`):
 * el archivo del POS es evidencia financiera del corte, no una consulta de
 * operación. `EMPLEADO`/`READONLY` quedan fuera.
 */
const ROLES_VENTAS = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/sales/cuts/[id]/pos-file
 *
 * Lectura autorizada del archivo POS de un corte. `raw_file_url` guarda una KEY
 * de R2 (o un valor legacy `http(s)://`/`local://`); esta ruta la convierte en
 * una URL firmada con TTL corto, tras comprobar:
 *  1. EMPRESA: la fila se busca por `company_id = tenantId` (sesión).
 *  2. SUCURSAL: roles clavados a sucursal (GERENTE/SUPERVISOR) solo leen su
 *     propia branch — 404, no 403, para no filtrar la existencia del corte.
 *
 * Nunca devuelve la key como URL pública; el cliente recibe la URL firmada y
 * su vigencia.
 */
export const GET = withRoleAuth(
  [...ROLES_VENTAS],
  async (req: NextRequest, { params, auth }) => {
    const { id } = (await params) as { id?: string };
    if (!id || typeof id !== "string" || !UUID_RE.test(id)) {
      throw ApiError.badRequest("Identificador de corte inválido.");
    }

    const [cut] = await db
      .select({
        id: dailySalesCuts.id,
        branchId: dailySalesCuts.branchId,
        rawFileUrl: dailySalesCuts.rawFileUrl,
      })
      .from(dailySalesCuts)
      .where(
        and(
          eq(dailySalesCuts.id, id),
          eq(dailySalesCuts.companyId, auth.tenantId)
        )
      )
      .limit(1);

    if (!cut) {
      throw ApiError.notFound("Corte de ventas no encontrado");
    }

    const scope = resolveBranchScope(
      auth.user.role,
      auth.user.branchId,
      cut.branchId
    );
    if (scope.kind === "NONE") {
      throw ApiError.forbidden("Sin acceso al archivo POS de esta sucursal");
    }
    if (scope.kind === "BRANCH" && scope.branchId !== cut.branchId) {
      // 404, no 403: no filtrar la existencia de cortes fuera del alcance.
      throw ApiError.notFound("Corte de ventas no encontrado");
    }

    if (!cut.rawFileUrl) {
      throw ApiError.notFound("Este corte no tiene archivo POS.");
    }

    const url = await resolvePosUploadUrl(cut.rawFileUrl);
    if (!url) {
      throw ApiError.notFound("El archivo POS no está disponible.");
    }

    return ApiHandler.success({
      url,
      fileKey: cut.rawFileUrl,
      expiresInSeconds: POS_UPLOAD_URL_TTL_SECONDS,
    });
  }
);
