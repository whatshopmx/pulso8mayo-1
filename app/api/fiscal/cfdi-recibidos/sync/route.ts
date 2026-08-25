// POST /api/fiscal/cfdi-recibidos/sync — baja manual del buzón.
//
// Dispara el ciclo completo contra FiscalAPI: persona receptora + FIEL →
// regla → solicitud de descarga (últimos N días) → metadatos → upsert en
// cfdi_recibidos con conciliación. Idempotente: re-bajar la misma ventana
// actualiza las mismas filas (upsert por folio fiscal SAT).
//
// En sandbox la solicitud llega TERMINADA casi al instante (createTestRule);
// en producción el SAT tarda minutos-horas, así que el poll aquí es acotado:
// si no alcanza, se responde el estado y el usuario vuelve a disparar (o,
// cuando exista, la función Inngest toma el relevo). Ver handoff fiscalapi.

import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import {
  asegurarFiel,
  asegurarPersonaReceptora,
  asegurarReglaDescarga,
  esperarSolicitud,
  obtenerMetadatos,
  rfcReceptorPulso,
  solicitarDescarga,
} from "@/lib/services/fiscal-buzon-service";
import { persistirYConciliar } from "@/lib/services/cfdi-recibidos-service";

const ROLES_FINANZAS = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;
const POLL_TIMEOUT_SEG = 60; // acotado: es un request HTTP, no un worker

export const POST = withRoleAuth([...ROLES_FINANZAS], async (req, { auth }) => {
  let dias = 7;
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = typeof body?.dias === "number" ? body.dias : parseInt(body?.dias ?? "", 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 90) dias = parsed;
  } catch {
    /* cuerpo vacío o inválido: default 7 días */
  }

  // Si FiscalAPI no está configurado, getFiscalApiClient lanza error genérico;
  // lo traducimos a algo accionable para quien opera el dashboard.
  try {
    const receptor = rfcReceptorPulso();

    const persona = await asegurarPersonaReceptora();
    await asegurarFiel(persona.id!);
    const regla = await asegurarReglaDescarga(persona.id!);
    const sol = await solicitarDescarga(regla.id, dias);

    let estado = sol.estado;
    if (!/TERMINADA|COMPLETADA/i.test(estado)) {
      estado = await esperarSolicitud(sol.id, POLL_TIMEOUT_SEG);
    }

    if (!/TERMINADA|COMPLETADA/i.test(estado)) {
      return ApiHandler.success(
        {
          sincronizado: false,
          estadoSolicitud: estado,
          downloadRequestId: sol.id,
          message:
            "La solicitud sigue en proceso en el SAT. Reintenta en unos minutos — la baja es idempotente.",
        },
        202
      );
    }

    const recibidas = await obtenerMetadatos(sol.id);
    const resumen = await persistirYConciliar(auth.tenantId, recibidas, sol.id);

    return ApiHandler.success({
      sincronizado: true,
      downloadRequestId: sol.id,
      receptor,
      dias,
      ...resumen,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/API key|FISCALAPI|configured/i.test(msg)) {
      throw ApiError.internal(
        "FiscalAPI no está configurado. Define FISCALAPI_API_KEY y FISCALAPI_TENANT en el entorno."
      );
    }
    throw error;
  }
});
