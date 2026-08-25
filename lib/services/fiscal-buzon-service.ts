// Buzón fiscal del receptor: descarga masiva SAT vía FiscalAPI.
//
// Flujo REALISTA multitenant de compras:
//
//   PROVEEDOR (su infraestructura, su CSD)      PULSO (este tenant)
//   ─────────────────────────────────────       ────────────────────────
//   Emite CFDI hacia el RFC de Pulso    ──SAT──→ Llega al buzón del RFC
//   (en pruebas se SIMULA con los CSD              Se baja por descarga masiva
//   públicos de prueba: nadie comparte             usando la FIEL de Pulso
//   su CSD real; FiscalAPI publica los             (e.firma ≠ CSD: firma
//   del SAT precisamente para esto)                solicitudes, no facturas)
//                                                  y se concilia contra la OC/gasto
//
// El módulo espejo docs.fiscalapi.com/download-*: regla de descarga
// (plantilla con persona + tipo "Recibidos") → solicitud al SAT → metadatos /
// XMLs. La solicitud tiene ciclo de vida propio: ACEPTADA → EN PROCESO →
// TERMINADA; el SAT tarda segundos/minutos en procesarla.

import type { Person } from "fiscalapi";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { operatingExpenses, payees, purchaseOrders, suppliers } from "@/lib/db/schema";
import { getFiscalApiClient } from "@/lib/fiscal/fiscalapi";
import {
  loadCsdForTin,
  loadFielForTin,
  resolveTestPerson,
} from "@/lib/fiscal/sat-test-data";

/**
 * RFC que representa a la empresa Pulso como RECEPTORA en el ambiente de
 * pruebas. Override con FISCALAPI_COMPANY_TEST_TIN (debe existir en el
 * catálogo y tener FIEL en tests/fixtures/fiscalapi-certs/<RFC>/fiel.*).
 */
export function rfcReceptorPulso(): string {
  const override = resolveTestPerson(process.env.FISCALAPI_COMPANY_TEST_TIN);
  return override?.tin ?? "URE180429TM6";
}

