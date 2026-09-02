/**
 * A6.3 / F15 — Revalidación de CFDI ya conciliados contra el SAT.
 *
 * Un CFDI se validaba **una sola vez**, al recibirlo, y después se conciliaba
 * (`SIN_MATCH` / `CONCILIADA`) y no se volvía a mirar nunca. La cancelación de
 * un comprobante es unilateral del emisor y no le avisa a nadie: si un proveedor
 * cancela una factura que el grupo ya dedujo, el receptor se entera cuando el
 * SAT le rechaza la deducción, meses después y con recargos.
 *
 * Esto barre las facturas del último año y guarda lo que el SAT contesta en
 * `invoices.sat_status`. **No cambia el estado de conciliación ni el de pago**:
 * una factura cancelada que ya se pagó sigue siendo una salida de dinero real, y
 * borrarla del sistema escondería el problema en vez de mostrarlo. Lo que hace
 * es dejar el hecho anotado para que Control Interno lo levante como excepción.
 *
 * Degrada a no-op declarado cuando FiscalAPI no está configurado: en local no
 * hay PAC, y un barrido que "no encontró nada" porque no pudo preguntar sería
 * peor que no correr.
 */
import { db } from "@/lib/db";
import { invoices } from "@/lib/db/schema";
import { and, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";
import { validateInvoice } from "@/lib/services/fiscal-service";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("cfdi-revalidation");

/** Cuántos meses hacia atrás se revalida. */
const VENTANA_MESES = 12;

/**
 * Cada cuánto se vuelve a preguntar por el mismo CFDI.
 *
 * Veinticinco días y no treinta para que el barrido mensual no deje facturas
 * fuera por un desfase de calendario: un cron del día 1 que exige "hace más de
 * 30 días" salta las de febrero.
 */
const REVALIDAR_CADA_DIAS = 25;

/** Cota por corrida: el PAC cobra por consulta y tiene límite de tasa. */
const MAX_POR_CORRIDA = 500;

export interface RevalidacionResultado {
  configurado: boolean;
  revisadas: number;
  canceladas: number;
  errores: number;
  /** UUIDs que el SAT reporta como cancelados en esta corrida. */
  uuidsCancelados: string[];
}

export async function revalidarCfdiConciliados(
  companyId?: string,
): Promise<RevalidacionResultado> {
  const vacio: RevalidacionResultado = {
    configurado: !!process.env.FISCALAPI_API_KEY,
    revisadas: 0,
    canceladas: 0,
    errores: 0,
    uuidsCancelados: [],
  };

  if (!vacio.configurado) {
    log.warn(
      "FiscalAPI no está configurado: la revalidación de CFDI no corre. " +
        "Sin PAC no se puede preguntar, y reportar cero cancelaciones sería afirmar algo que no se comprobó.",
    );
    return vacio;
  }

  const desde = new Date();
  desde.setMonth(desde.getMonth() - VENTANA_MESES);
  const desdeStr = desde.toISOString().slice(0, 10);

  const revisarAntesDe = new Date(Date.now() - REVALIDAR_CADA_DIAS * 86_400_000);

  const candidatas = await db
    .select({
      id: invoices.id,
      uuid: invoices.uuid,
      rfcEmisor: invoices.rfcEmisor,
      rfcReceptor: invoices.rfcReceptor,
      total: invoices.total,
      fecha: invoices.fecha,
    })
    .from(invoices)
    .where(
      and(
        ...(companyId ? [eq(invoices.companyId, companyId)] : []),
        gte(invoices.fecha, desdeStr),
        isNotNull(invoices.uuid),
        // Ya conciliadas: son las que el grupo dio por buenas y probablemente
        // dedujo. Una factura todavía en `PENDING` se valida por su propio flujo.
        sql`${invoices.matchStatus} <> 'PENDING'`,
        // Nunca revisadas, o revisadas hace más de un mes. Una ya cancelada no
        // se vuelve a preguntar: el estado es terminal y la consulta cuesta.
        or(
          sql`${invoices.satCheckedAt} IS NULL`,
          and(
            lt(invoices.satCheckedAt, revisarAntesDe),
            sql`COALESCE(${invoices.satStatus}, '') <> 'CANCELADO'`,
          ),
        ),
      ),
    )
    .limit(MAX_POR_CORRIDA);

  let canceladas = 0;
  let errores = 0;
  const uuidsCancelados: string[] = [];

  for (const factura of candidatas) {
    let estado: string;
    try {
      const resultado = await validateInvoice({
        emisorRfc: factura.rfcEmisor,
        receptorRfc: factura.rfcReceptor,
        uuid: factura.uuid,
        totalCents: factura.total,
        fechaEmision: factura.fecha,
      });
      estado = resultado.status;
    } catch (error) {
      // Un fallo del PAC no se escribe como estado: guardar "ERROR" con la
      // fecha de hoy haría que el CFDI no se vuelva a revisar en un mes por un
      // problema que era del PAC y no del comprobante.
      errores++;
      log.error({ err: error, uuid: factura.uuid }, "No se pudo revalidar el CFDI");
      continue;
    }

    await db
      .update(invoices)
      .set({ satStatus: estado, satCheckedAt: new Date() })
      .where(eq(invoices.id, factura.id));

    if (estado === "CANCELADO") {
      canceladas++;
      uuidsCancelados.push(factura.uuid);
      log.warn(
        { uuid: factura.uuid, rfcEmisor: factura.rfcEmisor },
        "CFDI ya conciliado cancelado por el emisor",
      );
    }
  }

  return {
    configurado: true,
    revisadas: candidatas.length,
    canceladas,
    errores,
    uuidsCancelados,
  };
}
