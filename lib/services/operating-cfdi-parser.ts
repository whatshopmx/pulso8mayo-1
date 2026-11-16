import { SaxesParser } from "saxes";
import { ApiError, isApiError } from "@/lib/api/error";

export const MAX_OPERATING_CFDI_BYTES = 1024 * 1024;
const CFDI = "http://www.sat.gob.mx/cfd/4";
const TFD = "http://www.sat.gob.mx/TimbreFiscalDigital";
const SCALE = BigInt(1000000);
const MAX_DB_CENTS = BigInt(2147483647);
interface Element { uri: string; name: string; attrs: Record<string, string>; children: Element[] }
export interface OperatingCfdiTax {
  code: "002"; factor: "Tasa" | "Exento"; rate?: string; baseCents: number; amountCents: number;
}
export interface OperatingCfdiPreview {
  uuid: string; version: "4.0"; invoiceType: "I"; fecha: string; folio?: string; serie?: string; currency: "MXN";
  emitter: { rfc: string; name: string }; receiver: { rfc: string; name: string };
  subtotalCents: number; taxCents: number; withheldTaxCents: 0; totalCents: number;
  taxes: OperatingCfdiTax[];
  concepts: { code: string; description: string; quantity: string; unitCode: string; unitValue: string;
    amountCents: number; taxObject: string; taxes: OperatingCfdiTax[] }[];
}
const reject = (message: string): never => { throw ApiError.badRequest(message); };
const attr = (node: Element, key: string) => {
  const value = node.attrs[key];
  if (!value?.trim()) reject(`El CFDI requiere el atributo ${key}.`);
  return value;
};
function children(node: Element, allowed: string[], uri = CFDI) {
  if (node.children.some(c => c.uri !== uri || !allowed.includes(c.name))) {
    reject("El CFDI contiene nodos, relaciones o complementos no soportados para gastos operativos.");
  }
}
function one(node: Element, name: string, required = true): Element | undefined {
  const matches = node.children.filter(c => c.name === name);
  if (matches.length > 1 || (required && matches.length !== 1)) reject(`El CFDI requiere un único nodo ${name}.`);
  return matches[0];
}
function decimal(value: string, label: string) {
  if (!/^\d{1,14}(?:\.\d{1,6})?$/.test(value)) reject(`El ${label} debe ser un decimal no negativo, sin exponentes y con máximo seis decimales.`);
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * SCALE + BigInt(fraction.padEnd(6, "0"));
}
function cents(value: string, label: string) {
  const amount = decimal(value, label);
  if (amount % BigInt(10000) !== BigInt(0)) reject(`El ${label} tiene fracciones de centavo no soportadas; no se redondea.`);
  const result = amount / BigInt(10000);
  if (result > MAX_DB_CENTS) reject(`El ${label} excede el importe máximo soportado.`);
  return Number(result);
}
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value) || value.startsWith("0000")) reject("La fecha del CFDI o timbre no es válida.");
  const parsed = new Date(`${value}Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== value) reject("La fecha del CFDI o timbre no es válida.");
  return value;
}
export function normalizeCfdiRfc(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(normalized)) reject("El RFC del CFDI o de la empresa no tiene un formato válido.");
  return normalized;
}
function readXml(xml: string): Element {
  if (!xml || Buffer.byteLength(xml, "utf8") > MAX_OPERATING_CFDI_BYTES) reject("El XML está vacío o excede el tamaño máximo de 1 MB.");
  const stack: Element[] = [];
  let root: Element | undefined, count = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("error", () => reject("El archivo no es un XML válido y completo."));
  parser.on("doctype", () => reject("No se permiten DTD ni declaraciones de entidades en el XML."));
  parser.on("xmldecl", declaration => {
    if (declaration.version !== "1.0") reject("Solo se admiten documentos XML 1.0.");
    if (declaration.encoding && !/^utf-?8$/i.test(declaration.encoding)) reject("Solo se admiten XML con codificación UTF-8.");
  });
  parser.on("opentag", tag => {
    if (++count > 10000 || stack.length >= 24) reject("El XML excede los límites de estructura soportados.");
    const node: Element = { uri: tag.uri, name: tag.local, attrs: Object.create(null), children: [] };
    for (const attribute of Object.values(tag.attributes)) {
      if (!attribute.uri) node.attrs[attribute.local] = attribute.value;
      else if (attribute.uri !== "http://www.w3.org/2000/xmlns/"
        && !(attribute.uri === "http://www.w3.org/2001/XMLSchema-instance" && attribute.local === "schemaLocation")) {
        reject("El CFDI contiene atributos con namespaces no soportados.");
      }
    }
    if (stack.length) stack[stack.length - 1].children.push(node);
    else { if (root) reject("El XML debe contener un único comprobante."); root = node; }
    stack.push(node);
  });
  parser.on("closetag", () => { stack.pop(); });
  const text = (value: string) => { if (value.trim()) reject("El CFDI contiene texto fuera de los atributos fiscales soportados."); };
  parser.on("text", text); parser.on("cdata", text);
  try { parser.write(xml).close(); } catch (error) {
    if (isApiError(error)) throw error;
    reject("El archivo no es un XML válido y completo.");
  }
  if (!root || stack.length || root.uri !== CFDI || root.name !== "Comprobante") reject("Se requiere un comprobante CFDI 4.0 con namespace válido.");
  return root;
}
function readTax(node: Element, calculate: boolean): OperatingCfdiTax {
  children(node, []);
  if (attr(node, "Impuesto") !== "002") reject("Solo se admite IVA trasladado; IEPS y otros impuestos requieren un tratamiento no soportado.");
  const baseCents = cents(attr(node, "Base"), "base del IVA");
  if (!baseCents) reject("La base del IVA debe ser positiva.");
  const factor = attr(node, "TipoFactor");
  if (factor === "Exento") {
    if (node.attrs.Importe !== undefined || node.attrs.TasaOCuota !== undefined) reject("El IVA exento no debe declarar tasa o importe.");
    return { code: "002", factor, baseCents, amountCents: 0 };
  }
  if (factor !== "Tasa") reject("Solo se admite IVA por tasa o exento.");
  const rateValue = decimal(attr(node, "TasaOCuota"), "tasa de IVA");
  if (![BigInt(0), BigInt(80000), BigInt(160000)].includes(rateValue)) reject("La tasa de IVA no está soportada; solo se admite 0%, 8% o 16%.");
  const rate = `0.${String(rateValue).padStart(6, "0")}`;
  const amountCents = cents(attr(node, "Importe"), "IVA trasladado");
  // Comprobar el importe declarado con redondeo decimal explícito a centavos;
  // el resultado siempre conserva el importe del XML, no lo reemplaza.
  if (calculate && BigInt(amountCents) !== (BigInt(baseCents) * rateValue + SCALE / BigInt(2)) / SCALE) {
    reject("El importe del IVA no corresponde a su base y tasa.");
  }
  return { code: "002", factor: "Tasa", rate, baseCents, amountCents };
}
const key = (tax: OperatingCfdiTax) => `${tax.factor}:${tax.rate ?? ""}`;
function transfers(node: Element, calculate: boolean): OperatingCfdiTax[] {
  if (node.attrs.TotalImpuestosRetenidos !== undefined || node.children.some(c => c.name === "Retenciones")) reject("Las retenciones requieren un tratamiento no soportado.");
  children(node, ["Traslados"]); // Retenciones y cualquier otro impuesto se rechazan.
  const group = one(node, "Traslados"); children(group, ["Traslado"]);
  if (!group.children.length) reject("El desglose de impuestos está vacío.");
  const result = group.children.map(t => readTax(t, calculate));
  if (new Set(result.map(key)).size !== result.length) reject("El desglose de IVA contiene traslados duplicados.");
  return result;
}

/** Validación local y acotada: no consulta al SAT ni verifica firmas criptográficas. */
export function parseOperatingCfdi(xml: string, expectedReceiverRfc: string): OperatingCfdiPreview {
  const root = readXml(xml);
  if (attr(root, "Version") !== "4.0" || attr(root, "TipoDeComprobante") !== "I") reject("Solo se admite CFDI 4.0 de ingreso para el gasto operativo.");
  if (attr(root, "Moneda") !== "MXN") reject("Solo se admiten CFDI de gastos en MXN.");
  if (root.attrs.Descuento !== undefined) reject("Los descuentos requieren un tratamiento no soportado.");
  if (root.attrs.TipoCambio !== undefined && decimal(root.attrs.TipoCambio, "tipo de cambio") !== SCALE) reject("No se admite conversión de moneda para el gasto operativo.");
  children(root, ["Emisor", "Receptor", "Conceptos", "Impuestos", "Complemento"]);
  const issuer = one(root, "Emisor"), receiverNode = one(root, "Receptor");
  children(issuer, []); children(receiverNode, []);
  const emitter = { rfc: normalizeCfdiRfc(attr(issuer, "Rfc")), name: attr(issuer, "Nombre") };
  const receiver = { rfc: normalizeCfdiRfc(attr(receiverNode, "Rfc")), name: attr(receiverNode, "Nombre") };
  if (receiver.rfc !== normalizeCfdiRfc(expectedReceiverRfc)) reject("El RFC receptor del CFDI no corresponde a esta empresa.");
  const complement = one(root, "Complemento"); children(complement, ["TimbreFiscalDigital"], TFD);
  const stamp = one(complement, "TimbreFiscalDigital"); children(stamp, []);
  if (attr(stamp, "Version") !== "1.1") reject("Se requiere un timbre fiscal digital 1.1.");
  const uuid = attr(stamp, "UUID").toUpperCase();
  if (!/^[\dA-F]{8}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{4}-[\dA-F]{12}$/.test(uuid) || !/[1-9A-F]/.test(uuid)) reject("El UUID del timbre fiscal no es válido.");
  date(attr(stamp, "FechaTimbrado")); normalizeCfdiRfc(attr(stamp, "RfcProvCertif"));
  if (!/^\d{20}$/.test(attr(stamp, "NoCertificadoSAT"))) reject("El certificado SAT del timbre no tiene un formato válido.");
  attr(stamp, "SelloSAT");
  if (attr(stamp, "SelloCFD") !== attr(root, "Sello")) reject("El sello declarado en el timbre no coincide con el del comprobante.");

  const conceptGroup = one(root, "Conceptos"); children(conceptGroup, ["Concepto"]);
  if (!conceptGroup.children.length) reject("El CFDI debe contener al menos un concepto.");
  const concepts = conceptGroup.children.map(concept => {
    children(concept, ["Impuestos"]);
    if (concept.attrs.Descuento !== undefined) reject("Los descuentos requieren un tratamiento no soportado.");
    const quantity = attr(concept, "Cantidad"), unitValue = attr(concept, "ValorUnitario");
    const quantityValue = decimal(quantity, "cantidad"), unitValue6 = decimal(unitValue, "valor unitario");
    const amountCents = cents(attr(concept, "Importe"), "importe del concepto");
    if (quantityValue <= BigInt(0) || unitValue6 <= BigInt(0) || !amountCents
      || quantityValue * unitValue6 !== BigInt(amountCents) * BigInt(10000) * SCALE) reject("La cantidad, valor unitario e importe del concepto no concilian exactamente.");
    const taxObject = attr(concept, "ObjetoImp"), taxNode = one(concept, "Impuestos", false);
    if (!["01", "02"].includes(taxObject)) reject("El objeto de impuesto requiere un desglose no soportado.");
    if ((taxObject === "01" && taxNode) || (taxObject === "02" && !taxNode)) reject("El objeto de impuesto y su desglose no coinciden.");
    const taxes = taxNode ? transfers(taxNode, true) : [];
    if (taxes.length > 1 || taxes.some(t => t.baseCents !== amountCents)) reject("Solo se admite una base íntegra de IVA por concepto, sin mezcla de tratamientos.");
    return { code: attr(concept, "ClaveProdServ"), description: attr(concept, "Descripcion"), quantity,
      unitCode: attr(concept, "ClaveUnidad"), unitValue, amountCents, taxObject, taxes };
  });
  const subtotalCents = cents(attr(root, "SubTotal"), "subtotal"), totalCents = cents(attr(root, "Total"), "total");
  if (!subtotalCents || concepts.reduce((sum, c) => sum + c.amountCents, 0) !== subtotalCents) reject("El subtotal no coincide con los conceptos del CFDI.");
  const grouped = new Map<string, OperatingCfdiTax>();
  for (const tax of concepts.flatMap(c => c.taxes)) {
    const previous = grouped.get(key(tax));
    grouped.set(key(tax), { ...tax, baseCents: tax.baseCents + (previous?.baseCents ?? 0), amountCents: tax.amountCents + (previous?.amountCents ?? 0) });
  }
  const global = one(root, "Impuestos", false), taxes = global ? transfers(global, false) : [];
  if (taxes.length !== grouped.size || taxes.some(t => {
    const expected = grouped.get(key(t));
    return !expected || t.baseCents !== expected.baseCents || t.amountCents !== expected.amountCents;
  })) reject("El IVA global no coincide con el desglose de los conceptos.");
  const taxCents = taxes.reduce((sum, t) => sum + t.amountCents, 0);
  const declaredTax = global?.attrs.TotalImpuestosTrasladados;
  if ((taxes.some(t => t.factor === "Tasa") && declaredTax === undefined)
    || (declaredTax !== undefined && cents(declaredTax, "total de IVA") !== taxCents)) reject("El total de IVA no coincide con los traslados declarados.");
  if (totalCents !== subtotalCents + taxCents) reject("El total del CFDI no concilia con subtotal e IVA; no se infiere un impuesto neto.");
  return { uuid, version: "4.0", invoiceType: "I", fecha: date(attr(root, "Fecha")), folio: root.attrs.Folio,
    serie: root.attrs.Serie, currency: "MXN", emitter, receiver, subtotalCents, taxCents, withheldTaxCents: 0, totalCents, taxes, concepts };
}