/** Mensaje real del PAC (axios resume los errores HTTP a una frase genérica). */
export function mensajeDeError(error: unknown): string {
  if (error && typeof error === "object" && "isAxiosError" in error) {
    const ax = error as { response?: { status?: number; data?: unknown } };
    const data = ax.response?.data as Record<string, unknown> | undefined;
    if (data && typeof data === "object") {
      if (data.message) return `${data.message} · ${String(data.details ?? "")}`.trim();
      if (data.title || data.detail) return `${data.title ?? ""} ${data.detail ?? ""}`.trim();
      return JSON.stringify(data).slice(0, 300);
    }
    return `HTTP ${ax.response?.status ?? "?"}`;
  }
  return error instanceof Error ? error.message : String(error);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Persona receptora + FIEL
// ---------------------------------------------------------------------------

async function buscarPersonaPorTin(tin: string): Promise<Person | null> {
  const client = getFiscalApiClient();
  for (let page = 1; page <= 5; page++) {
    const r = await client.persons.getList(page, 50);
    if (!r.succeeded) throw new Error(`persons.getList falló: ${r.message}`);
    const hit = r.data.items.find((p) => p.tin?.toUpperCase() === tin);
    if (hit) return hit;
    if (r.data.items.length < 50) break;
  }
  return null;
}

/** Crea (o recupera) la persona receptora de Pulso en el tenant. */
export async function asegurarPersonaReceptora(): Promise<Person> {
  const tin = rfcReceptorPulso();
  const existente = await buscarPersonaPorTin(tin);
  if (existente) return existente;

  const persona = resolveTestPerson(tin)!;
  const client = getFiscalApiClient();
  const creada = await client.persons.create({
    legalName: persona.legalName,
    email: `pulso${tin.toLowerCase().replace(/[^a-z0-9]/g, "")}@prueba.local`,
    password: "PulsoPrueba2026!",
    satTaxRegimeId: persona.taxRegimeCode,
    zipCode: persona.zipCode,
    tin,
  });
  if (!creada.succeeded || !creada.data?.id) {
    throw new Error(`No se pudo crear la persona receptora ${tin}: ${creada.message} ${String(creada.details ?? "")}`);
  }
  return creada.data;
}

/** Sube la e.firma/FIEL de prueba a la persona (idempotente si ya existe). */
export async function asegurarFiel(personId: string): Promise<"subida" | "ya-existia"> {
  const client = getFiscalApiClient();
  const tin = rfcReceptorPulso();
  const [cert, llave] = loadFielForTin(tin);

  // ¿Ya tiene archivos fiscales? getList paginado filtrando por personId.
  try {
    const existentes = await client.taxFiles.getList(1, 50);
    const deLaPersona = (existentes.data?.items ?? []).filter(
      (f) => f.personId === personId || (f as unknown as { tin?: string }).tin === tin
    );
    if (deLaPersona.length >= 2) return "ya-existia";
  } catch {
    /* si listar falla, intentamos subir directo */
  }

  for (const archivo of [cert, llave]) {
    const r = await client.taxFiles.create({
      personId,
      tin,
      base64File: archivo.base64File,
      fileType: archivo.fileType,
      password: archivo.password,
    });
    if (!r.succeeded) {
      const msg = `${r.message} ${String(r.details ?? "")}`;
      if (/already exists|duplicate/i.test(msg)) continue;
      throw new Error(`taxFiles.create (${archivo.fileType}) falló: ${msg}`);
    }
  }
  return "subida";
}

// ---------------------------------------------------------------------------
// Regla + solicitud de descarga
// ---------------------------------------------------------------------------

/**
 * Extrae el estado legible de una solicitud. La API lo devuelve como objeto
 * anidado ({satRequestStatus:{id:"3",description:"Terminada"}}), no como
 * campo plano — soportamos ambas formas por si cambia.
 */
export function estadoDeSolicitud(req: unknown): string {
  const r = req as {
    satRequestStatus?: { id?: string; description?: string } | string;
    satRequestStatusId?: string | number;
    downloadRequestStatus?: { description?: string } | string;
  } | null | undefined;
  if (!r) return "?";
  if (typeof r.satRequestStatus === "object" && r.satRequestStatus?.description) {
    return r.satRequestStatus.description;
  }
  if (typeof r.downloadRequestStatus === "object" && r.downloadRequestStatus?.description) {
    return r.downloadRequestStatus.description;
  }
  return String(r.satRequestStatusId ?? "?");
}

/** Regla "Recibidos" para la persona (plantilla reutilizable).
 *
 * En el tenant FREE la creación manual de reglas responde 403 ("módulo no
 * disponible") y en sandbox la descarga masiva real también está bloqueada
 * (403 "solo disponible en producción"). El camino que sí funciona es
 * `createTestRule()` — endpoint especial POST /download-rules/test que crea
 * UNA REGLA Y UNA SOLICITUD juntas, con precondición de existir al menos una
 * factura por referencias entre dos personas del tenant.
 *
 * OJO validado en live: el id que devuelve createTestRule NO es el de la
 * regla sino el de la SOLICITUD recién creada; el id real de la regla hay que
 * resolverlo SIEMPRE con getList() (que además ordena más-nueva-primero).
 */
export async function asegurarReglaDescarga(personId: string): Promise<{ id: string; descripcion: string }> {
  const client = getFiscalApiClient();
  const descripcion = "Pulso · facturas recibidas (buzón)";

  const lista = await client.downloadRules.getList(1, 50);
  const items = lista.succeeded ? lista.data?.items ?? [] : [];
  // Match estricto primero (producción: plantilla por persona).
  const propia = items.find((r) => r.personId === personId && r.downloadTypeId === "Recibidos");
  if (propia?.id) return { id: propia.id, descripcion: propia.description ?? descripcion };

  // Producción / tenant con módulo: creación manual normal.
  const creada = await client.downloadRules
    .create({
      personId,
      description: descripcion,
      satQueryTypeId: "CFDI",
      downloadTypeId: "Recibidos",
    } as never)
    .catch((error: unknown) => ({ succeeded: false, message: mensajeDeError(error), details: "", data: undefined }));
  if (creada.succeeded && creada.data?.id) {
    // Resolver contra getList: algunos endpoints devuelven ids internos que
    // difieren del recurso persistido.
    const fresca = await client.downloadRules.getList(1, 50);
    const nueva = (fresca.data?.items ?? []).find((r) => r.id === creada.data!.id) ??
      (fresca.data?.items ?? [])[0];
    if (nueva?.id) return { id: nueva.id, descripcion: nueva.description ?? descripcion };
    return { id: creada.data.id, descripcion: descripcion };
  }

  // Sandbox/free: reusar cualquier regla de prueba ya creada (la más nueva).
  if (items.length > 0 && /prueba|test/i.test(items[0].description ?? "")) {
    return { id: items[0].id, descripcion: items[0].description ?? descripcion };
  }
  const prueba = await crearReglaPrueba();
  if (!prueba.ok) {
    throw new Error(`No se pudo crear regla de descarga ni manual ni de prueba: ${creada.message} · ${prueba.error}`);
  }
  const trasPrueba = await client.downloadRules.getList(1, 50);
  const reglaNueva = (trasPrueba.data?.items ?? [])[0];
  if (!reglaNueva?.id) throw new Error("createTestRule ok pero getList no muestra la regla");
  return { id: reglaNueva.id, descripcion: reglaNueva.description ?? "regla de prueba" };
}

interface TestRuleResult {
  ok: boolean;
  /** Id de la SOLICITUD de prueba recién creada (no confundir con la regla). */
  requestId?: string;
  error?: string;
}

/** POST /api/v4/download-rules/test — crea regla+solicitud de prueba juntas. */
async function crearReglaPrueba(): Promise<TestRuleResult> {
  const client = getFiscalApiClient();
  const r = await (
    client.downloadRules as unknown as {
      createTestRule: () => Promise<ApiResponseLike<{ id?: string }>>;
    }
  ).createTestRule();
  if (!r.succeeded || !r.data?.id) {
    return { ok: false, error: `${r.message ?? ""} ${String(r.details ?? "")}`.trim() };
  }
  return { ok: true, requestId: r.data.id };
}

interface ApiResponseLike<T> {
  succeeded: boolean;
  message?: string;
  details?: string;
  data?: T;
}

/**
 * Solicitud de descarga de los últimos `dias` días.
 *
 * En producción: creación manual ligada a la regla. En sandbox el endpoint
 * manual responde 403 ("La descarga masiva de XML solo está disponible en
 * producción"), así que cae a `createTestRule()`, que genera su propia
 * solicitud con ventana ~24h y YA TERMINADA — su data.id ES el id real de la
 * solicitud (verificado contra getList).
 */
export async function solicitarDescarga(_ruleId: string, dias: number): Promise<{ id: string; estado: string }> {
  const client = getFiscalApiClient();
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - dias * 24 * 60 * 60 * 1000);

  const creada = await client.downloadRequests
    .create({
      downloadRuleId: _ruleId,
      downloadRequestTypeId: "Manual",
      startDate,
      endDate,
    } as never)
    .catch((error: unknown) => ({ succeeded: false, message: mensajeDeError(error), details: "", data: undefined }));
  if (creada.succeeded && creada.data?.id) {
    return { id: creada.data.id, estado: estadoDeSolicitud(creada.data) };
  }

  const msg = `${creada.message ?? ""} ${String(creada.details ?? "")}`;
  if (!/producci[oó]n|403|asiento|cuota|m[oó]dulo/i.test(msg)) {
    throw new Error(`downloadRequests.create falló: ${msg}`);
  }
  const prueba = await crearReglaPrueba();
  if (!prueba.ok || !prueba.requestId) {
    throw new Error(`Sin solicitudes manuales (sandbox) ni de prueba: ${msg} · ${prueba.error}`);
  }
  const detalle = await client.downloadRequests.getById(prueba.requestId);
  return { id: prueba.requestId, estado: detalle.succeeded ? estadoDeSolicitud(detalle.data) : "?" };
}

