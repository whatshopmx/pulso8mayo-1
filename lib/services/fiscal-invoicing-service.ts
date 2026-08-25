// M15+: Facturación CFDI 4.0 de compras y gastos vía FiscalAPI.
//
// Traduce documentos operativos de Pulso a comprobantes fiscales de prueba:
//   - Órdenes de compra  → el **proveedor** emite; una partida por línea con
//     IVA por línea.
//   - Gastos operativos  → la contraparte (payee) emite; concepto único con
//     desglose de IVA 16%.
//
// Los emisores se resuelven contra el catálogo oficial de personas de prueba
// del SAT (`lib/fiscal/sat-test-data.ts`): si el proveedor/payee tiene un RFC
// de prueba válido, ese RFC emite con su propio CSD (el SAT rechaza certificados
// cruzados); si no, entra el emisor de respaldo. El receptor es la empresa
// Pulso mapeada a otro RFC del catálogo. Todo en modo **por valores**
// (docs.fiscalapi.com/modes-of-operation): sin catálogos precargados.

import type { Invoice } from "fiscalapi";
import { and, eq, inArray, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventoryItems,
  operatingExpenses,
  payees,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
} from "@/lib/db/schema";
import { getFiscalApiClient, DEFAULT_TEST_ISSUER, DEFAULT_TEST_RECIPIENT } from "@/lib/fiscal/fiscalapi";
import {
  loadCsdForTin,
  resolveTestPerson,
  type SatTestPerson,
} from "@/lib/fiscal/sat-test-data";

/** Los montos de Pulso viven en centavos enteros; el CFDI usa pesos decimales. */
const centavos = (cents: number) => Math.round(cents) / 100;

/** Redondeo a 2 decimales, como exige el anexo 20 para importes del CFDI. */
const dosDecimales = (n: number) => Math.round(n * 100) / 100;

export interface CfdiVerification {
  /** Total que Pulso calculó localmente desde su propia data. */
  expectedTotal: number;
  /** Total que devolvió el timbre del PAC. */
  stampedTotal: number | null;
  /** true si coinciden dentro de un centavo. */
  totalsMatch: boolean;
}

export interface StampedCfdi extends CfdiVerification {
  source: "PURCHASE_ORDER" | "OPERATING_EXPENSE";
  sourceId: string;
  reference: string;
  uuid: string | null;
  invoiceId: string | null;
  status: "TIMBRADO" | "PENDIENTE" | "RECHAZADO" | "ERROR";
  satStatus?: string;
  message?: string;
  /** RFC de prueba que emitió el comprobante. */
  issuerTin?: string;
  /** true si el emisor salió del catálogo; false si fue respaldo. */
  issuerMatched?: boolean;
  /** RFC de prueba receptor (la empresa Pulso). */
  recipientTin?: string;
}

interface ItemTaxPayload {
  taxCode: string; // 002 = IVA
  taxTypeCode: string; // Tasa
  /**
   * Tasa con los 6 decimales exactos del catálogo c_TasaOCuota. El PAC
   * rechaza (CFDI40179) un `0.16` numérico porque no coincide textualmente
   * con el valor del catálogo (`0.160000`).
   */
  taxRate: string;
  taxFlagCode: string; // T = trasladado
}

interface CfdiItemPayload {
  itemCode: string;
  quantity: number;
  unitOfMeasurementCode: string;
  description: string;
  unitPrice: number;
  taxObjectCode: string;
  itemSku?: string;
  itemTaxes?: ItemTaxPayload[];
}

/**
 * Receptor fijo de las pruebas: la empresa Pulso, representada por un RFC del
 * catálogo. Override con FISCALAPI_COMPANY_TEST_TIN (debe existir en el
 * catálogo; si no, se queda el default).
 */
function resolveRecipient(): SatTestPerson {
  const override = resolveTestPerson(process.env.FISCALAPI_COMPANY_TEST_TIN);
  return override ?? DEFAULT_TEST_RECIPIENT;
}

