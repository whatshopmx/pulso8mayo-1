// M15: Fiscal & Facturación Service
// SAT invoice validation and CFDI nómina timbrado via FiscalAPI.
//
// To activate: set FISCALAPI_API_KEY and FISCALAPI_ENV (sandbox|production)
// in your .env file. Without the key, endpoints return a "not configured" error.

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
  /** UUID de la nómina a timbrar */
  uuid?: string;
}

export interface NominaTimbradoResult {
  uuid: string;
  status: "TIMBRADO" | "PENDIENTE" | "ERROR";
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
 * Timbres a CFDI nómina via FiscalAPI.
 * Generates the digital stamp (sello) and original chain (cadena original).
 */
export async function timbrarNomina(
  input: NominaTimbradoInput
): Promise<NominaTimbradoResult> {
  const { apiKey, baseUrl, configured } = getConfig();

  if (!configured) {
    throw new Error(
      "FiscalAPI no está configurado. Agrega FISCALAPI_API_KEY a tu archivo .env para activar el timbrado de nómina."
    );
  }

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
        uuid: input.uuid || undefined,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`FiscalAPI error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();

    return {
      uuid: data.uuid || input.uuid || "",
      status: "TIMBRADO",
      cadenaOriginal: data.cadena_original || "",
      selloDigital: data.sello_digital || "",
      fechaTimbrado: data.fecha_timbrado || new Date().toISOString(),
      rawResponse: data,
    };
  } catch (error) {
    console.error("[FiscalService] Nomina timbrado error:", error);
    throw error;
  }
}
