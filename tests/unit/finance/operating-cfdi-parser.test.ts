import { describe, expect, it } from "vitest";
import { parseOperatingCfdi, MAX_OPERATING_CFDI_BYTES } from "@/lib/services/operating-cfdi-parser";

const rfc = "BBB010101BBB";
const tax = `<cfdi:Traslado Base="1000.01" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/>`;
function xml() {
  return `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
    Version="4.0" TipoDeComprobante="I" Fecha="2026-11-16T12:00:00" SubTotal="1000.01" Total="1160.01" Moneda="MXN" Sello="synthetic">
    <cfdi:Emisor Rfc="AAA010101AAA" Nombre="Insumos &amp; mantenimiento"/>
    <cfdi:Receptor Rfc="${rfc}" Nombre="Restaurante"/>
    <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="81101700" Cantidad="1" ClaveUnidad="E48" Descripcion="Mantenimiento" ValorUnitario="1000.01" Importe="1000.01" ObjetoImp="02">
      <cfdi:Impuestos><cfdi:Traslados>${tax}</cfdi:Traslados></cfdi:Impuestos>
    </cfdi:Concepto></cfdi:Conceptos>
    <cfdi:Impuestos TotalImpuestosTrasladados="160.00"><cfdi:Traslados>${tax}</cfdi:Traslados></cfdi:Impuestos>
    <cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="00000000-0000-4000-8000-000000000001"
      FechaTimbrado="2026-11-16T12:01:00" RfcProvCertif="AAA010101AAA" NoCertificadoSAT="00000000000000000001" SelloCFD="synthetic" SelloSAT="synthetic"/></cfdi:Complemento>
  </cfdi:Comprobante>`;
}
const parse = (text = xml()) => parseOperatingCfdi(text, rfc);

