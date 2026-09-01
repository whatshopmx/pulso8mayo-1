import { z } from "zod";
import { withRoleAuth, withTenantAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
  deleteCommissionRate,
  listCommissionRates,
  upsertCommissionRate,
} from "@/lib/services/commission-service";
import { COMMISSION_CHANNELS, MAX_RATE_BPS } from "@/lib/services/commission-types";

/**
 * Tarifas de comisión por canal (Fase 4, decisión D1 opción (a)).
 *
 * **Lectura** con los mismos roles que el resto de Finanzas: un gerente necesita
 * ver con qué tasa se está valuando su margen para poder discutirlo.
 *
 * **Escritura** sólo ADMIN y SUPER_ADMIN. No es celo de permisos: la tarifa
 * multiplica el volumen del mes de TODAS las sucursales, así que cambiarla
 * mueve el P&L del grupo entero. Es una decisión de dirección, no de piso.
 */
const ROLES_LECTURA = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

export const GET = withRoleAuth([...ROLES_LECTURA], async (_req, { auth }) => {
  const rates = await listCommissionRates(auth.tenantId);
  return ApiHandler.success({ rates, channels: COMMISSION_CHANNELS });
});

const createSchema = z.object({
  channel: z.enum(COMMISSION_CHANNELS),
  /**
   * Puntos base y no porcentaje flotante: las tarifas se negocian en bps y el
   * redondeo de un `number` con decimales se nota cuando se multiplica por el
   * volumen de un mes.
   */
  rateBps: z
    .number()
    .int("La tarifa debe capturarse en puntos base enteros.")
    .min(0)
    .max(MAX_RATE_BPS, "La tarifa no puede pasar del 100%."),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha inválido (YYYY-MM-DD)."),
  notes: z.string().max(500).nullable().optional(),
});

export const POST = withTenantAuth(async (req, { auth }) => {
  // El rol se comprueba aquí y no con `withRoleAuth` para poder dar el motivo:
  // "no tienes permiso" sobre una pantalla que sí puedes leer es desconcertante.
  if (auth.user.role !== "SUPER_ADMIN" && auth.user.role !== "ADMIN") {
    throw ApiError.forbidden(
      "Sólo dirección puede cambiar las tarifas de comisión: la tasa afecta el margen de todas las sucursales.",
    );
  }

  const data = createSchema.parse(await req.json());

  const rate = await upsertCommissionRate({
    companyId: auth.tenantId,
    channel: data.channel,
    rateBps: data.rateBps,
    effectiveFrom: data.effectiveFrom,
    notes: data.notes ?? null,
    createdBy: auth.user.id,
  });

  return ApiHandler.success(rate);
});

export const DELETE = withTenantAuth(async (req, { auth }) => {
  if (auth.user.role !== "SUPER_ADMIN" && auth.user.role !== "ADMIN") {
    throw ApiError.forbidden(
      "Sólo dirección puede borrar tarifas de comisión.",
    );
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw ApiError.badRequest("Falta el id de la tarifa a borrar.");

  await deleteCommissionRate(auth.tenantId, id);
  return ApiHandler.success({ id });
});
