import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CANONICAL_FIELDS,
  FIELD_ALIASES,
  FIELD_LABELS,
  PAYMENT_METHOD_ALIASES,
  isTotalLabel,
  matchFieldAlias,
  matchPaymentLabel,
  normalizeHeader,
  parseCount,
  parseMoneyToCents,
  type PaymentBucket,
} from "../pos-column-aliases";

/**
 * Suite de Task 8 (plan.md): diccionario de alias POS + parsers de valor de
 * `lib/services/pos-column-aliases.ts` — módulo puro, sin DB ni I/O.
 *
 * Contratos de dinero congelados aquí (hallazgos del reconocimiento):
 * - `"1.234,50"` devuelve **123** centavos: el branch "coma y punto" asume
 *   formato MX (coma=miles) sin detectar el formato europeo. Hallazgo para
 *   decisión humana; NO corregir en esta capa.
 * - La notación científica (`"1e3"`) se acepta vía parseFloat y devuelve
 *   100000 centavos; el plan pedía null. Matemáticamente correcto si el
 *   origen era numérico; congelado como comportamiento documentado.
 * - Invariante duro que SÍ se verifica: parseMoneyToCents JAMÁS devuelve NaN.
 */

describe("normalizeHeader", () => {
  it("quita acentos, baja a minúsculas y colapsa puntuación en espacios", () => {
    expect(normalizeHeader("Método de Pago")).toBe("metodo de pago");
    expect(normalizeHeader("IVA 16%")).toBe("iva 16%");
    expect(normalizeHeader("No. Tickets")).toBe("no tickets");
    expect(normalizeHeader("Día")).toBe("dia");
  });

  it("recorta y colapsa runs de separadores (tabs, múltiples espacios)", () => {
    expect(normalizeHeader("  VENTA   TOTAL\t")).toBe("venta total");
    expect(normalizeHeader("Fecha---de///Corte")).toBe("fecha de corte");
  });

  it("es idempotente para cualquier string", () => {
    const arb = fc.string({ minLength: 0, maxLength: 60 });
    fc.assert(
      fc.property(arb, (s) => {
        expect(normalizeHeader(normalizeHeader(s))).toBe(normalizeHeader(s));
        // Sólo salen minúsculas, dígitos, '%' y espacios:
        expect(normalizeHeader(s)).toMatch(/^[a-z0-9% ]*$/);
      }),
    );
  });
});

describe("matchFieldAlias — catálogo declarado sano", () => {
  it("TODOS los aliases declarados resuelven 'high' a su campo (detecta colisiones silenciosas del Map)", () => {
    for (const field of CANONICAL_FIELDS) {
      for (const alias of FIELD_ALIASES[field]) {
        // Si dos campos compartieran alias normalizado, el Map se quedaría
        // con el último y este assert fallaría para el primero:
        expect(matchFieldAlias(alias), `${field} ← "${alias}"`).toEqual({
          field,
          confidence: "high",
        });
      }
    }
  });

  it("FIELD_LABELS cubre exactamente los campos canónicos con etiqueta no vacía", () => {
    expect(Object.keys(FIELD_LABELS).sort()).toEqual([...CANONICAL_FIELDS].sort());
    for (const field of CANONICAL_FIELDS) {
      expect(FIELD_LABELS[field].length, field).toBeGreaterThan(0);
    }
  });

  it("acentos/mayúsculas/puntuación no afectan el match exacto", () => {
    expect(matchFieldAlias("FECHA DE VENTA")).toEqual({
      field: "businessDate",
      confidence: "high",
    });
    expect(matchFieldAlias("método de pago")).toEqual({
      field: "paymentMethod",
      confidence: "high",
    });
    expect(matchFieldAlias("NÚMERO DE TICKETS")).toEqual({
      field: "ticketCount",
      confidence: "high",
    });
  });

  it("fuzzy 'medium' gana el alias MÁS LARGO ('importe total' vence a 'total'/'impuesto')", () => {
    expect(matchFieldAlias("Importe Total Sin Impuestos")).toEqual({
      field: "totalSales",
      confidence: "medium",
    });
    expect(matchFieldAlias("Venta Total del Día")).toEqual({
      field: "totalSales",
      confidence: "medium",
    });
  });

  it("devuelve null para vacío o desconocido", () => {
    expect(matchFieldAlias("")).toBeNull();
    expect(matchFieldAlias("   ")).toBeNull();
    expect(matchFieldAlias("Columna Inventada")).toBeNull();
  });
});

describe("matchPaymentLabel", () => {
  it("exactos por bucket (case/acentos indiferentes)", () => {
    const casos: Array<[string, PaymentBucket]> = [
      ["EFECTIVO", "CASH"],
      ["Cash", "CASH"],
      ["tdc", "CARD"],
      ["MercadoPago", "CARD"],
      ["Uber Eats", "DELIVERY"],
      ["UBEREATS", "DELIVERY"],
      ["Vales de Despensa", "OTHER"],
      ["Transferencia", "OTHER"],
    ];
    for (const [label, bucket] of casos) {
      expect(matchPaymentLabel(label), label).toBe(bucket);
    }
  });

  it("todos los aliases declarados caen en su bucket", () => {
    for (const bucket of Object.keys(PAYMENT_METHOD_ALIASES) as PaymentBucket[]) {
      for (const alias of PAYMENT_METHOD_ALIASES[bucket]) {
        expect(matchPaymentLabel(alias), `${bucket} ← "${alias}"`).toBe(bucket);
      }
    }
  });

  it("fuzzy: contiene el alias aunque venga con ruido", () => {
    expect(matchPaymentLabel("pago con visa")).toBe("CARD");
    expect(matchPaymentLabel("comisión Rappi")).toBe("DELIVERY");
  });

  it("null para vacío o desconocido", () => {
    expect(matchPaymentLabel("")).toBeNull();
    expect(matchPaymentLabel("Cripto")).toBeNull();
  });
});