/** Espera a que el SAT termine la solicitud (poll cada 5s hasta timeout). */
export async function esperarSolicitud(requestId: string, timeoutSeg = 120): Promise<string> {
  const client = getFiscalApiClient();
  const inicio = Date.now();
  let ultimoEstado = "?";
  while (Date.now() - inicio < timeoutSeg * 1000) {
    const r = await client.downloadRequests.getById(requestId);
    if (!r.succeeded) throw new Error(`downloadRequests.getById falló: ${r.message}`);
    ultimoEstado = estadoDeSolicitud(r.data);
    if (/TERMINADA|COMPLETADA|ERROR|RECHAZADA|VENCIDA/i.test(ultimoEstado)) return ultimoEstado;
    await sleep(5_000);
  }
  return ultimoEstado; // timeout; el caller decide
}

// ---------------------------------------------------------------------------
// SIMULACIÓN (sólo sandbox): el proveedor timbra la OC por referencias
// ---------------------------------------------------------------------------

/**
 * En producción el proveedor timbra desde SU sistema con SU CSD y la factura
 * llega al buzón por descarga masiva real. El simulador del sandbox de
 * FiscalAPI sólo refleja en los metadatos las facturas creadas POR
 * REFERENCIAS entre personas del tenant (las por-valores nunca aparecen —
 * validado en live), así que "el proveedor emite" se simula así:
 *
 *   persona emisora = RFC de prueba del proveedor + su CSD público
 *   persona receptora = RFC de prueba de Pulso
 *   una línea por el subtotal de la OC → total idéntico al de la OC
 *
 * El producto define el IVA (satTaxObjectId 02=con IVA 16%, 01=sin impuestos);
 * los overrides por línea (taxObjectCode/itemTaxes) son ignorados por el API.
 */
