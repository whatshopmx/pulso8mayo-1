import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { listCommissionRates } from "@/lib/services/commission-service";
import { deriveSalesChannels } from "@/lib/services/sales-channel-catalog";
import { localDateString } from "@/lib/workflows/today";

/**
 * GET /api/company/sales-channels
 *
 * Los canales de venta del grupo: qué plataformas opera y con qué tarifa
 * vigente. Es la fuente que consumen el corte manual y los workflows para
 * ofrecer **sólo** las plataformas activas, en vez de una lista hardcodeada.
 *
 * Un canal está activo si es de sistema (`mostrador`, `tpv`) o si tiene tarifa
 * capturada. Configurar la tarifa es activar la plataforma: no hay un flag
 * aparte que pueda contradecir la tasa con la que el P&L ya valúa el canal.
 *
 * Mismos roles que leen comisiones: un gerente necesita saber con qué canales
 * opera su sucursal. No se expone escritura: las tarifas se capturan en
 * `/api/finance/commission-rates` (sólo ADMIN).
 */
const ROLES_LECTURA = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

export const GET = withRoleAuth([...ROLES_LECTURA], async (_req, { auth }) => {
  const rates = await listCommissionRates(auth.tenantId);
  // La vigencia se resuelve contra el día de negocio, no contra la hora del
  // servidor: una tarifa que entra en vigor hoy debe aparecer hoy.
  const today = localDateString(new Date(), null);

  return ApiHandler.success({ channels: deriveSalesChannels(rates, today) });
});
