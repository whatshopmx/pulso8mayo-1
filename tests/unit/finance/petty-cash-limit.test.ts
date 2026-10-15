import { describe, it, expect } from "vitest";
import {
  validarAperturaFondo,
  validarReposicionFondo,
  validarRetiroFondo,
  distinguirLimitesDeCajaChica,
} from "@/lib/finance/petty-cash-policy";
import { ApiError } from "@/lib/api/error";
import { rolExigidoPorMonto } from "@/lib/expenses/approval-policy";

describe("C23 · Política de límite de caja chica (pettyCashLimitCents)", () => {
  describe("Distinción tripartita de límites", () => {
    it("distingue formalmente límite de fondo, límite por gasto y límite de aprobación", () => {
      const limites = distinguirLimitesDeCajaChica();

      // 1. Límite de Fondo (Corporativo)
      expect(limites.limiteFondo.campo).toBe("pettyCashLimitCents");
      expect(limites.limiteFondo.fuente).toBe("tenant_operating_config");
      expect(limites.limiteFondo.comportamientoNull).toContain("Sin tope corporativo");
      expect(limites.limiteFondo.comportamientoCero).toContain("deshabilitada");
      expect(limites.limiteFondo.fondosExistentes).toContain("no se invalidan");

      // 2. Límite de Retiro (Físico en caja)
      expect(limites.limiteGasto.campo).toBe("currentBalance");
      expect(limites.limiteGasto.fuente).toBe("petty_cash_funds");
      expect(limites.limiteGasto.auditoria).toContain("comprobante fotográfico");

      // 3. Límite de Aprobación (Cuentas por pagar corporativas)
      expect(limites.limiteAprobacion.campos).toContain("managerAuthLimitCents");
      expect(limites.limiteAprobacion.campos).toContain("doubleApprovalThresholdCents");
      expect(limites.limiteAprobacion.campos).toContain("managerAutonomy");
      expect(limites.limiteAprobacion.relacionCajaChica).toContain("Ortogonal");
    });

    it("la escalera de aprobación corporativa es ortogonal al retiro de caja chica", () => {
      // Un gasto de $6,000 MXN en cuentas por pagar exige ADMIN con umbral de $1,000
      const rolGasto = rolExigidoPorMonto(600_000, {
        managerAuthLimitCents: 100_000,
        doubleApprovalThresholdCents: 1_000_000,
        managerAutonomy: "MEDIA",
      });
      expect(rolGasto).toBe("ADMIN");

      // En cambio, un retiro de caja chica por $6,000 MXN solo valida que la caja física tenga saldo suficiente
      expect(() =>
        validarRetiroFondo({
          amountCents: 600_000,
          currentBalanceCents: 700_000,
          concept: "Compra urgente de insumos en efectivo",
          evidenceUrl: "https://storage.pulso.mx/ticket-123.jpg",
        })
      ).not.toThrow();
    });
  });

  describe("Apertura de fondo (validarAperturaFondo)", () => {
    it("rechaza si el monto entregado es menor o igual a cero", () => {
      expect(() =>
        validarAperturaFondo({
          fundAmountCents: 0,
          pettyCashLimitCents: 500_000,
        })
      ).toThrowError(/mayor a \$0/i);

      expect(() =>
        validarAperturaFondo({
          fundAmountCents: -50_000,
          pettyCashLimitCents: 500_000,
        })
      ).toThrowError(/mayor a \$0/i);
    });

    it("rechaza apertura si la caja chica está deshabilitada (pettyCashLimitCents = 0)", () => {
      expect(() =>
        validarAperturaFondo({
          fundAmountCents: 300_000,
          pettyCashLimitCents: 0,
        })
      ).toThrowError(/deshabilitada en la configuración operativa/i);
    });

    it("rechaza apertura si el monto supera el límite corporativo positivo", () => {
      let error: unknown;
      try {
        validarAperturaFondo({
          fundAmountCents: 600_000, // $6,000 MXN
          pettyCashLimitCents: 500_000, // $5,000 MXN
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).toContain("excede el límite máximo de caja chica autorizado");
      expect((error as ApiError).message).toContain("6,000.00");
      expect((error as ApiError).message).toContain("5,000.00");
    });

    it("permite apertura si el monto es menor o igual al límite corporativo", () => {
      // Exactamente el límite
      expect(() =>
        validarAperturaFondo({
          fundAmountCents: 500_000,
          pettyCashLimitCents: 500_000,
        })
      ).not.toThrow();

      // Por debajo del límite
      expect(() =>
        validarAperturaFondo({
          fundAmountCents: 250_000,
          pettyCashLimitCents: 500_000,
        })
      ).not.toThrow();
    });

    it("permite apertura de cualquier monto válido cuando pettyCashLimitCents es null (sin tope)", () => {
      expect(() =>
        validarAperturaFondo({
          fundAmountCents: 2_500_000, // $25,000 MXN
          pettyCashLimitCents: null,
        })
      ).not.toThrow();
    });

    it("valida el umbral de alerta (lowThresholdCents)", () => {
      // Negativo
      expect(() =>
        validarAperturaFondo({
          fundAmountCents: 500_000,
          pettyCashLimitCents: 500_000,
          lowThresholdCents: -1,
        })
      ).toThrowError(/no puede ser negativo/i);

      // Mayor al fondo entregado
      expect(() =>
        validarAperturaFondo({
          fundAmountCents: 500_000,
          pettyCashLimitCents: 500_000,
          lowThresholdCents: 500_001,
        })
      ).toThrowError(/no puede ser mayor al fondo entregado/i);

      // Válido
      expect(() =>
        validarAperturaFondo({
          fundAmountCents: 500_000,
          pettyCashLimitCents: 500_000,
          lowThresholdCents: 100_000,
        })
      ).not.toThrow();
    });
  });

  describe("Reposición de fondo (validarReposicionFondo)", () => {
    it("rechaza si el monto de reposición es menor o igual a cero", () => {
      expect(() =>
        validarReposicionFondo({
          amountCents: 0,
          currentBalanceCents: 100_000,
          fundAmountCents: 500_000,
          pettyCashLimitCents: 500_000,
        })
      ).toThrowError(/mayor a cero/i);
    });

    it("rechaza reposición si la caja chica está deshabilitada en la empresa (0)", () => {
      expect(() =>
        validarReposicionFondo({
          amountCents: 100_000,
          currentBalanceCents: 100_000,
          fundAmountCents: 500_000,
          pettyCashLimitCents: 0,
        })
      ).toThrowError(/deshabilitada en la configuración operativa/i);
    });

    it("rechaza reposición que excede el fondo fijo de la sucursal", () => {
      // Saldo actual 400_000 + reposición 200_000 = 600_000 > fundAmount 500_000
      let error: unknown;
      try {
        validarReposicionFondo({
          amountCents: 200_000,
          currentBalanceCents: 400_000,
          fundAmountCents: 500_000,
          pettyCashLimitCents: 500_000,
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).toContain("excede el fondo fijo autorizado para la sucursal");
      expect((error as ApiError).message).toContain("6,000.00");
      expect((error as ApiError).message).toContain("5,000.00");
    });

    it("permite reposición exacta hasta el 100% del fondo fijo", () => {
      // Saldo actual 100_000 + reposición 400_000 = 500_000 === fundAmount 500_000
      expect(() =>
        validarReposicionFondo({
          amountCents: 400_000,
          currentBalanceCents: 100_000,
          fundAmountCents: 500_000,
          pettyCashLimitCents: 500_000,
        })
      ).not.toThrow();
    });

    it("permite reposición parcial", () => {
      // Saldo actual 100_000 + reposición 200_000 = 300_000 < fundAmount 500_000
      expect(() =>
        validarReposicionFondo({
          amountCents: 200_000,
          currentBalanceCents: 100_000,
          fundAmountCents: 500_000,
          pettyCashLimitCents: 500_000,
        })
      ).not.toThrow();
    });
  });

  describe("Retiro de fondo (validarRetiroFondo)", () => {
    it("rechaza si el monto del retiro es menor o igual a cero", () => {
      expect(() =>
        validarRetiroFondo({
          amountCents: 0,
          currentBalanceCents: 100_000,
          concept: "Hielo",
        })
      ).toThrowError(/mayor a cero/i);
    });

    it("rechaza si el saldo es insuficiente", () => {
      let error: unknown;
      try {
        validarRetiroFondo({
          amountCents: 150_000,
          currentBalanceCents: 100_000,
          concept: "Taxi de emergencia",
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).toContain("Saldo insuficiente en caja chica");
      expect((error as ApiError).message).toContain("1,000.00");
    });

    it("rechaza si el concepto está vacío", () => {
      expect(() =>
        validarRetiroFondo({
          amountCents: 50_000,
          currentBalanceCents: 100_000,
          concept: "   ",
        })
      ).toThrowError(/concepto del retiro/i);
    });

    it("permite retiro válido si hay saldo suficiente y concepto", () => {
      expect(() =>
        validarRetiroFondo({
          amountCents: 50_000,
          currentBalanceCents: 100_000,
          concept: "Compra de hielo de emergencia",
          evidenceUrl: "https://storage.pulso.mx/tickets/hielo.jpg",
        })
      ).not.toThrow();
    });
  });

  describe("Tratamiento de fondos existentes (Grandfathering)", () => {
    it("un fondo preexistente que supera un nuevo límite inferior conserva su saldo y puede operar retiros", () => {
      // Supongamos que una sucursal tiene un fondo asignado de $8,000 MXN (800_000 centavos)
      // y la empresa reduce pettyCashLimitCents a $5,000 MXN (500_000 centavos).
      const fondoPreexistente = {
        fundAmount: 800_000,
        currentBalance: 750_000,
      };
      const nuevoLimiteCorporativo = 500_000;

      // 1. Los retiros ordinarios contra su saldo existente siguen funcionando
      expect(() =>
        validarRetiroFondo({
          amountCents: 100_000,
          currentBalanceCents: fondoPreexistente.currentBalance,
          concept: "Gastos menores sucursal",
        })
      ).not.toThrow();

      // 2. La reposición respeta el fondo fijo autorizado de la sucursal (800_000), no el nuevo límite menor
      expect(() =>
        validarReposicionFondo({
          amountCents: 150_000,
          currentBalanceCents: 650_000,
          fundAmountCents: fondoPreexistente.fundAmount,
          pettyCashLimitCents: nuevoLimiteCorporativo,
        })
      ).not.toThrow();

      // 3. Pero intentar abrir un NUEVO fondo por $8,000 MXN se rechaza bajo el nuevo límite
      expect(() =>
        validarAperturaFondo({
          fundAmountCents: 800_000,
          pettyCashLimitCents: nuevoLimiteCorporativo,
        })
      ).toThrowError(/excede el límite máximo de caja chica autorizado/i);
    });
  });
});