export interface EmisionSimulada {
  uuid: string;
  issuerTin: string;
  total: number;
}

async function asegurarPersonaConCsd(tin: string): Promise<Person> {
  const existente = await buscarPersonaPorTin(tin);
  if (existente) return existente;
  const persona = resolveTestPerson(tin);
  if (!persona) throw new Error(`RFC ${tin} no está en el catálogo de pruebas del SAT`);
  const client = getFiscalApiClient();
  const creada = await client.persons.create({
    legalName: persona.legalName,
    email: `pulso${tin.toLowerCase().replace(/[^a-z0-9]/g, "")}@prueba.local`,
    password: "PulsoPrueba2026!",
    satTaxRegimeId: persona.taxRegimeCode,
    zipCode: persona.zipCode,
    tin,
  });
  if (!creada.succeeded || !creada.data?.id) {
    throw new Error(`No se pudo crear persona ${tin}: ${creada.message} ${String(creada.details ?? "")}`);
  }
  const [cer, key] = loadCsdForTin(tin);
  for (const f of [cer, key]) {
    const r = await client.taxFiles.create({ personId: creada.data.id, tin, base64File: f.base64File, fileType: f.fileType, password: f.password });
    if (!r.succeeded && !/already exists|duplicate/i.test(`${r.message} ${String(r.details ?? "")}`)) {
      throw new Error(`taxFiles.create (${tin}): ${r.message}`);
    }
  }
  return creada.data;
}

interface ProductosBuzon {
  conIvaId: string;
  sinIvaId: string;
}

async function asegurarProductos(): Promise<ProductosBuzon> {
  const client = getFiscalApiClient();
  const lista = await client.products.getList(1, 50);
  const items = lista.data?.items ?? [];
  const buscar = (desc: string) => items.find((p) => p.description === desc)?.id;
  let conIvaId = buscar("Servicio buzon Pulso");
  let sinIvaId = buscar("Servicio buzon Pulso sin IVA");
  if (!conIvaId) {
    const p = await client.products.create({ description: "Servicio buzon Pulso", unitPrice: 100, satUnitMeasurementId: "E48", satTaxObjectId: "02", satProductCodeId: "01010101" } as never);
    conIvaId = p.data!.id!;
  }
  if (!sinIvaId) {
    const p = await client.products.create({ description: "Servicio buzon Pulso sin IVA", unitPrice: 100, satUnitMeasurementId: "E48", satTaxObjectId: "01", satProductCodeId: "01010101" } as never);
    sinIvaId = p.data!.id!;
  }
  return { conIvaId, sinIvaId };
}

const dosDecimales = (n: number) => Math.round(n * 100) / 100;

/**
 * Emisión simulada genérica por referencias: una línea por el subtotal,
 * producto con/sin IVA según el impuesto declarado.
 */
