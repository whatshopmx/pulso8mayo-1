import { describe, expect, it } from "vitest";

import { PII_MASKERS, maskSensitive, maskSensitiveList } from "../masking";
import type { AccessDecision } from "../abac";

/**
 * Suite de Task 7 (plan.md): enmascarado de PII de `lib/rbac/masking.ts`.
 *
 * Contratos:
 * - Sin redactFields (gate roles) → objeto intacto (plaintext).
 * - CON redactFields no vacío → TODA key PII con masker registrado presente
 *   en el objeto se enmascara, aunque NO esté listada en redactFields
 *   (dirección fail-cerrada del diseño: la lista es amplia y data-driven;
 *   la tabla de maskers manda).
 * - Sólo strings se enmascaran; números/null/objetos pasan tal cual.
 * - El lookup normaliza camelCase → snake_case antes de buscar el masker.
 */

const decisionConRedaccion = (campos: string[]): AccessDecision => ({
  allowed: true,
  redactFields: campos,
});

/** Decisión típica de un rol enmascarado leyendo FINANCIAL (lista amplia). */
const decisionFinanciera = () =>
  decisionConRedaccion(["base_salary", "projected_cash_flow_cents"]);

describe("maskSensitive — gate roles (sin redacción)", () => {
  it("decision sin redactFields devuelve el objeto plano", () => {
    const fila = { clabe: "002100012345678901", nombre: "Ana" };
    expect(maskSensitive(fila, { allowed: true })).toEqual({
      clabe: "002100012345678901",
      nombre: "Ana",
    });
  });

  it("redactFields vacío también cuenta como 'sin redacción'", () => {
    const fila = { rfc: "GARC850101ABC" };
    expect(maskSensitive(fila, { allowed: true, redactFields: [] })).toEqual(fila);
  });
});

describe("maskSensitive — dirección fail-cerrada", () => {
  it("con redactFields NO vacío se enmascara TODO PII presente, aunque no esté listado", () => {
    // La decisión lista sólo agregados; el PII bancario se enmascara igual:
    const out = maskSensitive(
      {
        base_salary: 15000,
        projected_cash_flow_cents: 9900,
        clabe: "002100012345678901",
        bank_name: "BBVA",
      },
      decisionFinanciera(),
    );
    expect(out.base_salary).toBe(15000); // agregado legítimo: intacto
    expect(out.projected_cash_flow_cents).toBe(9900);
    expect(out.clabe).toBe("****8901");
    expect(out.bank_name).toBe("****");
  });

  it("keys camelCase se normalizan a snake_case para buscar el masker", () => {
    const out = maskSensitive(
      {
        personalEmail: "juan.perez@empresa.com",
        cardNumber: "4111111111111111",
        emergencyContactPhone: "5512345678",
      },
      decisionConRedaccion(["lo-que-sea"]),
    );
    expect(out.personalEmail).toBe("j***@empresa.com");
    expect(out.cardNumber).toBe("****1111");
    expect(out.emergencyContactPhone).toBe("****5678");
  });

  it("keys que no son PII quedan intactas", () => {
    const out = maskSensitive(
      { id: "e-1", nombre: "Ana López", sucursalId: "b-2" },
      decisionFinanciera(),
    );
    expect(out).toEqual({ id: "e-1", nombre: "Ana López", sucursalId: "b-2" });
  });
});

describe("maskSensitive — formatos por tipo de dato", () => {
  it("maskLast4 (clabe/card/nss/teléfonos): conserva últimos 4", () => {
    const out = maskSensitive(
      {
        clabe: "002180065532150016",
        nss: "12345678901",
        personal_phone: "+52 55 1234 5678",
      },
      decisionConRedaccion(["clabe"]),
    );
    expect(out.clabe).toBe("****0016");
    expect(out.nss).toBe("****8901");
    expect(out.personal_phone).toBe("****5678");
  });

  it("CURP conserva cabeza 4 + cola 2; RFC cabeza 4 + cola 3", () => {
    const out = maskSensitive(
      { curp: "GARM850101HDFRRR09", rfc: "GARC850101ABC" },
      decisionConRedaccion(["curp"]),
    );
    expect(out.curp).toBe("GARM***09");
    expect(out.rfc).toBe("GARC***ABC");
  });

  it("email: primer carácter + ***@dominio", () => {
    const out = maskSensitive(
      { personal_email: "ana.lopez+rrhh@hotelmx.com" },
      decisionConRedaccion(["personal_email"]),
    );
    expect(out.personal_email).toBe("a***@hotelmx.com");
  });
});