/**
 * Emisor de un comprobante: si el taxId del proveedor/payee es una persona de
 * prueba válida, emite él mismo con su CSD; si no, respaldo genérico. Devuelve
 * también si hubo match, para que el reporte distinga datos reales de respaldo.
 */
function resolveIssuer(taxId: string | null | undefined): { person: SatTestPerson; matched: boolean } {
  const matched = resolveTestPerson(taxId);
  if (matched) return { person: matched, matched: true };
  return { person: DEFAULT_TEST_ISSUER, matched: false };
}

/**
 * Total esperado según el anexo 20 del SAT: subtotal por línea más el IVA
 * redondeado **por línea** a centavos. Es la cuenta que hace FiscalAPI detrás
 * de cámaras; replicarla es lo que permite verificar el timbre contra Pulso.
 */
function expectedTotalOf(items: CfdiItemPayload[]): number {
  const total = items.reduce((acc, it) => {
    const subtotal = it.quantity * it.unitPrice;
    const rate = Number(it.itemTaxes?.[0]?.taxRate ?? 0);
    return acc + subtotal + dosDecimales(subtotal * rate);
  }, 0);
  return dosDecimales(total);
}

function buildInvoiceBase(items: CfdiItemPayload[], series: string, issuer: SatTestPerson, recipient: SatTestPerson): Invoice {
  return {
    versionCode: "4.0",
    series,
    // Margen de 2h al pasado: el rango del PAC es [−72h, +5min] respecto a su
    // reloj, pero los nodos del sandbox desplazan la fecha de emisión hasta
    // +1h según cómo interpreten la zona horaria. Un pasado moderado pasa en
    // cualquier nodo; una fecha "exacta" falla aleatoriamente.
    date: new Date(Date.now() - 2 * 60 * 60 * 1000),
    paymentFormCode: "03", // transferencia electrónica
    currencyCode: "MXN",
    typeCode: "I", // ingreso: el comprobante ampara la venta de bienes/servicios
    expeditionZipCode: issuer.zipCode,
    exportCode: "01",
    paymentMethodCode: "PUE",
    paymentConditions: "Contado",
    exchangeRate: 1,
    issuer: {
      tin: issuer.tin,
      legalName: issuer.legalName,
      taxRegimeCode: issuer.taxRegimeCode,
      taxCredentials: loadCsdForTin(issuer.tin),
    },
    recipient: {
      tin: recipient.tin,
      legalName: recipient.legalName,
      zipCode: recipient.zipCode,
      taxRegimeCode: recipient.taxRegimeCode,
      cfdiUseCode: "G01", // adquisición de mercancías / gastos en general
    },
    items,
  };
}

/** IVA trasladado por línea cuando la OC lo trae; sin impuestos si es tasa 0. */
function taxesForLine(taxRatePercent: number): ItemTaxPayload[] | undefined {
  if (!taxRatePercent || taxRatePercent <= 0) return undefined;
  const tasaCatalogo = `${(taxRatePercent / 100).toFixed(6)}`; // 16% → "0.160000"
  return [{ taxCode: "002", taxTypeCode: "Tasa", taxRate: tasaCatalogo, taxFlagCode: "T" }];
}

/**
 * Mensaje real del PAC. El SDK usa axios, que resume todo a "Request failed
 * with status code 400": sin el cuerpo (ProblemDetails / ApiResponse) no se
 * puede diagnosticar un rechazo.
 */
