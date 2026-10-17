import { describe, expect, it } from "vitest";

import {
  requiereDobleFirma,
  evaluarFirmaPago,
} from "../disbursement-policy";

/**
 * S-3 (Phase -1 / security gate) — doble firma de pagos.
 *
 * `payment_approvals` existía desde la migración 0028 y nadie la escribía: una
 * corrida se aprobaba con una sola persona distinta al preparador, sin importar
 * el monto. Estas pruebas congelan la regla pura que ahora aplica
 * `treasury-service.updatePaymentRunStatus`.
 */

describe("requiereDobleFirma — umbral inclusivo", () => {
  it("sin umbral configurado (null/undefined) no exige doble firma", () => {
    expect(requiereDobleFirma(9_999_999, null)).toBe(false);
    expect(requiereDobleFirma(9_999_999, undefined)).toBe(false);
  });

  it("el umbral es inclusivo: igual al umbral la exige", () => {
    expect(requiereDobleFirma(1_000_000, 1_000_000)).toBe(true);
  });

  it("por debajo del umbral no la exige; por encima sí", () => {
    expect(requiereDobleFirma(999_999, 1_000_000)).toBe(false);
    expect(requiereDobleFirma(1_000_001, 1_000_000)).toBe(true);
  });

  it("umbral 0 exige doble firma para cualquier monto (incluido 0)", () => {
    expect(requiereDobleFirma(0, 0)).toBe(true);
    expect(requiereDobleFirma(500, 0)).toBe(true);
  });
});

describe("evaluarFirmaPago — acumulación de firmas", () => {
  const sinFirmas = { approvedBy: null, secondApprovedBy: null };

  it("sin firmas previas → registra la primera", () => {
    const v = evaluarFirmaPago({
      actorId: "u2",
      preparadorId: "u1",
      firmas: sinFirmas,
    });
    expect(v).toEqual({ accion: "REGISTRAR_PRIMERA" });
  });

  it("el preparador nunca firma (ni la primera ni la segunda)", () => {
    expect(
      evaluarFirmaPago({ actorId: "u1", preparadorId: "u1", firmas: sinFirmas })
    ).toMatchObject({ accion: "DENEGAR" });
    expect(
      evaluarFirmaPago({
        actorId: "u1",
        preparadorId: "u1",
        firmas: { approvedBy: "u2", secondApprovedBy: null },
      })
    ).toMatchObject({ accion: "DENEGAR" });
  });

  it("con primera firma de OTRO usuario → registra la segunda", () => {
    const v = evaluarFirmaPago({
      actorId: "u3",
      preparadorId: "u1",
      firmas: { approvedBy: "u2", secondApprovedBy: null },
    });
    expect(v).toEqual({ accion: "REGISTRAR_SEGUNDA" });
  });

  it("el mismo usuario no puede firmar dos veces", () => {
    const v = evaluarFirmaPago({
      actorId: "u2",
      preparadorId: "u1",
      firmas: { approvedBy: "u2", secondApprovedBy: null },
    });
    expect(v).toMatchObject({ accion: "DENEGAR" });
    expect((v as { motivo: string }).motivo).toContain("segunda firma");
  });

  it("con las dos firmas puestas no hay nada más que firmar", () => {
    const v = evaluarFirmaPago({
      actorId: "u4",
      preparadorId: "u1",
      firmas: { approvedBy: "u2", secondApprovedBy: "u3" },
    });
    expect(v).toMatchObject({ accion: "DENEGAR" });
  });

  it("sin preparador registrado, cualquier otro usuario puede firmar", () => {
    const v = evaluarFirmaPago({
      actorId: "u2",
      preparadorId: null,
      firmas: sinFirmas,
    });
    expect(v).toEqual({ accion: "REGISTRAR_PRIMERA" });
  });
});
