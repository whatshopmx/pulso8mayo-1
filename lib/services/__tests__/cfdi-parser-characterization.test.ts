import { describe, expect, it } from "vitest";
import { CFDIParserService } from "../cfdi-parser";

// F0/T01: limita lo que puede reutilizar el nuevo flujo. Estos casos describen
// el parser actual; F06 debe añadir validación fiscal antes de habilitarlo.
const xml = (currency = "MXN", total = "1160.01", taxes = "") => `
<cfdi:Comprobante Version="4.0" Fecha="2026-11-16T12:00:00" SubTotal="1000.01" Total="${total}" Moneda="${currency}">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="Insumos y mantenimiento"/>
  <cfdi:Receptor Rfc="BBB010101BBB" Nombre="Restaurante"/>
  <cfdi:Conceptos><cfdi:Concepto ClaveProdServ="81101700" Cantidad="1" ClaveUnidad="E48" Descripcion="Mantenimiento" ValorUnitario="1000.01" Importe="1000.01"/></cfdi:Conceptos>
  ${taxes}
  <cfdi:Complemento><tfd:TimbreFiscalDigital UUID="00000000-0000-4000-8000-000000000001"/></cfdi:Complemento>
</cfdi:Comprobante>`;

describe("CFDI: contrato del parser previo al alta de gastos", () => {
  it("conserva identidad, moneda e importes para la vista previa", () => {
    expect(CFDIParserService.parse(xml())).toMatchObject({
      uuid: "00000000-0000-4000-8000-000000000001", fecha: "2026-11-16T12:00:00",
      rfcEmisor: "AAA010101AAA", rfcReceptor: "BBB010101BBB", moneda: "MXN",
      subTotal: 1000.01, total: 1160.01,
      conceptos: [{ descripcion: "Mantenimiento", importe: 1000.01 }],
    });
  });

  it("no valida moneda ni receptor contra la empresa", () => {
    expect(CFDIParserService.parse(xml("USD"))).toMatchObject({ moneda: "USD", rfcReceptor: "BBB010101BBB" });
  });

  it("no representa IVA y retenciones: la diferencia neta no equivale al IVA trasladado", () => {
    const parsed = CFDIParserService.parse(xml("MXN", "1060.01", `
      <cfdi:Impuestos TotalImpuestosTrasladados="160.00" TotalImpuestosRetenidos="100.00">
        <cfdi:Retenciones><cfdi:Retencion Impuesto="001" Importe="100.00"/></cfdi:Retenciones>
        <cfdi:Traslados><cfdi:Traslado Base="1000.01" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/></cfdi:Traslados>
      </cfdi:Impuestos>`));
    expect(Math.round((parsed.total - parsed.subTotal) * 100)).toBe(6000);
    expect(parsed).not.toHaveProperty("impuestos");
    expect(parsed).not.toHaveProperty("retenciones");
  });

  it("rechaza texto sin comprobante pero no exige timbre ni cierre XML", () => {
    expect(() => CFDIParserService.parse("texto")).toThrow(/Comprobante/);
    const incomplete = xml().split("<cfdi:Complemento>")[0];
    expect(CFDIParserService.parse(incomplete).uuid).toBeUndefined();
  });
});