describe("T06a: CFDI operativo validado sin inferir impuesto neto", () => {
  it("conserva identidad, centavos y desglose de IVA y decodifica entidades XML", () => {
    expect(parse()).toMatchObject({ uuid: "00000000-0000-4000-8000-000000000001", version: "4.0",
      fecha: "2026-11-16T12:00:00", currency: "MXN", emitter: { rfc: "AAA010101AAA", name: "Insumos & mantenimiento" },
      receiver: { rfc }, subtotalCents: 100001, taxCents: 16000, withheldTaxCents: 0, totalCents: 116001,
      taxes: [{ code: "002", factor: "Tasa", rate: "0.160000", baseCents: 100001, amountCents: 16000 }] });
  });
  it("admite comillas simples y prefijos distintos con el mismo namespace", () => {
    expect(parse(xml().replaceAll('"', "'").replaceAll("cfdi:", "c:").replace("xmlns:cfdi", "xmlns:c"))).toMatchObject({ totalCents: 116001 });
  });
  it("admite importe con ceros finales sin redondear", () => {
    expect(parse(xml().replaceAll('"1000.01"', '"1000.010000"'))).toMatchObject({ subtotalCents: 100001 });
  });
  it("admite CFDI sin impuesto, con cero explícito en el resultado", () => {
    const text = xml().replace(/<cfdi:Impuestos[\s\S]*?<\/cfdi:Impuestos>/g, "")
      .replace('ObjetoImp="02"', 'ObjetoImp="01"').replace('Total="1160.01"', 'Total="1000.01"');
    expect(parse(text)).toMatchObject({ taxCents: 0, withheldTaxCents: 0, totalCents: 100001, taxes: [] });
  });
  it("admite IVA exento sin inventar una tasa o importe en XML", () => {
    const exempt = '<cfdi:Traslado Base="1000.01" Impuesto="002" TipoFactor="Exento"/>';
    expect(parse(xml().replaceAll(tax, exempt).replace(' TotalImpuestosTrasladados="160.00"', "")
      .replace('Total="1160.01"', 'Total="1000.01"'))).toMatchObject({ taxCents: 0, taxes: [{ factor: "Exento", amountCents: 0 }] });
  });
  it.each([["0.080000", "80.00", "1080.01", 8000], ["0.000000", "0.00", "1000.01", 0]] as const)(
    "admite IVA por tasa %s", (rate, amount, total, expected) => {
      expect(parse(xml().replaceAll("0.160000", rate).replaceAll("160.00", amount)
        .replace('Total="1160.01"', `Total="${total}"`)).taxCents).toBe(expected);
    });
  it("agrupa dos conceptos de la misma tasa sin duplicar el impuesto", () => {
    const text = xml(), concept = text.match(/<cfdi:Concepto\s[\s\S]*?<\/cfdi:Concepto>/)![0];
    const global = '<cfdi:Traslado Base="2000.02" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="320.00"/>';
    const expanded = text.replace("</cfdi:Conceptos>", `${concept}</cfdi:Conceptos>`)
      .replace('SubTotal="1000.01"', 'SubTotal="2000.02"').replace('Total="1160.01"', 'Total="2320.02"')
      .replace(`<cfdi:Impuestos TotalImpuestosTrasladados="160.00"><cfdi:Traslados>${tax}</cfdi:Traslados></cfdi:Impuestos>`,
        `<cfdi:Impuestos TotalImpuestosTrasladados="320.00"><cfdi:Traslados>${global}</cfdi:Traslados></cfdi:Impuestos>`);
    const result = parse(expanded);
    expect(result).toMatchObject({ subtotalCents: 200002, taxCents: 32000, totalCents: 232002 });
    expect(result.concepts).toHaveLength(2); expect(result.taxes).toHaveLength(1);
  });
  it.each([
    ["retenciones", (s: string) => s.replace('Total="1160.01"', 'Total="1060.01"').replace('TotalImpuestosTrasladados="160.00"', 'TotalImpuestosTrasladados="160.00" TotalImpuestosRetenidos="100.00"')],
    ["IEPS", (s: string) => s.replaceAll('Impuesto="002"', 'Impuesto="003"')],
    ["descuento", (s: string) => s.replace('SubTotal="1000.01"', 'SubTotal="1000.01" Descuento="0.01"')],
    ["complemento monetario", (s: string) => s.replace("<cfdi:Complemento>", '<cfdi:Complemento><local:ImpuestosLocales xmlns:local="http://www.sat.gob.mx/implocal"/>')],
    ["USD", (s: string) => s.replace('Moneda="MXN"', 'Moneda="USD"')],
    ["egreso", (s: string) => s.replace('TipoDeComprobante="I"', 'TipoDeComprobante="E"')],
    ["versión 3.3", (s: string) => s.replace('Version="4.0"', 'Version="3.3"')],
    ["objeto sin desglose", (s: string) => s.replace('ObjetoImp="02"', 'ObjetoImp="03"')],
  ])("rechaza tratamiento no soportado: %s", (_label, change) => { expect(() => parse(change(xml()))).toThrow(); });
  it.each([
    ["receptor ajeno", (s: string) => s.replace(rfc, "CCC010101CCC")],
    ["namespace falso", (s: string) => s.replace("http://www.sat.gob.mx/cfd/4", "https://attacker.invalid")],
    ["UUID inválido", (s: string) => s.replace("00000000-0000-4000-8000-000000000001", "UUID-FALSO")],
    ["sin timbre", (s: string) => s.replace(/<cfdi:Complemento>[\s\S]*?<\/cfdi:Complemento>/, "")],
    ["XML truncado", (s: string) => s.slice(0, -20)],
    ["receptor duplicado", (s: string) => s.replace("<cfdi:Conceptos>", `<cfdi:Receptor Rfc="${rfc}" Nombre="Otro"/><cfdi:Conceptos>`)],
    ["fecha imposible", (s: string) => s.replace("2026-11-16T12:00:00", "2026-02-30T12:00:00")],
    ["entidad desconocida", (s: string) => s.replace("mantenimiento", "&desconocida;")],
    ["atributo repetido", (s: string) => s.replace('Moneda="MXN"', 'Moneda="MXN" Moneda="USD"')],
    ["importe no finito", (s: string) => s.replace('Total="1160.01"', 'Total="Infinity"')],
    ["fracción de centavo", (s: string) => s.replace('Total="1160.01"', 'Total="1160.011"')],
    ["exponente", (s: string) => s.replace('SubTotal="1000.01"', 'SubTotal="1e3"')],
    ["descuadre de total", (s: string) => s.replace('Total="1160.01"', 'Total="1160.02"')],
    ["impuesto global distinto", (s: string) => s.replace('TotalImpuestosTrasladados="160.00"', 'TotalImpuestosTrasladados="159.99"')],
    ["impuesto incompatible con tasa", (s: string) => s.replaceAll('Importe="160.00"', 'Importe="159.99"')],
    ["cantidad incompatible", (s: string) => s.replace('Cantidad="1"', 'Cantidad="2"')],
    ["desbordamiento DB", (s: string) => s.replace('Total="1160.01"', 'Total="21474836.48"')],
    ["base incompatible", (s: string) => s.replaceAll('Base="1000.01"', 'Base="999.99"')],
    ["subcentavo de concepto", (s: string) => s.replace('Importe="1000.01"', 'Importe="1000.011"')],
    ["sello incompatible", (s: string) => s.replace('SelloCFD="synthetic"', 'SelloCFD="otro"')],
    ["XML con dos raíces", (s: string) => s + s],
    ["XML 1.1", (s: string) => '<?xml version="1.1"?>' + s],
    ["nombre vacío", (s: string) => s.replace('Nombre="Restaurante"', 'Nombre="   "')],
  ])("rechaza %s", (_label, change) => { expect(() => parse(change(xml()))).toThrow(); });
  it("rechaza DTD y entidades externas sin resolver archivos ni red", () => {
    expect(() => parse('<!DOCTYPE cfdi:Comprobante [<!ENTITY xxe SYSTEM "file:///secret">]>' + xml())).toThrow(/DTD|entidades/);
  });
  it("no interpreta comprobantes dentro de comentarios como un documento fiscal", () => {
    expect(() => parse(`<!--${xml()}-->`)).toThrow();
  });
  it("rechaza archivos demasiado grandes también en la API del parser", () => {
    expect(() => parse(" ".repeat(MAX_OPERATING_CFDI_BYTES + 1))).toThrow(/tamaño|MB/);
  });
  it("limita la profundidad antes de construir un árbol arbitrario", () => {
    expect(() => parse("<a>".repeat(25) + "</a>".repeat(25))).toThrow(/estructura/);
  });
});
