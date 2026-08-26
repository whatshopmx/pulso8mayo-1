// Task 3 (plan-loteprod-gaps §8.1): reglas puras de aprobación STAFF/COURTESY.
import { describe, expect, it } from "vitest";
import {
  evaluateApproval,
  initialApprovalStatus,
  requiresApproval,
} from "../waste-approval";

describe("initialApprovalStatus", () => {
  it("STAFF y COURTESY nacen PENDING_APPROVAL", () => {
    expect(initialApprovalStatus("STAFF")).toBe("PENDING_APPROVAL");
    expect(initialApprovalStatus("COURTESY")).toBe("PENDING_APPROVAL");
  });

  it("los motivos operativos nacen AUTO", () => {
    for (const reason of ["EXPIRED", "DAMAGED", "QUALITY", "SPILLAGE", "OTHER"]) {
      expect(initialApprovalStatus(reason)).toBe("AUTO");
    }
  });

  it("requiresApproval coincide con el estatus inicial", () => {
    expect(requiresApproval("COURTESY")).toBe(true);
    expect(requiresApproval("DAMAGED")).toBe(false);
  });
});

describe("evaluateApproval", () => {
  const base = { capCents: null, monthApprovedCents: 0, thisLossCents: 1000 };

  it("falla cerrado: SUPERVISOR y abajo nunca aprueban", () => {
    for (const role of ["EMPLEADO", "SUPERVISOR", "READONLY"]) {
      const d = evaluateApproval({ ...base, role });
      expect(d.allowed).toBe(false);
      expect(d.errorCode).toBe("FORBIDDEN_ROLE");
    }
  });

  it("GERENTE aprueba sin tope configurado", () => {
    expect(evaluateApproval({ ...base, role: "GERENTE" }).allowed).toBe(true);
  });

  it("GERENTE aprueba dentro del tope (acumulado + esta <= cap)", () => {
    expect(
      evaluateApproval({ role: "GERENTE", capCents: 1500, monthApprovedCents: 500, thisLossCents: 1000 }).allowed
    ).toBe(true);
  });

  it("el límite es inclusivo: llegar exacto al tope lo permite GERENTE", () => {
    expect(
      evaluateApproval({ role: "GERENTE", capCents: 1500, monthApprovedCents: 500, thisLossCents: 1000 }).allowed
    ).toBe(true);
  });

  it("GERENTE exceder el tope exige rol superior", () => {
    const d = evaluateApproval({ role: "GERENTE", capCents: 1400, monthApprovedCents: 500, thisLossCents: 1000 });
    expect(d.allowed).toBe(false);
    expect(d.errorCode).toBe("CAP_EXCEEDED_ELEVATED_REQUIRED");
  });

  it("ADMIN/OWNER/SUPER_ADMIN aprueban aun sobre tope", () => {
    for (const role of ["ADMIN", "OWNER", "SUPER_ADMIN"]) {
      expect(
        evaluateApproval({ role, capCents: 100, monthApprovedCents: 9999, thisLossCents: 9999 }).allowed
      ).toBe(true);
    }
  });

  it("merma sin costo conocido no cuenta contra el tope", () => {
    expect(
      evaluateApproval({ role: "GERENTE", capCents: 500, monthApprovedCents: 900, thisLossCents: null }).allowed
    ).toBe(true);
  });

  it("rol desconocido deniega (fail-closed)", () => {
    const d = evaluateApproval({ ...base, role: "JEFE_DE_PISO" });
    expect(d.allowed).toBe(false);
    expect(d.errorCode).toBe("FORBIDDEN_ROLE");
  });

  it("DIRECTOR_OPS (85) aprueba bajo tope pero sobre tope exige ADMIN+ (90)", () => {
    expect(
      evaluateApproval({ role: "DIRECTOR_OPS", capCents: null, monthApprovedCents: 0, thisLossCents: 1000 }).allowed
    ).toBe(true);
    const d = evaluateApproval({ role: "DIRECTOR_OPS", capCents: 100, monthApprovedCents: 9999, thisLossCents: 9999 });
    expect(d.allowed).toBe(false);
    expect(d.errorCode).toBe("CAP_EXCEEDED_ELEVATED_REQUIRED");
  });
});
