import { describe, expect, it } from "vitest";
import {
  denyExpenseResolution,
  canResolveExpense,
  rolExigidoPorMonto,
  type UmbralesAutorizacion,
} from "@/lib/expenses/approval-policy";

describe("C20 — Política de autonomía del gerente (approval-policy.ts)", () => {
  const UMBRALES_BASE: UmbralesAutorizacion = {
    managerAuthLimitCents: 100_000, // $1,000 MXN
    doubleApprovalThresholdCents: 1_000_000, // $10,000 MXN
  };

  describe("Nivel BAJA — Visto bueno corporativo obligatorio", () => {
    const umbralesBaja: UmbralesAutorizacion = {
      ...UMBRALES_BASE,
      managerAutonomy: "BAJA",
    };

    it("un gasto chico ($10 MXN) que en MEDIA autorizaría un gerente, en BAJA exige ADMIN", () => {
      expect(rolExigidoPorMonto(1_000, umbralesBaja)).toBe("ADMIN");
    });

    it("un gasto de $500 MXN exige ADMIN", () => {
      expect(rolExigidoPorMonto(50_000, umbralesBaja)).toBe("ADMIN");
    });

    it("un gasto en el límite del gerente ($1,000 MXN) exige ADMIN", () => {
      expect(rolExigidoPorMonto(100_000, umbralesBaja)).toBe("ADMIN");
    });

    it("un gasto intermedio ($5,000 MXN) exige ADMIN", () => {
      expect(rolExigidoPorMonto(500_000, umbralesBaja)).toBe("ADMIN");
    });

    it("un gasto en el umbral de Dirección General ($10,000 MXN) escala a OWNER", () => {
      expect(rolExigidoPorMonto(1_000_000, umbralesBaja)).toBe("OWNER");
    });

    it("un gasto superior a Dirección General ($50,000 MXN) escala a OWNER", () => {
      expect(rolExigidoPorMonto(5_000_000, umbralesBaja)).toBe("OWNER");
    });

    it("incluso sin tope de gerente (null), BAJA exige al menos ADMIN", () => {
      expect(
        rolExigidoPorMonto(50_000, {
          managerAuthLimitCents: null,
          doubleApprovalThresholdCents: 1_000_000,
          managerAutonomy: "BAJA",
        })
      ).toBe("ADMIN");
    });

    it("sin umbral de dueño (null), BAJA exige ADMIN para cualquier monto", () => {
      expect(
        rolExigidoPorMonto(10_000_000, {
          managerAuthLimitCents: 100_000,
          doubleApprovalThresholdCents: null,
          managerAutonomy: "BAJA",
        })
      ).toBe("ADMIN");
    });
  });

  describe("Nivel MEDIA — Sujeto a catálogo acotado y límite monetario (default)", () => {
    const umbralesMedia: UmbralesAutorizacion = {
      ...UMBRALES_BASE,
      managerAutonomy: "MEDIA",
    };

    it("un gasto por debajo del límite ($500 MXN) exige GERENTE", () => {
      expect(rolExigidoPorMonto(50_000, umbralesMedia)).toBe("GERENTE");
    });

    it("el límite del gerente es exclusivo: justo en el tope ($1,000 MXN) escala a ADMIN", () => {
      expect(rolExigidoPorMonto(100_000, umbralesMedia)).toBe("ADMIN");
    });

    it("un gasto intermedio ($5,000 MXN) exige ADMIN", () => {
      expect(rolExigidoPorMonto(500_000, umbralesMedia)).toBe("ADMIN");
    });

    it("en el umbral de Dirección General ($10,000 MXN) escala a OWNER", () => {
      expect(rolExigidoPorMonto(1_000_000, umbralesMedia)).toBe("OWNER");
    });

    it("sin managerAutonomy especificado (undefined), se comporta exactamente como MEDIA", () => {
      expect(rolExigidoPorMonto(50_000, UMBRALES_BASE)).toBe("GERENTE");
      expect(rolExigidoPorMonto(100_000, UMBRALES_BASE)).toBe("ADMIN");
      expect(rolExigidoPorMonto(1_000_000, UMBRALES_BASE)).toBe("OWNER");
    });

    it("con managerAutonomy null o string desconocido, cae en MEDIA de forma segura", () => {
      expect(rolExigidoPorMonto(50_000, { ...UMBRALES_BASE, managerAutonomy: null })).toBe("GERENTE");
      expect(rolExigidoPorMonto(100_000, { ...UMBRALES_BASE, managerAutonomy: null })).toBe("ADMIN");
      expect(rolExigidoPorMonto(50_000, { ...UMBRALES_BASE, managerAutonomy: "DESCONOCIDO" })).toBe("GERENTE");
      expect(rolExigidoPorMonto(100_000, { ...UMBRALES_BASE, managerAutonomy: "DESCONOCIDO" })).toBe("ADMIN");
    });

    it("sin tope de gerente (null), el gerente alcanza hasta el umbral del dueño", () => {
      expect(
        rolExigidoPorMonto(500_000, {
          managerAuthLimitCents: null,
          doubleApprovalThresholdCents: 1_000_000,
          managerAutonomy: "MEDIA",
        })
      ).toBe("GERENTE");
      expect(
        rolExigidoPorMonto(1_000_000, {
          managerAuthLimitCents: null,
          doubleApprovalThresholdCents: 1_000_000,
          managerAutonomy: "MEDIA",
        })
      ).toBe("OWNER");
    });
  });

  describe("Nivel ALTA — Decide el gerente de sucursal", () => {
    const umbralesAlta: UmbralesAutorizacion = {
      ...UMBRALES_BASE,
      managerAutonomy: "ALTA",
    };

    it("un gasto chico ($500 MXN) exige GERENTE", () => {
      expect(rolExigidoPorMonto(50_000, umbralesAlta)).toBe("GERENTE");
    });

    it("un gasto en el límite estándar ($1,000 MXN) en ALTA lo sigue decidiendo el GERENTE", () => {
      expect(rolExigidoPorMonto(100_000, umbralesAlta)).toBe("GERENTE");
    });

    it("un gasto intermedio ($5,000 MXN) que en MEDIA requería ADMIN, en ALTA lo decide el GERENTE", () => {
      expect(rolExigidoPorMonto(500_000, umbralesAlta)).toBe("GERENTE");
    });

    it("un gasto de $9,999 MXN lo decide el GERENTE", () => {
      expect(rolExigidoPorMonto(999_900, umbralesAlta)).toBe("GERENTE");
    });

    it("en el umbral de Dirección General ($10,000 MXN) escala a OWNER", () => {
      expect(rolExigidoPorMonto(1_000_000, umbralesAlta)).toBe("OWNER");
    });

    it("un gasto mayor al umbral de Dirección General ($50,000 MXN) escala a OWNER", () => {
      expect(rolExigidoPorMonto(5_000_000, umbralesAlta)).toBe("OWNER");
    });

    it("sin umbral de dueño (null), ALTA faculta al gerente para cualquier monto ordinario", () => {
      expect(
        rolExigidoPorMonto(5_000_000, {
          managerAuthLimitCents: 100_000,
          doubleApprovalThresholdCents: null,
          managerAutonomy: "ALTA",
        })
      ).toBe("GERENTE");
    });
  });

  describe("Combinación con resolución y segregación de funciones", () => {
    it("en BAJA, un actor GERENTE es rechazado por ROLE incluso para un gasto de $100 MXN", () => {
      const requiredApproverRole = rolExigidoPorMonto(10_000, {
        managerAuthLimitCents: 100_000,
        doubleApprovalThresholdCents: 1_000_000,
        managerAutonomy: "BAJA",
      });
      expect(requiredApproverRole).toBe("ADMIN");

      const denegado = denyExpenseResolution({
        actorRole: "GERENTE",
        actorId: "gerente-1",
        requiredApproverRole,
        requestedBy: "empleado-1",
      });
      expect(denegado).toBe("ROLE");
      expect(
        canResolveExpense({
          actorRole: "GERENTE",
          actorId: "gerente-1",
          requiredApproverRole,
          requestedBy: "empleado-1",
        })
      ).toBe(false);

      // Un ADMIN sí puede resolverlo
      expect(
        canResolveExpense({
          actorRole: "ADMIN",
          actorId: "admin-1",
          requiredApproverRole,
          requestedBy: "empleado-1",
        })
      ).toBe(true);
    });

    it("en ALTA, un actor GERENTE puede resolver un gasto de $5,000 MXN registrado por otro", () => {
      const requiredApproverRole = rolExigidoPorMonto(500_000, {
        managerAuthLimitCents: 100_000,
        doubleApprovalThresholdCents: 1_000_000,
        managerAutonomy: "ALTA",
      });
      expect(requiredApproverRole).toBe("GERENTE");

      expect(
        canResolveExpense({
          actorRole: "GERENTE",
          actorId: "gerente-1",
          requiredApproverRole,
          requestedBy: "empleado-1",
        })
      ).toBe(true);
    });

    it("en cualquier nivel de autonomía, la auto-resolución está prohibida para GERENTE y ADMIN", () => {
      for (const autonomy of ["ALTA", "MEDIA", "BAJA"] as const) {
        const requiredApproverRole = rolExigidoPorMonto(50_000, {
          managerAuthLimitCents: 100_000,
          doubleApprovalThresholdCents: 1_000_000,
          managerAutonomy: autonomy,
        });

        const denegado = denyExpenseResolution({
          actorRole: autonomy === "BAJA" ? "ADMIN" : "GERENTE",
          actorId: "actor-1",
          requiredApproverRole,
          requestedBy: "actor-1", // Mismo id: auto-aprobación
        });
        expect(denegado, `falló en autonomía ${autonomy}`).toBe("SELF");
      }
    });

    it("en cualquier nivel de autonomía, un gasto que alcanza el umbral de dueño escala a OWNER", () => {
      for (const autonomy of ["ALTA", "MEDIA", "BAJA"] as const) {
        const requiredApproverRole = rolExigidoPorMonto(2_000_000, {
          managerAuthLimitCents: 100_000,
          doubleApprovalThresholdCents: 1_000_000,
          managerAutonomy: autonomy,
        });
        expect(requiredApproverRole).toBe("OWNER");

        // ADMIN no alcanza
        expect(
          denyExpenseResolution({
            actorRole: "ADMIN",
            actorId: "admin-1",
            requiredApproverRole,
            requestedBy: "empleado-1",
          })
        ).toBe("ROLE");

        // OWNER sí alcanza
        expect(
          denyExpenseResolution({
            actorRole: "OWNER",
            actorId: "owner-1",
            requiredApproverRole,
            requestedBy: "empleado-1",
          })
        ).toBeNull();
      }
    });
  });
});