function extraerMensajeDeError(error: unknown): string {
  if (error && typeof error === "object" && "isAxiosError" in error) {
    const ax = error as { response?: { status?: number; data?: unknown } };
    const data = ax.response?.data as Record<string, unknown> | undefined;
    if (data && typeof data === "object") {
      // ProblemDetails (RFC 9457): { title, detail, errors? }
      if (data.title || data.detail) {
        const base = `${data.title ?? ""} ${data.detail ?? ""}`.trim();
        const errores = data.errors ? JSON.stringify(data.errors) : "";
        return `${base}${errores ? " · " + errores : ""} (HTTP ${ax.response?.status})`.slice(0, 500);
      }
      // ApiResponse: { succeeded, message, details }
      if (data.message) {
        return `${data.message}${data.details ? " — " + String(data.details) : ""} (HTTP ${ax.response?.status})`.slice(0, 500);
      }
      return `HTTP ${ax.response?.status}: ${JSON.stringify(data).slice(0, 300)}`;
    }
    return `FiscalAPI respondió HTTP ${ax.response?.status ?? "?"} sin cuerpo`; 
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Consulta el estatus SAT con reintentos cortos. El servicio de consulta del
 * SAT tarda unos segundos en reflejar un timbre recién hecho y contesta
 * "No Encontrado" mientras tanto — no es un rechazo.
 */
async function consultarEstatusSat(client: ReturnType<typeof getFiscalApiClient>, invoiceId: string): Promise<string | undefined> {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await client.invoices.getStatus({ id: invoiceId });
      const estado = r.data?.status;
      if (estado && !/no encontrado/i.test(estado)) return estado;
    } catch {
      /* reintento */
    }
    if (intento < 3) await new Promise((res) => setTimeout(res, 4_000));
  }
  return undefined; // sigue propagándose; no invalida el timbre
}

/**
 * SKU obligatorio en modo por valores ('Item Sku' must not be empty). Los
 * insumos sin SKU del catálogo reciben uno determinista derivado de su id:
 * estable entre corridas, así FiscalAPI reutiliza el producto en vez de chocar
 * con un duplicado.
 */
