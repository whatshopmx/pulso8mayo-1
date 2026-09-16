// lib/services/__tests__/payment-run-settlement.test.ts
//
// Estos tests importan las reglas **reales** que usa `TreasuryService`
// (`lib/services/payment-run-settlement.ts`), no una copia escrita aquí dentro:
// el punto de la liquidación por partida es que el rechazo bancario conserve la
// deuda, y una copia local del criterio pasaría aunque el servicio hiciera otra
// cosa.
import { describe, it, expect } from "vitest";
import {
  ESTADOS_LIQUIDABLES,
  aplicaEspejoDocumento,
  decidirLiquidacion,
  motivoExclusionPorLiquidacion,
  motivoNoLiquidable,
  puedeLiquidarCorrida,
  resumenLiquidacion,
  revisarCierreCorrida,
  validarEvidenciaLiquidacion,
  type SettlementItemLike,
} from "../payment-run-settlement";

const partida = (
  itemType: string,
  amountCents: number,
  settlementStatus: SettlementItemLike["settlementStatus"] = "PENDING"
): SettlementItemLike => ({ itemType, amountCents, settlementStatus });

describe("Liquidación por partida de una corrida de pago", () => {
  describe("¿en qué estado de la corrida se puede liquidar?", () => {
    it("sólo después de la firma: autorizada o en dispersión", () => {
      expect(ESTADOS_LIQUIDABLES).toEqual(["APPROVED", "PROCESSING"]);
      expect(puedeLiquidarCorrida("APPROVED")).toBe(true);
      expect(puedeLiquidarCorrida("PROCESSING")).toBe(true);
    });

    it("ni antes de la autorización ni en estados terminales", () => {
      expect(puedeLiquidarCorrida("DRAFT")).toBe(false);
      expect(puedeLiquidarCorrida("PENDING_APPROVAL")).toBe(false);
      expect(puedeLiquidarCorrida("COMPLETED")).toBe(false);
      expect(puedeLiquidarCorrida("CANCELLED")).toBe(false);
    });

    it("el mensaje dice qué hacer, no sólo que no se puede", () => {
      expect(motivoNoLiquidable("DRAFT")).toContain("no está autorizada");
      expect(motivoNoLiquidable("PENDING_APPROVAL")).toContain("no está autorizada");
      expect(motivoNoLiquidable("COMPLETED")).toContain("cerrada");
      expect(motivoNoLiquidable("CANCELLED")).toContain("cancelada");
    });
  });

  describe("decisión de liquidar una partida que ya tiene estado", () => {
    it("una confirmación repetida no se vuelve a aplicar", () => {
      const decision = decidirLiquidacion("CONFIRMED", "CONFIRMED");
      expect(decision.ok).toBe(true);
      if (!decision.ok) return;
      expect(decision.accion).toBe("SIN_CAMBIO");
    });

    it("un rechazo repetido tampoco", () => {
      const decision = decidirLiquidacion("FAILED", "FAILED");
      expect(decision.ok).toBe(true);
      if (!decision.ok) return;
      expect(decision.accion).toBe("SIN_CAMBIO");
    });

    it("una partida confirmada no se puede marcar como rechazada", () => {
      const decision = decidirLiquidacion("CONFIRMED", "FAILED");
      expect(decision.ok).toBe(false);
      if (decision.ok) return;
      expect(decision.motivo).toContain("dos veces");
    });

    it("un rechazo sí se puede corregir a pago confirmado", () => {
      const decision = decidirLiquidacion("FAILED", "CONFIRMED");
      expect(decision.ok).toBe(true);
      if (!decision.ok) return;
      expect(decision.accion).toBe("CONFIRMAR");
    });

    it("una partida pendiente se confirma o se rechaza", () => {
      const confirmar = decidirLiquidacion("PENDING", "CONFIRMED");
      const rechazar = decidirLiquidacion("PENDING", "FAILED");
      expect(confirmar.ok && confirmar.accion).toBe("CONFIRMAR");
      expect(rechazar.ok && rechazar.accion).toBe("RECHAZAR");
    });

    it("sin estado (corridas anteriores a la columna) cuenta como pendiente", () => {
      const decision = decidirLiquidacion(null, "CONFIRMED");
      expect(decision.ok).toBe(true);
      if (!decision.ok) return;
      expect(decision.accion).toBe("CONFIRMAR");
    });
  });

  describe("espejo al documento de origen", () => {
    it("sólo facturas y gastos operativos se marcan pagados", () => {
      expect(aplicaEspejoDocumento("INVOICE")).toBe(true);
      expect(aplicaEspejoDocumento("OPERATING_EXPENSE")).toBe(true);
      expect(aplicaEspejoDocumento("PAYROLL")).toBe(false);
      expect(aplicaEspejoDocumento("TAXES")).toBe(false);
      expect(aplicaEspejoDocumento("PETTY_CASH_REIMBURSEMENT")).toBe(false);
      expect(aplicaEspejoDocumento("OTHER")).toBe(false);
    });
  });
describe("totales del lote", () => {
    const items = [
      partida("INVOICE", 100000, "CONFIRMED"),
      partida("INVOICE", 250000, "PENDING"),
      partida("OPERATING_EXPENSE", 50000, "FAILED"),
      partida("PAYROLL", 400000, "CONFIRMED"),
    ];

    it("separa confirmado, rechazado y pendiente en partidas e importe", () => {
      const r = resumenLiquidacion(items);
      expect(r.totalPartidas).toBe(4);
      expect(r.totalCents).toBe(800000);
      expect(r.confirmadas).toBe(2);
      expect(r.confirmadasCents).toBe(500000);
      expect(r.rechazadas).toBe(1);
      expect(r.rechazadasCents).toBe(50000);
      expect(r.pendientes).toBe(1);
      expect(r.pendientesCents).toBe(250000);
      expect(r.liquidada).toBe(false);
    });

    it("un lote con todo resuelto queda liquidado aunque haya rechazos", () => {
      const r = resumenLiquidacion([
        partida("INVOICE", 1000, "CONFIRMED"),
        partida("INVOICE", 2000, "FAILED"),
      ]);
      expect(r.liquidada).toBe(true);
      expect(r.pendientes).toBe(0);
    });

    it("un lote sin partidas suma cero y no tiene pendientes", () => {
      const r = resumenLiquidacion([]);
      expect(r.totalPartidas).toBe(0);
      expect(r.totalCents).toBe(0);
      expect(r.pendientes).toBe(0);
    });
  });

  describe("¿se puede cerrar la corrida?", () => {
    it("no con partidas sin liquidar, y dice cuántas y por cuánto", () => {
      const revision = revisarCierreCorrida([
        partida("INVOICE", 100000, "CONFIRMED"),
        partida("INVOICE", 250000, "PENDING"),
        partida("INVOICE", 150000, "PENDING"),
      ]);

      expect(revision.ok).toBe(false);
      if (revision.ok) return;
      expect(revision.pendientes).toBe(2);
      expect(revision.pendientesCents).toBe(400000);
      expect(revision.mensaje).toContain("2 partidas");
    });

    it("sí cuando cada partida tiene desenlace, aunque alguna haya sido rechazada", () => {
      expect(
        revisarCierreCorrida([
          partida("INVOICE", 100000, "CONFIRMED"),
          partida("INVOICE", 250000, "FAILED"),
        ]).ok
      ).toBe(true);
    });

    it("el mensaje singulariza una sola partida pendiente", () => {
      const revision = revisarCierreCorrida([partida("INVOICE", 100, "PENDING")]);
      expect(revision.ok).toBe(false);
      if (revision.ok) return;
      expect(revision.mensaje).toContain("1 partida por");
    });
  });

  describe("exclusión del archivo de dispersión", () => {
    it("una partida pendiente sí viaja", () => {
      expect(motivoExclusionPorLiquidacion(partida("INVOICE", 1, "PENDING"))).toBeNull();
      expect(motivoExclusionPorLiquidacion(partida("INVOICE", 1, null))).toBeNull();
    });

    it("una confirmada no vuelve a viajar: sería pagar dos veces", () => {
      const motivo = motivoExclusionPorLiquidacion(partida("INVOICE", 1, "CONFIRMED"));
      expect(motivo).toContain("dos veces");
    });

    it("una rechazada no vuelve a viajar y la deuda sigue registrada", () => {
      const motivo = motivoExclusionPorLiquidacion(partida("INVOICE", 1, "FAILED"));
      expect(motivo).toContain("rechazó");
      expect(motivo).toContain("sigue registrada");
    });
  });

  describe("evidencia mínima de la liquidación", () => {
    it("confirmar exige referencia del comprobante", () => {
      expect(validarEvidenciaLiquidacion({ settlement: "CONFIRMED", reference: "" }).ok).toBe(false);
      expect(validarEvidenciaLiquidacion({ settlement: "CONFIRMED", reference: "   " }).ok).toBe(false);
      expect(validarEvidenciaLiquidacion({ settlement: "CONFIRMED" }).ok).toBe(false);
      expect(
        validarEvidenciaLiquidacion({
          settlement: "CONFIRMED",
          reference: "SPEI 20260915-8392019",
        }).ok
      ).toBe(true);
    });

    it("rechazar exige motivo del banco", () => {
      expect(validarEvidenciaLiquidacion({ settlement: "FAILED", failureReason: "" }).ok).toBe(
        false
      );
      expect(
        validarEvidenciaLiquidacion({
          settlement: "FAILED",
          failureReason: "CLABE bloqueada por el banco destino",
        }).ok
      ).toBe(true);
    });
  });
});
