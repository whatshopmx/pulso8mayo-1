import { ApiError } from "@/lib/api/error";

/**
 * Contrato de los tres límites de caja chica (C23):
 * 1. Límite de Fondo (`pettyCashLimitCents`): Regla corporativa en `tenant_operating_config`.
 *    Tope máximo al fondo fijo por sucursal en apertura/reapertura (`openFund`).
 *    En 0, la caja chica está deshabilitada en el grupo.
 *    En null, el grupo opera sin tope corporativo de fondo.
 * 2. Límite por Gasto / Retiro (`fund.currentBalance`): Físico en caja.
 *    Ningún retiro (`registerOutflow`) puede exceder el saldo disponible. Exige comprobante.
 * 3. Límite de Aprobación (`managerAuthLimitCents`, `doubleApprovalThresholdCents`, `managerAutonomy`):
 *    Escalera de cuentas por pagar y gastos corporativos (`expense-service.ts`).
 *    Ortogonal a la caja chica física: un retiro en efectivo no se tramita por cuentas por pagar.
 */

export interface ValidarAperturaFondoInput {
  fundAmountCents: number;
  pettyCashLimitCents: number | null;
  lowThresholdCents?: number | null;
}

export interface ValidarReposicionFondoInput {
  amountCents: number;
  currentBalanceCents: number;
  fundAmountCents: number;
  pettyCashLimitCents: number | null;
}

export interface ValidarRetiroFondoInput {
  amountCents: number;
  currentBalanceCents: number;
  concept: string;
  evidenceUrl?: string | null;
}

function formatoPesos(cents: number): string {
  return (cents / 100).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Valida la apertura o reapertura de un fondo fijo contra la política corporativa.
 * Aplica en `openFund` (`petty-cash-service.ts`).
 */
export function validarAperturaFondo(input: ValidarAperturaFondoInput): void {
  if (input.fundAmountCents <= 0) {
    throw ApiError.badRequest("Indica el efectivo que se entregó a la sucursal (debe ser mayor a $0).");
  }

  // Cero declarado: la caja chica está deshabilitada para la empresa
  if (input.pettyCashLimitCents === 0) {
    throw ApiError.badRequest(
      "La caja chica está deshabilitada en la configuración operativa de la empresa. No se pueden abrir fondos."
    );
  }

  // Tope positivo: no puede exceder el límite corporativo
  if (input.pettyCashLimitCents !== null && input.pettyCashLimitCents > 0) {
    if (input.fundAmountCents > input.pettyCashLimitCents) {
      throw ApiError.badRequest(
        `El fondo solicitado ($${formatoPesos(input.fundAmountCents)} MXN) excede el límite máximo de caja chica autorizado para la empresa ($${formatoPesos(input.pettyCashLimitCents)} MXN).`
      );
    }
  }

  // Umbral de reposición / alerta
  if (input.lowThresholdCents != null) {
    if (input.lowThresholdCents < 0) {
      throw ApiError.badRequest("El umbral de alerta no puede ser negativo.");
    }
    if (input.lowThresholdCents > input.fundAmountCents) {
      throw ApiError.badRequest("El umbral de alerta no puede ser mayor al fondo entregado.");
    }
  }
}

/**
 * Valida la reposición de un fondo fijo.
 * Aplica en `replenishFund` (`petty-cash-service.ts`).
 *
 * En un fondo fijo:
 * 1. La caja chica no puede estar deshabilitada a nivel empresa (`pettyCashLimitCents === 0`).
 * 2. El saldo resultante no puede superar el fondo fijo autorizado para la sucursal (`fundAmount`).
 */
export function validarReposicionFondo(input: ValidarReposicionFondoInput): void {
  if (input.amountCents <= 0) {
    throw ApiError.badRequest("El monto de reposición debe ser mayor a cero.");
  }

  if (input.pettyCashLimitCents === 0) {
    throw ApiError.badRequest(
      "La caja chica está deshabilitada en la configuración operativa de la empresa. No se pueden realizar reposiciones."
    );
  }

  const saldoResultante = input.currentBalanceCents + input.amountCents;
  if (saldoResultante > input.fundAmountCents) {
    throw ApiError.badRequest(
      `La reposición ($${formatoPesos(input.amountCents)} MXN) excede el fondo fijo autorizado para la sucursal ($${formatoPesos(input.fundAmountCents)} MXN). Saldo resultante sería $${formatoPesos(saldoResultante)} MXN.`
    );
  }
}

/**
 * Valida un retiro / salida de efectivo de caja chica.
 * Aplica en `registerOutflow` (`petty-cash-service.ts`).
 */
export function validarRetiroFondo(input: ValidarRetiroFondoInput): void {
  if (input.amountCents <= 0) {
    throw ApiError.badRequest("El monto del retiro debe ser mayor a cero.");
  }

  if (input.currentBalanceCents < input.amountCents) {
    throw ApiError.badRequest(
      `Saldo insuficiente en caja chica. Saldo actual: $${formatoPesos(input.currentBalanceCents)} MXN.`
    );
  }

  if (!input.concept || input.concept.trim() === "") {
    throw ApiError.badRequest("Describe el concepto del retiro de caja chica.");
  }
}

/**
 * Resumen estructurado de la distinción de los tres límites de caja chica.
 */
export function distinguirLimitesDeCajaChica() {
  return {
    limiteFondo: {
      campo: "pettyCashLimitCents",
      fuente: "tenant_operating_config",
      proposito: "Tope corporativo máximo por sucursal en apertura y reapertura de fondo fijo.",
      comportamientoNull: "Sin tope corporativo: cada sucursal abre por el monto autorizado.",
      comportamientoCero: "Caja chica deshabilitada en el grupo.",
      fondosExistentes: "Conservan su fondo asignado y saldo; no se invalidan.",
    },
    limiteGasto: {
      campo: "currentBalance",
      fuente: "petty_cash_funds",
      proposito: "Saldo disponible en caja física; ningún retiro puede rebasarlo.",
      auditoria: "Exige comprobante fotográfico y concepto.",
    },
    limiteAprobacion: {
      campos: ["managerAuthLimitCents", "doubleApprovalThresholdCents", "managerAutonomy"],
      fuente: "tenant_operating_config",
      proposito: "Escalera de autorización para compras y cuentas por pagar corporativas.",
      relacionCajaChica: "Ortogonal: los desembolsos de caja chica física no pasan por cuentas por pagar.",
    },
  };
}
