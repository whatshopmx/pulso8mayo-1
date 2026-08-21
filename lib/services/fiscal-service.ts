// M15: Fiscal & Facturación Service
// SAT invoice validation and CFDI nómina timbrado via FiscalAPI.
//
// To activate: set FISCALAPI_API_KEY and FISCALAPI_ENV (sandbox|production)
// in your .env file. Without the key, endpoints return a "not configured" error.

import { db } from "@/lib/db";
import { cfdiNominaTimbrados } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";

const FISCALAPI_BASE_SANDBOX = "https://sandbox.fiscalapi.com/api/v2";
const FISCALAPI_BASE_PROD = "https://api.fiscalapi.com/api/v2";

function getConfig() {
  const apiKey = process.env.FISCALAPI_API_KEY;
  const env = process.env.FISCALAPI_ENV || "sandbox";
  const baseUrl = env === "production" ? FISCALAPI_BASE_PROD : FISCALAPI_BASE_SANDBOX;
  return { apiKey, baseUrl, configured: !!apiKey };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoiceValidationInput {
  /** RFC del emisor de la factura */
  emisorRfc: string;
  /** RFC del receptor (tu empresa) */
  receptorRfc: string;
  /** UUID de la factura (CFDI) */
  uuid: string;
  /** Total de la factura en centavos */
  totalCents: number;
  /** Fecha de emisión (ISO string) */
  fechaEmision: string;
}

export interface InvoiceValidationResult {
  uuid: string;
  isValid: boolean;
  status: "VIGENTE" | "CANCELADO" | "NO_ENCONTRADO" | "ERROR";
  emisorNombre: string;
  emisorRfc: string;
  receptorRfc: string;
  total: number;
  fechaEmision: string;
  fechaCertificacion: string;
  rawResponse?: unknown;
}

export interface NominaTimbradoInput {
  /** Empresa que timbra. El comprobante se guarda a su nombre. */
  companyId: string;
  /** Quién disparó el timbrado. Un folio fiscal lo pide alguien. */
  performedBy?: string;
  /** RFC del empleado */
  empleadoRfc: string;
  /** Nombre completo del empleado */
  empleadoNombre: string;
  /** CURP del empleado */
  empleadoCurp?: string;
  /** Período de nómina (ej: "2025-01") */
  periodo: string;
  /** Total percepciones en centavos */
  totalPercepciones: number;
  /** Total deducciones en centavos */
  totalDeducciones: number;
}

export type NominaTimbradoStatus = "TIMBRADO" | "PENDIENTE" | "RECHAZADO" | "ERROR";

export interface NominaTimbradoResult {
  /** Folio fiscal. Vacío mientras no haya timbre válido (p. ej. un rechazo). */
  uuid: string;
  status: NominaTimbradoStatus;
  cadenaOriginal: string;
  selloDigital: string;
  fechaTimbrado: string;
  rawResponse?: unknown;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Validates a CFDI invoice against the SAT via FiscalAPI.
 * Returns the invoice status and certification details.
 */
export async function validateInvoice(
  input: InvoiceValidationInput
): Promise<InvoiceValidationResult> {
  const { apiKey, baseUrl, configured } = getConfig();

  if (!configured) {
    throw new Error(
      "FiscalAPI no está configurado. Agrega FISCALAPI_API_KEY a tu archivo .env para activar la validación de facturas."
    );
  }

  try {
    const response = await fetch(`${baseUrl}/cfdi/status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        emisor_rfc: input.emisorRfc,
        receptor_rfc: input.receptorRfc,
        uuid: input.uuid,
        total: (input.totalCents / 100).toFixed(2),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`FiscalAPI error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();

    return {
      uuid: input.uuid,
      isValid: data.status === "VIGENTE",
      status: data.status || "ERROR",
      emisorNombre: data.emisor_nombre || "",
      emisorRfc: data.emisor_rfc || input.emisorRfc,
      receptorRfc: data.receptor_rfc || input.receptorRfc,
      total: data.total || input.totalCents / 100,
      fechaEmision: data.fecha_emision || input.fechaEmision,
      fechaCertificacion: data.fecha_certificacion || "",
      rawResponse: data,
    };
  } catch (error) {
    console.error("[FiscalService] Invoice validation error:", error);
    throw error;
  }
}

/**
 * Traduce el estado que reporta el PAC al nuestro, sin afirmar de más.
 *
 * Antes esto no existía: la función devolvía `status: "TIMBRADO"` fijo, así que
 * un rechazo del SAT se guardaba y se pintaba con el mismo badge verde que un
 * comprobante válido. El estado es un dato del PAC, no una conclusión nuestra.
 *
 * La regla cuando el PAC **no** manda `status` —el contrato no lo promete— es
 * pedir evidencia: un folio con sello es un timbre; cualquier otra cosa queda
 * `PENDIENTE`. Nunca `TIMBRADO` por omisión.
 */
export interface RespuestaPac {
  uuid?: string | null;
  status?: string;
  estado?: string;
  cadena_original?: string;
  sello_digital?: string;
  fecha_timbrado?: string;
  [campo: string]: unknown;
}

export function mapPacStatus(data: RespuestaPac | null | undefined): NominaTimbradoStatus {
  const reportado = String(data?.status ?? data?.estado ?? "").trim().toUpperCase();

  if (["TIMBRADO", "STAMPED", "VIGENTE", "SUCCESS", "COMPLETED"].includes(reportado)) {
    return "TIMBRADO";
  }
  if (["RECHAZADO", "REJECTED", "FAILED", "ERROR", "CANCELADO"].includes(reportado)) {
    return "RECHAZADO";
  }
  if (["PENDIENTE", "PENDING", "IN_PROCESS", "PROCESSING"].includes(reportado)) {
    return "PENDIENTE";
  }

  return data?.uuid && data?.sello_digital ? "TIMBRADO" : "PENDIENTE";
}

/** La fila guardada, en la forma que devuelve el servicio. */
function comoResultado(fila: typeof cfdiNominaTimbrados.$inferSelect): NominaTimbradoResult {
  return {
    uuid: fila.uuid || "",
    status: fila.status,
    cadenaOriginal: fila.cadenaOriginal || "",
    selloDigital: fila.selloDigital || "",
    fechaTimbrado: (fila.fechaTimbrado ?? fila.createdAt).toISOString(),
    rawResponse: fila.rawResponse ?? undefined,
  };
}

/**
 * Timbra un CFDI de nómina vía FiscalAPI y **deja constancia**.
 *
 * Antes no se persistía nada: el comprobante vivía en el estado de React de la
 * pantalla fiscal, así que recargar lo borraba —el folio existía ante el SAT y
 * en Pulso no quedaba rastro— y la única guarda contra timbrar dos veces era
 * ese mismo estado de cliente, de modo que reintentar consumía otro folio. Los
 * folios se compran.
 *
 * La idempotencia es de base de datos (AD-A4): un período ya `TIMBRADO` se
 * devuelve tal cual **sin llamar al PAC**, y el índice único
 * `(company_id, empleado_rfc, periodo)` es la red si dos peticiones corren a la
 * vez. Un intento que no quedó timbrado (rechazo, pendiente) sí se reintenta y
 * actualiza su fila: por eso el índice es por período y no por folio, que un
 * rechazo sin UUID bloquearía.
 */
export async function timbrarNomina(
  input: NominaTimbradoInput
): Promise<NominaTimbradoResult> {
  const yaTimbrado = await db
    .select()
    .from(cfdiNominaTimbrados)
    .where(
      and(
        eq(cfdiNominaTimbrados.companyId, input.companyId),
        eq(cfdiNominaTimbrados.empleadoRfc, input.empleadoRfc),
        eq(cfdiNominaTimbrados.periodo, input.periodo)
      )
    )
    .limit(1);

  if (yaTimbrado[0]?.status === "TIMBRADO") {
    return comoResultado(yaTimbrado[0]);
  }

  const { apiKey, baseUrl, configured } = getConfig();

  if (!configured) {
    throw new Error(
      "FiscalAPI no está configurado. Agrega FISCALAPI_API_KEY a tu archivo .env para activar el timbrado de nómina."
    );
  }

  /** Escribe el intento. El índice único convierte una carrera en un UPDATE. */
  const guardar = async (
    status: NominaTimbradoStatus,
    data: RespuestaPac,
    fecha?: string
  ) => {
    const valores = {
      companyId: input.companyId,
      empleadoRfc: input.empleadoRfc,
      empleadoNombre: input.empleadoNombre,
      periodo: input.periodo,
      uuid: data?.uuid || null,
      status,
      cadenaOriginal: data?.cadena_original || null,
      selloDigital: data?.sello_digital || null,
      totalPercepcionesCents: input.totalPercepciones,
      totalDeduccionesCents: input.totalDeducciones,
      rawResponse: data ?? null,
      timbradoPor: input.performedBy || null,
      fechaTimbrado: new Date(fecha || Date.now()),
      updatedAt: new Date(),
    };

    const [fila] = await db
      .insert(cfdiNominaTimbrados)
      .values(valores)
      .onConflictDoUpdate({
        target: [
          cfdiNominaTimbrados.companyId,
          cfdiNominaTimbrados.empleadoRfc,
          cfdiNominaTimbrados.periodo,
        ],
        set: valores,
        // Un folio bueno no se pisa. Si dos peticiones corren a la vez y una ya
        // dejó el período TIMBRADO, la otra no la sobreescribe con su propio
        // intento: se quedaría el comprobante equivocado en la fila.
        setWhere: ne(cfdiNominaTimbrados.status, "TIMBRADO"),
      })
      .returning();

    if (fila) return fila;

    // `setWhere` bloqueó el UPDATE, así que no hubo `RETURNING`: la fila ya
    // estaba timbrada por quien ganó la carrera. Esa es la buena.
    const [ganadora] = await db
      .select()
      .from(cfdiNominaTimbrados)
      .where(
        and(
          eq(cfdiNominaTimbrados.companyId, input.companyId),
          eq(cfdiNominaTimbrados.empleadoRfc, input.empleadoRfc),
          eq(cfdiNominaTimbrados.periodo, input.periodo)
        )
      )
      .limit(1);

    return ganadora;
  };

  try {
    const response = await fetch(`${baseUrl}/cfdi/nomina/timbrar`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        empleado_rfc: input.empleadoRfc,
        empleado_nombre: input.empleadoNombre,
        empleado_curp: input.empleadoCurp || "",
        periodo: input.periodo,
        total_percepciones: (input.totalPercepciones / 100).toFixed(2),
        total_deducciones: (input.totalDeducciones / 100).toFixed(2),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      // El rechazo también se guarda: sin la fila, el siguiente intento repite
      // la petición a ciegas y nadie sabe qué contestó el PAC la vez anterior.
      await guardar("RECHAZADO", { error: errorBody, http_status: response.status });
      throw new Error(`FiscalAPI error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const status = mapPacStatus(data);
    const fila = await guardar(status, data, data?.fecha_timbrado);

    return comoResultado(fila);
  } catch (error) {
    console.error("[FiscalService] Nomina timbrado error:", error);
    throw error;
  }
}
