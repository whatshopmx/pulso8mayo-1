// M15: Fiscal & Facturación Service
// SAT invoice validation and CFDI nómina timbrado via FiscalAPI.
//
// Contrato real de FiscalAPI v4 (docs.fiscalapi.com): hosts test.fiscalapi.com /
// live.fiscalapi.com, recursos `api/v4/invoices` y `api/v4/invoices/status`,
// autenticación por headers X-API-KEY + X-TENANT-KEY. Para activar:
// FISCALAPI_API_KEY + FISCALAPI_TENANT en .env; sin la llave los endpoints
// devuelven error de configuración.
//
// El timbrado de nómina usa el mismo contrato que las facturas normales:
// `POST /invoices` con typeCode "N" y complement.payroll 1.2 (percepciones,
// deducciones, período). En sandbox el emisor debe ser una persona de prueba
// del SAT con SU CSD (lib/fiscal/sat-test-data.ts) y los datos patronales/
// laborales se rellenan con valores deterministas de sandbox. Idempotencia:
// tests/timbrado-idempotente.spec.ts.

import { db } from "@/lib/db";
import { cfdiNominaTimbrados } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { DEFAULT_TEST_ISSUER } from "@/lib/fiscal/fiscalapi";
import { loadCsdForTin, resolveTestPerson, SAT_TEST_FISICAS } from "@/lib/fiscal/sat-test-data";

const FISCALAPI_BASE_TEST = "https://test.fiscalapi.com/api/v4";
const FISCALAPI_BASE_PROD = "https://live.fiscalapi.com/api/v4";