export interface EmisionPorReferencias {
  /** Descripción de la línea (ej. "Factura OC PO-2026-0361"). */
  concepto: string;
  /** RFC de prueba del EMISOR (proveedor o payee). */
  tinEmisor: string;
  /** Subtotal sin impuestos, en pesos. */
  subtotal: number;
  /** Impuesto trasladado (IVA 16%), en pesos. */
  taxAmount: number;
}

async function timbrarPorReferencias(input: EmisionPorReferencias): Promise<EmisionSimulada> {
  const client = getFiscalApiClient();
  const emisor = await asegurarPersonaConCsd(input.tinEmisor);
  const receptor = await asegurarPersonaReceptora();
  const productos = await asegurarProductos();

  const conIva = input.taxAmount > 0;
  if (!Number.isFinite(input.subtotal) || input.subtotal <= 0) {
    throw new Error(`"${input.concepto}" sin subtotal utilizable para la simulación`);
  }

  const creada = await client.invoices.create({
    versionCode: "4.0",
    series: `OC${Date.now() % 89}`,
    date: new Date(Date.now() - 2 * 3600 * 1000),
    paymentFormCode: "03",
    currencyCode: "MXN",
    typeCode: "I",
    exportCode: "01",
    paymentMethodCode: "PUE",
    exchangeRate: 1,
    expeditionZipCode: receptor.zipCode ?? "23004",
    issuer: { id: emisor.id! },
    recipient: { id: receptor.id!, cfdiUseCode: "G01" },
    items: [{
      id: conIva ? productos.conIvaId : productos.sinIvaId,
      quantity: 1,
      // El producto aporta la tasa; con una sola línea el redondeo del PAC
      // reproduce exactamente el total esperado (subtotal + IVA al 16%).
      unitPrice: dosDecimales(input.subtotal),
      description: input.concepto.slice(0, 200),
    }],
  } as never);
  if (!creada.succeeded || !creada.data?.uuid) {
    throw new Error(`Emisión simulada falló: ${creada.message} ${String(creada.details ?? "").slice(0, 200)}`);
  }
  return { uuid: creada.data.uuid, issuerTin: input.tinEmisor.toUpperCase(), total: Number(creada.data.total ?? 0) };
}

export interface OcParaSimular {
  poNumber: string;
  subtotal: number | null; // centavos
  taxAmount: number | null; // centavos
}

/**
 * Simula que el PROVEEDOR emitió su CFDI por esta OC (por referencias).
 * Requiere que supplier.taxId sea un RFC de prueba del catálogo SAT con CSD
 * disponible (ver sat-test-data). Devuelve el UUID timbrado.
 */
export async function simularEmisionProveedor(oc: OcParaSimular, tinProveedor: string): Promise<EmisionSimulada> {
  return timbrarPorReferencias({
    concepto: `Factura OC ${oc.poNumber}`,
    tinEmisor: tinProveedor,
    subtotal: (oc.subtotal ?? 0) / 100,
    taxAmount: (oc.taxAmount ?? 0) / 100,
  });
}

export interface GastoParaSimular {
  id: string;
  description: string;
  /** Monto CON IVA registrado en el ticket, en centavos. */
  amount: number | null;
  /** RFC de prueba del payee (emisor simulado). */
  tinPayee: string;
}

/**
 * Igual que la OC pero para un gasto operativo: el monto registrado incluye
 * IVA (precio de ticket), así que se desglosa antes de emitir.
 */
export async function simularEmisionGasto(gasto: GastoParaSimular): Promise<EmisionSimulada> {
  const totalCentavos = gasto.amount ?? 0;
  if (totalCentavos <= 0) throw new Error(`Gasto ${gasto.id} sin monto utilizable`);
  const subtotalCentavos = Math.round(totalCentavos / 1.16);
  return timbrarPorReferencias({
    concepto: `Factura gasto: ${gasto.description}`.slice(0, 200),
    tinEmisor: gasto.tinPayee!,
    subtotal: subtotalCentavos / 100,
    taxAmount: (totalCentavos - subtotalCentavos) / 100,
  });
}

// ---------------------------------------------------------------------------
// Metadatos + conciliación contra Pulso
// ---------------------------------------------------------------------------