function skuDeLinea(itemId: string, sku: string | undefined | null): string {
  return sku && sku.trim() ? sku.trim().slice(0, 90) : `PLS-${itemId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

/**
 * Detecta el dedup de FiscalAPI: un intento anterior del mismo comprobante ya
 * dejó registro (típico al reintentar tras corregir otro error). No es un
 * rechazo fiscal: basta variar la serie para el reintento.
 */
function esDuplicado(message: string | undefined): boolean {
  return /same unique values/i.test(message ?? "");
}

async function stamp(
  payload: Invoice,
  meta: Pick<StampedCfdi, "source" | "sourceId" | "reference" | "issuerTin" | "issuerMatched" | "recipientTin">,
  expectedTotal: number
): Promise<StampedCfdi> {
  const base = { ...meta, expectedTotal };
  try {
    const client = getFiscalApiClient();
    let response = await client.invoices.create(payload);

    // Reintento con serie variada si el contenido ya estaba registrado.
    if (!response.succeeded && esDuplicado(response.message)) {
      const serieReintento = `${payload.series}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
      response = await client.invoices.create({ ...payload, series: serieReintento });
    }

    if (!response.succeeded || !response.data?.uuid) {
      // El SDK resume errores HTTP al texto de axios cuando el cuerpo no es
      // ProblemDetails/ApiResponse; el cuerpo crudo viaja en `details`. Sin él
      // un rechazo del PAC es indiagnóstico.
      const mensajeGenerico = /^Request failed|comunicación con el servidor/i.test(response.message ?? "");
      const detalle = String(response.details ?? "").trim();
      const message =
        mensajeGenerico && detalle
          ? `${response.message} · ${detalle}`.slice(0, 500)
          : response.message || detalle || "FiscalAPI rechazó el comprobante";

      return {
        ...base,
        uuid: response.data?.uuid ?? null,
        invoiceId: response.data?.id ?? null,
        status: "RECHAZADO",
        totalsMatch: false,
        stampedTotal: response.data?.total ?? null,
        message,
      };
    }

    // Verificación doble: el total del timbre debe cuadrar contra la cuenta
    // local. Un desfase mayor a un centavo es señal de un mapeo mal hecho.
    const stampedTotal = response.data.total ?? null;
    const satStatus = await consultarEstatusSat(client, response.data.id);

    return {
      ...base,
      uuid: response.data.uuid ?? null,
      invoiceId: response.data.id ?? null,
      status: "TIMBRADO",
      totalsMatch:
        stampedTotal !== null && Math.abs(stampedTotal - expectedTotal) <= 0.01,
      stampedTotal,
      satStatus,
      message: response.message,
    };
  } catch (error) {
    return {
      ...base,
      uuid: null,
      invoiceId: null,
      status: "ERROR",
      totalsMatch: false,
      stampedTotal: null,
      message: extraerMensajeDeError(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Órdenes de compra
// ---------------------------------------------------------------------------

export interface BuiltPurchaseOrderCfdi {
  poNumber: string;
  supplierName: string | null;
  supplierTaxId: string | null;
  issuer: SatTestPerson;
  issuerMatched: boolean;
  recipient: SatTestPerson;
  payload: Invoice;
  expectedTotal: number;
  items: CfdiItemPayload[];
}

/**
 * Arma el CFDI de una orden de compra: una partida por línea de la OC, con la
 * descripción del insumo, cantidad pedida, costo unitario e IVA de la línea.
 * El emisor es el proveedor cuando su taxId corresponde a una persona de
 * prueba del SAT; el receptor, la empresa Pulso.
 */
export async function buildPurchaseOrderCfdi(poId: string): Promise<BuiltPurchaseOrderCfdi> {
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).limit(1);
  if (!po) throw new Error(`Orden de compra ${poId} no encontrada`);
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, po.supplierId)).limit(1);
  const lines = await db.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.poId, poId));
  if (lines.length === 0) throw new Error(`La OC ${po.poNumber} no tiene partidas`);

  const { person: issuer, matched: issuerMatched } = resolveIssuer(supplier?.taxId);
  const recipient = resolveRecipient();

  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const catalog = await db
    .select({ id: inventoryItems.id, name: inventoryItems.name, sku: inventoryItems.sku })
    .from(inventoryItems)
    .where(inArray(inventoryItems.id, itemIds));
  const names = new Map(catalog.map((r) => [r.id, r.name]));
  const skus = new Map(catalog.map((r) => [r.id, r.sku ?? undefined]));

  const items: CfdiItemPayload[] = lines.map((line) => ({
    itemCode: "01010101", // c_ClaveProdServ genérica "Sin categorizar"
    quantity: line.orderedQuantity,
    unitOfMeasurementCode: "H87", // pieza
    description: `${names.get(line.itemId) ?? "Insumo"} · OC ${po.poNumber}${
      supplier ? ` · ${supplier.name}` : ""
    }`,
    unitPrice: centavos(line.unitCost),
    taxObjectCode: line.taxRate > 0 ? "02" : "01",
    itemSku: skuDeLinea(line.itemId, skus.get(line.itemId)),
    itemTaxes: taxesForLine(line.taxRate),
  }));

  return {
    poNumber: po.poNumber,
    supplierName: supplier?.name ?? null,
    supplierTaxId: supplier?.taxId ?? null,
    issuer,
    issuerMatched,
    recipient,
    items,
    payload: buildInvoiceBase(items, `PO`, issuer, recipient),
    expectedTotal: expectedTotalOf(items),
  };
}

export async function stampPurchaseOrderInvoice(poId: string): Promise<StampedCfdi> {
  const built = await buildPurchaseOrderCfdi(poId);
  return stamp(
    built.payload,
    {
      source: "PURCHASE_ORDER",
      sourceId: poId,
      reference: built.poNumber,
      issuerTin: built.issuer.tin,
      issuerMatched: built.issuerMatched,
      recipientTin: built.recipient.tin,
    },
    built.expectedTotal
  );
}