function getConfig() {
  const apiKey = process.env.FISCALAPI_API_KEY;
  const tenant = process.env.FISCALAPI_TENANT;
  const env = process.env.FISCALAPI_ENV || "test";
  const baseUrl = env === "production" ? FISCALAPI_BASE_PROD : FISCALAPI_BASE_TEST;
  return { apiKey, tenant, baseUrl, configured: !!apiKey };
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

/**
 * Una percepción del desglose real de nómina, ya clasificada con las claves
 * del catálogo `c_TipoPercepcion` del SAT. Importes en centavos.
 */
export interface NominaPercepcion {
  /** Clave agrupadora del catálogo (ej: "001" sueldos, "038" otros ingresos). */
  earningTypeCode: string;
  /** Código interno del concepto dentro del catálogo de la empresa. */
  code: string;
  concept: string;
  /** Parte gravada de ISR, en centavos. */
  taxedAmount: number;
  /** Parte exenta de ISR, en centavos. */
  exemptAmount: number;
}

/** Una deducción real (ISR retenido, IMSS, etc.). Importe en centavos. */
export interface NominaDeduccion {
  /** Clave del catálogo `c_TipoDeduccion` ("002" ISR, "004" IMSS...). */
  deductionTypeCode: string;
  code: string;
  concept: string;
  amount: number;
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
  /** NSS del empleado (de employeeProfiles). Sin él, uno sintético determinista. */
  empleadoNss?: string;
  /** Fecha de contratación AAAA-MM-DD (de employeeContracts). */
  empleadoFechaContratacion?: string;
  /** Salario diario base en centavos (SBC/SDI del contrato). */
  empleadoSalarioDiarioCents?: number;
  /** Registro patronal IMSS de la empresa. Sin él, el default de sandbox. */
  registroPatronal?: string;
  /** Período de nómina (ej: "2025-01") */
  periodo: string;
  /** Total percepciones en centavos */
  totalPercepciones: number;
  /** Total deducciones en centavos */
  totalDeducciones: number;
  /**
   * Desglose fiscal real de percepciones. Si viene, manda sobre los totales
   * agregados (el CFDI refleja cada concepto con su parte gravada/exenta);
   * si no, cae al agregado de una sola línea "Sueldo nominal".
   */
  desglosePercepciones?: NominaPercepcion[];
  /** Desglose fiscal real de deducciones. Mismo trato que las percepciones. */
  desgloseDeducciones?: NominaDeduccion[];
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
 *
 * Contrato v4 real (`POST api/v4/invoices/status`, campos camelCase). El PAC
 * responde `status: "Vigente" | "Cancelado" | "No Encontrado"`; se normaliza
 * al enum que pinta la UI. La consulta es la del SAT por RFC+UUID+total, así
 * que `fechaCertificacion` y nombres no vienen en esta llamada: se reportan
 * vacíos en vez de inventarlos.
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
    const response = await fetch(`${baseUrl}/invoices/status`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey!,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        issuerTin: input.emisorRfc.toUpperCase(),
        recipientTin: input.receptorRfc.toUpperCase(),
        invoiceUuid: input.uuid.toUpperCase(),
        invoiceTotal: input.totalCents / 100,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`FiscalAPI error ${response.status}: ${errorBody}`);
    }

    const envelope = await response.json();
    // FiscalAPI envuelve todo en ApiResponse<T>: { succeeded, data, message }.
    if (envelope?.succeeded === false) {
      throw new Error(envelope.message || "FiscalAPI rechazó la consulta");
    }
    const data = envelope?.data ?? envelope ?? {};

    const estadoNormalizado = String(data.status ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_");
    const status: InvoiceValidationResult["status"] = (
      ["VIGENTE", "CANCELADO", "NO_ENCONTRADO"] as const
    ).includes(estadoNormalizado as never)
      ? (estadoNormalizado as InvoiceValidationResult["status"])
      : "ERROR";

    return {
      uuid: input.uuid,
      isValid: status === "VIGENTE",
      status,
      emisorNombre: "",
      emisorRfc: input.emisorRfc,
      receptorRfc: input.receptorRfc,
      total: input.totalCents / 100,
      fechaEmision: input.fechaEmision,
      fechaCertificacion: "",
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

/** Envoltura estándar de FiscalAPI v4: { succeeded, data, message, details }. */
interface ApiResponse {
  succeeded?: boolean;
  data?: {
    id?: string;
    uuid?: string;
    total?: number;
    status?: string;
    seal?: string;
    fechaTimbrado?: string;
    [campo: string]: unknown;
  };
  message?: string;
  details?: unknown;
}

/** Dedup de FiscalAPI: el mismo contenido ya tiene registro (ver stamp() en fiscal-invoicing-service). */
function esDuplicado(message: string | undefined): boolean {
  return /same unique values/i.test(message ?? "");
}

/** El dedup a veces reporta el mensaje genérico y manda la causa en `details`. */
function respuestaEsDuplicado(envelope: ApiResponse | null | undefined): boolean {
  if (!envelope) return false;
  const detalle = typeof envelope.details === "string" ? envelope.details : JSON.stringify(envelope.details ?? "");
  return esDuplicado(envelope.message) || esDuplicado(detalle);
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
 * El timbrado guardado de un período, o `null`.
 *
 * Es lo que permite que **recargar la pantalla no borre el comprobante**: antes
 * el resultado sólo vivía en el estado de React, así que el folio existía ante
 * el SAT y la pantalla se quedaba en blanco.
 */
export async function getTimbrado(
  companyId: string,
  empleadoRfc: string,
  periodo: string
): Promise<NominaTimbradoResult | null> {
  const [fila] = await db
    .select()
    .from(cfdiNominaTimbrados)
    .where(
      and(
        eq(cfdiNominaTimbrados.companyId, companyId),
        eq(cfdiNominaTimbrados.empleadoRfc, empleadoRfc),
        eq(cfdiNominaTimbrados.periodo, periodo)
      )
    )
    .limit(1);

  return fila ? comoResultado(fila) : null;
}

// ---------------------------------------------------------------------------
// Mapeo nómina → CFDI (contrato v4 real)
// ---------------------------------------------------------------------------

const dosDecimales = (n: number) => Math.round(n * 100) / 100;

/** Empleado de prueba de respaldo cuando el RFC real no está en el catálogo. */
const DEFAULT_TEST_EMPLOYEE =
  SAT_TEST_FISICAS.find((p) => p.tin === "FUNK671228PH6") ?? SAT_TEST_FISICAS[0];

/** Registro patronal de sandbox. Override con FISCALAPI_EMPLEADOR_REGISTRO. */
function registroPatronal(override?: string): string {
  return override || process.env.FISCALAPI_EMPLEADOR_REGISTRO || "B5510768108";
}

/** Entidad federativa del empleado. Override con FISCALAPI_NOMINA_ESTADO. */
function estadoNomina(): string {
  return process.env.FISCALAPI_NOMINA_ESTADO || "JAL";
}

/**
 * Traduce el período al rango de pago que exige el complemento de nómina
 * (`paymentDate`, `initialPaymentDate`, `finalPaymentDate`, `daysPaid`).
 * Acepta el rango que manda payroll-service ("2025-01-01 - 2025-01-15") y el
 * formato corto "AAAA-MM". Cualquier otra cosa cae al mes en curso: es un
 * valor de sandbox, no un dato fiscal.
 */
function periodoAFechas(periodo: string): { inicio: string; fin: string; dias: number } {
  const limpio = periodo.trim();
  const rango = /^(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})$/.exec(limpio);
  if (rango) {
    const dias = Math.round((Date.parse(rango[2]) - Date.parse(rango[1])) / 86_400_000) + 1;
    if (Number.isFinite(dias) && dias > 0) return { inicio: rango[1], fin: rango[2], dias };
  }
  const mes = /^(\d{4})-(\d{2})$/.exec(limpio);
  const anio = mes ? Number(mes[1]) : new Date().getUTCFullYear();
  const numMes = mes ? Number(mes[2]) : new Date().getUTCMonth() + 1;
  const valido = numMes >= 1 && numMes <= 12;
  const y = valido ? anio : new Date().getUTCFullYear();
  const m = valido ? numMes : new Date().getUTCMonth() + 1;
  const mm = String(m).padStart(2, "0");
  const ultimoDia = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    inicio: `${y}-${mm}-01`,
    fin: `${y}-${mm}-${String(ultimoDia).padStart(2, "0")}`,
    dias: ultimoDia,
  };
}

function diasDesde(contratacion: string, hasta: string): number {
  const dias = Math.round((Date.parse(hasta) - Date.parse(contratacion)) / 86_400_000);
  return Number.isFinite(dias) && dias > 0 ? dias : 30;
}

/** NSS sintético pero determinista por RFC: estable entre reintentos. */
function nssDeterminista(rfc: string): string {
  let nss = "";
  for (let i = 0; nss.length < 11; i++) {
    const c = rfc.charCodeAt(i % rfc.length);
    nss += String(c % 10);
  }
  return nss;
}

/**
 * Arma el payload `Invoice` de nómina para `POST /api/v4/invoices`.
 *
 * El emisor es la empresa representada por la persona moral de prueba del SAT
 * (EKU9003173C9) con su CSD —en sandbox el SAT rechaza certificados cruzados—,
 * más los datos patronales que el complemento exige. El receptor es el
 * empleado: si su RFC corresponde a una persona física de prueba emite hacia
 * ésa; si no, entra la de respaldo (el RFC real queda anotado en el concepto).
 */
export function construirPayloadNomina(input: NominaTimbradoInput): {
  payload: Record<string, unknown>;
  expectedTotal: number;
} {
  const emisor = DEFAULT_TEST_ISSUER;
  const empleadoReal = resolveTestPerson(input.empleadoRfc);
  const receptor = empleadoReal ?? DEFAULT_TEST_EMPLOYEE;

  // Con desglose real, los totales salen del propio desglose (el total del
  // CFDI tiene que cuadrar línea por línea); sin él, los agregados de siempre.
  const conDesglose = (input.desglosePercepciones?.length ?? 0) > 0;
  const percepciones = dosDecimales(
    conDesglose
      ? input.desglosePercepciones!.reduce(
          (acc, p) => acc + (p.taxedAmount + p.exemptAmount) / 100,
          0
        )
      : input.totalPercepciones / 100
  );
  const deducciones = dosDecimales(
    (input.desgloseDeducciones?.length ?? 0) > 0
      ? input.desgloseDeducciones!.reduce((acc, d) => acc + d.amount / 100, 0)
      : input.totalDeducciones / 100
  );
  // Total del comprobante: percepciones menos deducciones (CFDI de nómina no
  // lleva IVA trasladado). Verificar contra el timbre es lo delata un mapeo roto.
  const expectedTotal = dosDecimales(percepciones - deducciones);

  const { inicio, fin, dias } = periodoAFechas(input.periodo);
  // SBC/SDI real si hay contrato; si no, el sintético determinista de sandbox.
  const diario =
    input.empleadoSalarioDiarioCents && input.empleadoSalarioDiarioCents > 0
      ? dosDecimales(input.empleadoSalarioDiarioCents / 100)
      : dosDecimales(percepciones / Math.max(dias, 1));
  const contratacion = input.empleadoFechaContratacion || "2020-01-15";
  const antiguedadSemanas = Math.max(1, Math.floor(diasDesde(contratacion, fin) / 7));

  const payload = {
    versionCode: "4.0",
    series: "NOM",
    // Margen −2h: mismo gotcha del sandbox que en fiscal-invoicing-service —
    // los nodos desplazan la fecha hasta +1h y el PAC rechaza fuera de rango.
    date: new Date(Date.now() - 2 * 60 * 60 * 1000),
    paymentMethodCode: "PUE",
    currencyCode: "MXN",
    typeCode: "N", // nómina
    expeditionZipCode: emisor.zipCode,
    exportCode: "01",
    exchangeRate: 1,
    issuer: {
      tin: emisor.tin,
      legalName: emisor.legalName,
      taxRegimeCode: emisor.taxRegimeCode,
      employerData: { employerRegistration: registroPatronal(input.registroPatronal) },
      taxCredentials: loadCsdForTin(emisor.tin),
    },
    recipient: {
      tin: receptor.tin,
      legalName: receptor.legalName,
      zipCode: receptor.zipCode,
      taxRegimeCode: "605", // sueldos (c_TipoRegimen del receptor de nómina)
      cfdiUseCode: "CN01",
      employeeData: {
        employeeNumber: `PLS-${input.empleadoRfc.replace(/[^A-Z0-9]/gi, "").slice(-6).toUpperCase()}`,
        // NSS real si el perfil lo trae; si no, uno sintético determinista.
        socialSecurityNumber: input.empleadoNss || nssDeterminista(input.empleadoRfc),
        // El complemento valida formato de CURP (NOM111): sin una real que
        // valga, la genérica del catálogo de pruebas del SAT.
        curp: input.empleadoCurp || "XEXX010101MNEXXXA8",
        laborRelationStartDate: contratacion,
        seniority: `P${antiguedadSemanas}W`,
        satContractTypeId: "01", // plazo indeterminado
        satTaxRegimeTypeId: "02", // sueldos LISR art. 94
        satJobRiskId: "1",
        satPaymentPeriodicityId: "04", // quincenal
        satPayrollStateId: estadoNomina(),
        baseSalaryForContributions: diario,
        integratedDailySalary: diario,
      },
    },
    complement: {
      payroll: {
        version: "1.2",
        payrollTypeCode: "O", // ordinaria
        paymentDate: fin,
        initialPaymentDate: inicio,
        finalPaymentDate: fin,
        daysPaid: dias,
        earnings: {
          earnings: conDesglose
            ? input.desglosePercepciones!.map((p) => ({
                earningTypeCode: p.earningTypeCode,
                code: p.code,
                concept:
                  p.concept ||
                  `Percepción ${p.code}${empleadoReal ? "" : ` · ${input.empleadoNombre}`}`,
                taxedAmount: dosDecimales(p.taxedAmount / 100),
                exemptAmount: dosDecimales(p.exemptAmount / 100),
              }))
            : [
                {
                  earningTypeCode: "001", // sueldos, salarios, rayas y jornales
                  code: "001",
                  concept: `Sueldo nominal${empleadoReal ? "" : ` · ${input.empleadoNombre}`}`,
                  taxedAmount: percepciones,
                  exemptAmount: 0,
                },
              ],
          // El PAC exige el nodo OtroPago con clave "002" (subsidio, en cero
          // si no aplica): ni omitirlo ni mandarlo vacío pasa la validación
          // NOM105. Igual que el ejemplo oficial del SDK.
          otherPayments: [
            {
              otherPaymentTypeCode: "002",
              code: "5050",
              concept: "Exceso de subsidio al empleo",
              amount: 0,
              subsidyCaused: 0,
            },
          ],
        },
        deductions:
          (input.desgloseDeducciones?.length ?? 0) > 0
            ? input.desgloseDeducciones!.map((d) => ({
                deductionTypeCode: d.deductionTypeCode,
                code: d.code,
                concept: d.concept || `Deducción ${d.code}`,
                amount: dosDecimales(d.amount / 100),
              }))
            : deducciones > 0
              ? [{ deductionTypeCode: "002", code: "002", concept: "ISR retenido", amount: deducciones }]
              : [],
      },
    },
  };

  return { payload, expectedTotal };
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

  const { apiKey, tenant, baseUrl, configured } = getConfig();

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
    const { payload, expectedTotal } = construirPayloadNomina(input);
    const headers = {
      "X-API-KEY": apiKey!,
      ...(tenant ? { "X-TENANT-KEY": tenant } : {}),
      "X-TIME-ZONE": "America/Mexico_City",
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // El dedup de FiscalAPI rechaza un comprobante idéntico ya registrado
    // (típico al reintentar tras otro error): basta variar la serie.
    let serie = payload.series;
    let envelope: ApiResponse | null = null;
    for (let intento = 0; intento < 2; intento++) {
      const response = await fetch(`${baseUrl}/invoices`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...payload, series: serie }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        // El rechazo también se guarda: sin la fila, el siguiente intento repite
        // la petición a ciegas y nadie sabe qué contestó el PAC la vez anterior.
        await guardar("RECHAZADO", { error: errorBody, http_status: response.status });
        throw new Error(`FiscalAPI error ${response.status}: ${errorBody}`);
      }

      envelope = (await response.json()) as ApiResponse;

      const duplicado = envelope?.succeeded === false && respuestaEsDuplicado(envelope);
      if (duplicado && intento === 0) {
        serie = `NOM-${Date.now().toString(36).slice(-4).toUpperCase()}`;
        continue;
      }
      break;
    }

    // Rechazo de negocio del PAC (HTTP 200 pero succeeded=false): se deja
    // constancia y NO se lanza — el reintento legítimo lo maneja el llamador.
    if (envelope?.succeeded === false) {
      const filaRechazada = await guardar("RECHAZADO", {
        error: envelope.message ?? "",
        details: envelope.details,
      });
      return comoResultado(filaRechazada!);
    }

    const data = envelope?.data ?? {};
    if (!data.uuid) {
      // Sin folio no hay timbre, con o sin mensaje del PAC. Queda PENDIENTE y
      // el reintento es legítimo: el índice único es por período, no por folio.
      const status = mapPacStatus({ status: data.status, uuid: data.uuid });
      const filaPendiente = await guardar(status, { ...data } as RespuestaPac);
      return comoResultado(filaPendiente!);
    }

    // Verificación doble contra Pulso: el total timbrado debe cuadrar con lo
    // calculado localmente; un desfase mayor a un centavo es mapeo roto.
    const totalTimbrado = typeof data.total === "number" ? data.total : null;
    if (totalTimbrado !== null && Math.abs(totalTimbrado - expectedTotal) > 0.01) {
      console.error(
        `[FiscalService] Nómina ${input.empleadoRfc}/${input.periodo}: total timbrado ` +
          `${totalTimbrado} ≠ esperado ${expectedTotal}`
      );
    }

    const filaTimbrada = await guardar(
      "TIMBRADO",
      {
        uuid: data.uuid,
        sello_digital: data.seal ?? null,
        fecha_timbrado: data.fechaTimbrado ?? undefined,
        ...data,
        total_esperado: expectedTotal,
      },
      data.fechaTimbrado
    );
    return comoResultado(filaTimbrada!);
  } catch (error) {
    console.error("[FiscalService] Nomina timbrado error:", error);
    throw error;
  }
}