export interface FacturaRecibida {
  uuid: string | null;
  issuerTin: string | null;
  issuerName: string | null;
  total: number | null;
  fecha: string | null;
}

interface MetadataItemCrudo {
  invoiceUuid?: string;
  issuerTin?: string;
  issuerName?: string;
  /** Campo real observado en live (monto total con impuestos, en pesos). */
  amount?: number | string;
  total?: number | string;
  monto?: number | string;
  invoiceDate?: string;
}

/** Metadatos de facturas recibidas asociados a la solicitud terminada. */
export async function obtenerMetadatos(requestId: string): Promise<FacturaRecibida[]> {
  const client = getFiscalApiClient();
  // Firma real del SDK: getMetadataItems(requestId), sin paginación.
  const r = await client.downloadRequests.getMetadataItems(requestId);
  if (!r.succeeded) throw new Error(`getMetadataItems falló: ${r.message} ${String(r.details ?? "")}`);

  const items: unknown[] =
    (r.data as unknown as { items?: unknown[] } | undefined)?.items ??
    (Array.isArray(r.data) ? (r.data as unknown[]) : []);

  return items.map((raw) => {
    const m = raw as MetadataItemCrudo;
    const monto = m.amount ?? m.total ?? m.monto;
    return {
      uuid: m.invoiceUuid ?? null,
      issuerTin: m.issuerTin?.toUpperCase() ?? null,
      issuerName: m.issuerName ?? null,
      total: monto != null ? Number(monto) : null,
      fecha: m.invoiceDate ?? null,
    };
  });
}

export interface ConciliacionBuzon {
  factura: FacturaRecibida;
  /** Proveedor o payee de Pulso cuyo taxId coincide con el emisor. */
  contraparte: string | null;
  /** OC cuyo total coincide (±$0.01) con el monto del comprobante. */
  ocCoincidente: string | null;
  /** Gasto operativo cuyo total coincide (±$0.01). */
  gastoCoincidente: string | null;
}

/**
 * Concilia lo recibido contra la BD: emisor → proveedor por taxId, y dentro
 * de sus OCs, la de total idéntico. Es el mismo espíritu del 3-way match de
 * invoice-matching-service, pero desde el lado del buzón.
 */
export async function conciliar(facturas: FacturaRecibida[]): Promise<ConciliacionBuzon[]> {
  const out: ConciliacionBuzon[] = [];
  for (const factura of facturas) {
    if (!factura.issuerTin || factura.total == null) {
      out.push({ factura, contraparte: null, ocCoincidente: null, gastoCoincidente: null });
      continue;
    }
    const esperado = Math.round(factura.total * 100);

    const [proveedor] = await db
      .select({ name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.taxId, factura.issuerTin))
      .limit(1);
    const [payee] = proveedor
      ? [undefined]
      : await db.select({ name: payees.name }).from(payees).where(eq(payees.taxId, factura.issuerTin)).limit(1);
    const contraparte = proveedor?.name ?? payee?.name ?? null;

    let ocCoincidente: string | null = null;
    if (proveedor) {
      // Más reciente primero: si dos OCs comparten total, gana la última.
      const ocs = await db
        .select({ poNumber: purchaseOrders.poNumber, totalAmount: purchaseOrders.totalAmount })
        .from(purchaseOrders)
        .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
        .where(and(eq(suppliers.taxId, factura.issuerTin)))
        .orderBy(desc(purchaseOrders.createdAt));
      ocCoincidente =
        ocs.find((o) => Math.abs((o.totalAmount ?? Number.NaN) - esperado) <= 1)?.poNumber ?? null;
    }

    let gastoCoincidente: string | null = null;
    if (payee) {
      const gastos = await db
        .select({ description: operatingExpenses.description, amount: operatingExpenses.amount })
        .from(operatingExpenses)
        .innerJoin(payees, eq(operatingExpenses.payeeId, payees.id))
        .where(eq(payees.taxId, factura.issuerTin));
      const hit = gastos.find((g) => Math.abs((g.amount ?? Number.NaN) - esperado) <= 1);
      gastoCoincidente = hit ? hit.description.slice(0, 40) : null;
    }

    out.push({ factura, contraparte, ocCoincidente, gastoCoincidente });
  }
  return out;
}
