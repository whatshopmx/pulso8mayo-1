// lib/inventory/waste-approval.ts
//
// Task 3 (plan-loteprod-gaps §8.1): reglas de aprobación de mermas
// STAFF/COURTESY. Lógica pura — sin DB — para que la ruta POST, el endpoint de
// aprobación y los tests compartan EXACTAMENTE la misma decisión.
//
// Reglas del manual (loteprod.md §8.1/§8.3): la cortesía/empleado "tiene tope y
// se aprueba". Aquí: nace PENDING_APPROVAL, un GERENTE+ aprueba mientras el
// acumulado aprobado del mes no exceda el tope de la empresa; excederlo exige
// ADMIN+ ("aprobación de rol superior").

import { roleIsAtLeast } from "@/lib/permissions";

export type WasteApprovalStatus = "AUTO" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

/** Motivos que exigen aprobación antes de descontar inventario (§8.1). */
const APPROVAL_REQUIRED_REASONS: readonly string[] = ["STAFF", "COURTESY"];

/** Rol mínimo para aprobar una merma pendiente. */
export const WASTE_APPROVER_MIN_ROLE = "GERENTE";

/**
 * Rol mínimo cuando el tope mensual quedó excedido. ADMIN está un nivel arriba
 * de GERENTE en `ROLES_HIERARCHY`; OWNER/SUPER_ADMIN lo satisfacen por jerarquía.
 */
export const WASTE_ELEVATED_APPROVER_MIN_ROLE = "ADMIN";

/** ¿Este motivo requiere flujo de aprobación? */
export function requiresApproval(reason: string): boolean {
  return APPROVAL_REQUIRED_REASONS.includes(reason);
}

/** Estatus con el que NACE una merma según su motivo. */
export function initialApprovalStatus(
  reason: string
): Extract<WasteApprovalStatus, "AUTO" | "PENDING_APPROVAL"> {
  return requiresApproval(reason) ? "PENDING_APPROVAL" : "AUTO";
}

export type ApprovalErrorCode =
  /** Quien intenta aprobar no alcanza a GERENTE. */
  | "FORBIDDEN_ROLE"
  /** Tope excedido y quien aprueba no es ADMIN+. */
  | "CAP_EXCEEDED_ELEVATED_REQUIRED"
  /** La merma ya fue resuelta (aprobada/rechazada) o nació AUTO. */
  | "NOT_PENDING"
  /** No hay stock suficiente al momento de aprobar. */
  | "OVER_QUANTITY";

export interface ApprovalEvaluation {
  role: string;
  /** Tope mensual configurado en `companies` (centavos). Null = sin tope. */
  capCents: number | null;
  /** Acumulado APROBADO de STAFF/COURTESY en el mes (centavos), empresa completa. */
  monthApprovedCents: number;
  /** Pérdida de LA merma que se quiere aprobar (centavos; null si sin costo). */
  thisLossCents: number | null;
}

export interface ApprovalDecision {
  allowed: boolean;
  errorCode?: ApprovalErrorCode;
}

/**
 * Decisión pura de una acción de aprobación. Falla cerrado: rol desconocido o
 * insuficiente deniega; solo GERENTE+ pasa, y sobre tope exige ADMIN+.
 * Merma sin costo conocido (totalLoss null) no cuenta contra el tope — no hay
 * cifra que topar.
 */
export function evaluateApproval(p: ApprovalEvaluation): ApprovalDecision {
  if (!roleIsAtLeast(p.role, WASTE_APPROVER_MIN_ROLE)) {
    return { allowed: false, errorCode: "FORBIDDEN_ROLE" };
  }

  if (
    p.capCents !== null &&
    p.thisLossCents !== null &&
    p.monthApprovedCents + p.thisLossCents > p.capCents &&
    !roleIsAtLeast(p.role, WASTE_ELEVATED_APPROVER_MIN_ROLE)
  ) {
    return { allowed: false, errorCode: "CAP_EXCEEDED_ELEVATED_REQUIRED" };
  }

  return { allowed: true };
}