/** Las últimas OCs facturables: aprobadas y con movimiento real. */
export async function listStampablePurchaseOrders(companyId: string, limit: number) {
  return db
    .select({ id: purchaseOrders.id, poNumber: purchaseOrders.poNumber })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.companyId, companyId),
        inArray(purchaseOrders.status, ["APPROVED", "SENT", "PARTIALLY_RECEIVED", "CLOSED"])
      )
    )
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Gastos operativos
// ---------------------------------------------------------------------------

export interface BuiltExpenseCfdi {
  description: string;
  payeeName: string | null;
  payeeTaxId: string | null;
  issuer: SatTestPerson;
  issuerMatched: boolean;
  recipient: SatTestPerson;
  payload: Invoice;
  expectedTotal: number;
  items: CfdiItemPayload[];
}

/**
 * Arma el CFDI de un gasto operativo: concepto único con la descripción del
 * gasto. El monto registrado incluye IVA (precio de ticket), así que se
 * desglosa: precio sin IVA + IVA 16% redondeado por línea. Si el gasto tiene
 * contraparte (payee) con RFC de prueba, esa persona emite; si es gasto casual
 * sin contraparte, entra el emisor de respaldo — igual que un ticket real de
 * taxi o ferretería.
 */
export async function buildExpenseCfdi(expenseId: string): Promise<BuiltExpenseCfdi> {
  const [expense] = await db.select().from(operatingExpenses).where(eq(operatingExpenses.id, expenseId)).limit(1);
  if (!expense) throw new Error(`Gasto ${expenseId} no encontrado`);

  let payeeName: string | null = null;
  let payeeTaxId: string | null = null;
  if (expense.payeeId) {
    const [payee] = await db.select().from(payees).where(eq(payees.id, expense.payeeId)).limit(1);
    payeeName = payee?.name ?? null;
    payeeTaxId = payee?.taxId ?? null;
  }
  const { person: issuer, matched: issuerMatched } = resolveIssuer(payeeTaxId);
  const recipient = resolveRecipient();

  const total = centavos(expense.amount);
  const unitPrice = dosDecimales(total / 1.16);

  const items: CfdiItemPayload[] = [
    {
      itemCode: "01010101",
      quantity: 1,
      unitOfMeasurementCode: "E48", // unidad de medida general
      description: expense.description.slice(0, 980),
      unitPrice,
      taxObjectCode: "02",
      itemSku: skuDeLinea(expenseId, `GASTO-${expense.category}`),
      itemTaxes: [{ taxCode: "002", taxTypeCode: "Tasa", taxRate: "0.160000", taxFlagCode: "T" }],
    },
  ];

  return {
    description: expense.description,
    payeeName,
    payeeTaxId,
    issuer,
    issuerMatched,
    recipient,
    items,
    payload: buildInvoiceBase(items, `GT`, issuer, recipient),
    expectedTotal: expectedTotalOf(items),
  };
}

export async function stampExpenseInvoice(expenseId: string): Promise<StampedCfdi> {
  const built = await buildExpenseCfdi(expenseId);
  return stamp(
    built.payload,
    {
      source: "OPERATING_EXPENSE",
      sourceId: expenseId,
      reference: built.description.slice(0, 60),
      issuerTin: built.issuer.tin,
      issuerMatched: built.issuerMatched,
      recipientTin: built.recipient.tin,
    },
    built.expectedTotal
  );
}

/** Gastos aprobados/pagados, los que sí amparan un comprobante. */
export async function listStampableExpenses(companyId: string, limit: number) {
  return db
    .select({
      id: operatingExpenses.id,
      description: operatingExpenses.description,
      category: operatingExpenses.category,
    })
    .from(operatingExpenses)
    .where(and(eq(operatingExpenses.companyId, companyId), inArray(operatingExpenses.status, ["APPROVED", "PAID"])))
    .orderBy(desc(operatingExpenses.createdAt))
    .limit(limit);
}