describe("maskSensitive — casos borde (congelados)", () => {
  it("strings cortos (≤4) se vuelven '****' sin filtrar nada", () => {
    const out = maskSensitive(
      { clabe: "123", rfc: "XAXA" },
      decisionConRedaccion(["clabe"]),
    );
    expect(out.clabe).toBe("****");
    expect(out.rfc).toBe("****");
  });

  it("email sin @ o empezando en @ cae al masker genérico '****'", () => {
    const out = maskSensitive(
      { personal_email: "correo-sin-arroba" },
      decisionConRedaccion(["x"]),
    );
    expect(out.personal_email).toBe("****");

    const out2 = maskSensitive(
      { personal_email: "@dominio.com" },
      decisionConRedaccion(["x"]),
    );
    expect(out2.personal_email).toBe("****");
  });

  it("string VACÍA en campo PII se deja igual (no hay nada que filtrar)", () => {
    const out = maskSensitive(
      { clabe: "", curp: "" },
      decisionConRedaccion(["clabe"]),
    );
    expect(out.clabe).toBe("");
    expect(out.curp).toBe("");
  });

  it("valores no-string en campos PII pasan tal cual (sólo texto es PII aquí)", () => {
    const out = maskSensitive(
      { clabe: null, nss: 12345678901 },
      decisionConRedaccion(["clabe"]),
    );
    expect(out.clabe).toBeNull();
    expect(out.nss).toBe(12345678901);
  });

  it("⚠️ alcance PLANO: PII anidado dentro de objetos no se recorre (documentado)", () => {
    // Congelado: maskSensitive hace shallow copy y sólo barre keys de primer
    // nivel. Las respuestas migradas son filas planas; si una ruta devolviera
    // PII anidado, escaparía — observación para la capa 03.
    const out = maskSensitive(
      { contacto: { personal_phone: "5512345678" } },
      decisionConRedaccion(["contacto"]),
    );
    expect((out.contacto as { personal_phone: string }).personal_phone).toBe(
      "5512345678",
    );
  });
});

describe("maskSensitiveList", () => {
  it("enmascara cada fila con la misma decisión", () => {
    const rows = [
      { clabe: "002100000000000001" },
      { clabe: "002100000000000002" },
    ];
    const out = maskSensitiveList(rows, decisionConRedaccion(["clabe"]));
    expect(out.map((r) => r.clabe)).toEqual(["****0001", "****0002"]);
  });

  it("decisión de gate → lista intacta", () => {
    const rows = [{ clabe: "002100000000000001" }];
    expect(maskSensitiveList(rows, { allowed: true })).toEqual(rows);
    expect(maskSensitiveList([], decisionFinanciera())).toEqual([]);
  });
});

describe("PII_MASKERS (tabla exportada)", () => {
  it("cubre los campos PII esperados por clasificación FINANCIAL/SENSITIVE", () => {
    for (const campo of [
      "clabe",
      "card_number",
      "bank_name",
      "curp",
      "rfc",
      "nss",
      "personal_email",
      "personal_phone",
      "emergency_contact_phone",
    ]) {
      expect(typeof PII_MASKERS[campo], campo).toBe("function");
    }
  });

  it.todo(
    "PII NUEVO sin masker registrado hoy PASA en claro — gap documentado en " +
      "el header del módulo; decidir si la tabla debe derivarse de " +
      "classification.ts con masker obligatorio (fail-closed total)",
  );
});