describe("isTotalLabel — filas de gran total (cross-check, nunca un pago)", () => {
  it("true para las etiquetas declaradas en cualquier variante de caso/espacios", () => {
    for (const label of [
      "Total",
      "GRAN TOTAL",
      "totales",
      "Suma",
      "Sumas",
      "total sales",
      "Grand Total",
      "  Total   General ",
    ]) {
      expect(isTotalLabel(label), label).toBe(true);
    }
  });

  it("false para subtotales, pagos y vacío", () => {
    // "Subtotal" NO es gran total; "Total Efectivo"/"Venta Total" son columnas
    // de venta/efectivo, no filas de cierre:
    for (const label of ["Subtotal", "Total Efectivo", "Venta Total", ""]) {
      expect(isTotalLabel(label), label).toBe(false);
    }
  });
});

describe("parseMoneyToCents", () => {
  it("formato MX estándar: $, comas de miles, punto decimal, espacios", () => {
    expect(parseMoneyToCents(" $1,234.50 ")).toBe(123450);
    expect(parseMoneyToCents("$10,000.00")).toBe(1000000);
    expect(parseMoneyToCents("10000.00")).toBe(1000000);
    expect(parseMoneyToCents("10000")).toBe(1000000);
    expect(parseMoneyToCents("1,234,567.89")).toBe(123456789);
  });

  it("paréntesis contables = negativo", () => {
    expect(parseMoneyToCents("(150.00)")).toBe(-15000);
    expect(parseMoneyToCents("(1,234.56)")).toBe(-123456);
    expect(parseMoneyToCents("-50.25")).toBe(-5025);
  });

  it("decimal coma y sufijos MXN / espacios finos", () => {
    expect(parseMoneyToCents("1234,56")).toBe(123456); // coma decimal pura
    expect(parseMoneyToCents("1 234,50 MXN")).toBe(123450); // miles-espacio + coma + sufijo
    expect(parseMoneyToCents("mxn 50")).toBe(5000);
  });

  it("punto de miles (exportaciones con locale eu): '1.234' → 123400", () => {
    expect(parseMoneyToCents("1.234")).toBe(123400);
    expect(parseMoneyToCents("1.234.567")).toBe(123456700);
    expect(parseMoneyToCents("10.5")).toBe(1050); // punto decimal normal
    expect(parseMoneyToCents("12.55")).toBe(1255);
  });

  it("⚠️ CONGELADO: '1.234,50' devuelve 123 — formato europeo ambiguo mal interpretado", () => {
    // El branch "coma+punto" elimina las comas asumiendo formato MX
    // (coma=miles), así que la parte europea ',50' queda pegada al decimal:
    // "1.234,50" → "1.23450" → 123¢ ($1.23) cuando lo esperable sería 123450¢
    // ($1,234.50). Es DINERO: corrección requiere decisión humana (ver reporte).
    expect(parseMoneyToCents("1.234,50")).toBe(123);
  });

  it("⚠️ CONGELADO: notación científica se acepta (el plan pedía null)", () => {
    // parseFloat('1e3') = 1000 → 100000¢. Correcto si el origen era numérico
    // (Excel exporta grandes como '1.23E+05'); congelado como documentación.
    expect(parseMoneyToCents("1e3")).toBe(100000);
    expect(parseMoneyToCents("1.23E+05")).toBe(12300000);
  });

  it("vacío, no-numérico y tipos no soportados → null (nunca NaN)", () => {
    for (const v of [
      "",
      "   ",
      "N/A",
      "$",
      "MXN",
      "-",
      "USD 100",
      null,
      undefined,
      new Date(),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(parseMoneyToCents(v), String(v)).toBeNull();
    }
  });

  it("números: redondea a centavos; NaN/Infinity → null", () => {
    expect(parseMoneyToCents(10)).toBe(1000);
    expect(parseMoneyToCents(10.5)).toBe(1050);
    expect(parseMoneyToCents(-3.99)).toBe(-399);
    expect(parseMoneyToCents(0.1)).toBe(10);
    expect(parseMoneyToCents(1234.567)).toBe(123457);
    expect(parseMoneyToCents(1e9)).toBe(100_000_000_000);
  });

  it("PROPIEDAD: round-trip de centavos enteros vía toFixed(2)", () => {
    const cents = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });
    fc.assert(
      fc.property(cents, (c) => {
        expect(parseMoneyToCents((c / 100).toFixed(2))).toBe(c);
      }),
    );
  });

  it("PROPIEDAD: cualquier entrada produce null o entero distinto de NaN", () => {
    const arb = fc.oneof(
      fc.string({ minLength: 0, maxLength: 24 }),
      fc.double({ min: -1e9, max: 1e9, noNaN: false }),
      fc.constantFrom(null, undefined),
    );
    fc.assert(
      fc.property(arb, (v) => {
        const out = parseMoneyToCents(v);
        if (out === null) return;
        expect(Number.isNaN(out)).toBe(false);
        expect(Number.isInteger(out)).toBe(true);
      }),
    );
  });
});

describe("parseCount (bonus del mismo módulo)", () => {
  it("enteros con/sin comas; null para lo demás", () => {
    expect(parseCount("80")).toBe(80);
    expect(parseCount("1,234")).toBe(1234);
    expect(parseCount(42)).toBe(42);
    expect(parseCount(80.7)).toBe(81);
    expect(parseCount(-5)).toBe(-5);
    expect(parseCount("12 tickets")).toBeNull();
    expect(parseCount("")).toBeNull();
    expect(parseCount(null)).toBeNull();
  });
});
