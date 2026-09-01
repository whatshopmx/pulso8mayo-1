// M17: Control Interno Service
// Audit trail, violation detection, and segregation of duties enforcement.

import { db } from "@/lib/db";
import {
  operatingExpenses,
  expenseAuthorizationRules,
  recurringContracts,
  invoices,
  users,
  branches,
} from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { roleIsAtLeast } from "@/lib/permissions";
import {
  getRecurringShortageFindings,
  shiftLabel,
} from "@/lib/services/cash-variance-alert-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  expenseId: string;
  branchName: string;
  category: string;
  amountCents: number;
  action: "CREATED" | "APPROVED" | "REJECTED" | "PAID" | "EDITED";
  actorName: string | null;
  actorRole: string | null;
  notes: string | null;
  timestamp: Date;
}

export interface Violation {
  id: string;
  type:
    | "SELF_APPROVAL"
    | "OVERDUE_APPROVAL"
    | "ROLE_MISMATCH"
    | "CONTRACT_VARIANCE_EXCEEDED"
    /**
     * Recibo muy por DEBAJO del monto base de un contrato recurrente.
     *
     * Tipo aparte y no un `CONTRACT_VARIANCE_EXCEEDED` con signo: se investiga
     * distinto. Un sobrecosto es una negociación o un error de facturación; un
     * recibo anormalmente bajo en luz suele ser lectura estimada de CFE, y lo
     * que importa es que el ajuste llega al doble el período siguiente. Que
     * compartan tipo obligaría a leer el monto para saber cuál de las dos cosas
     * pasó.
     */
    | "CONTRACT_VARIANCE_BELOW"
    /** Faltantes repetidos en el mismo turno de una sucursal (F3.4). */
    | "RECURRING_SHORTAGE";
  severity: "LOW" | "MEDIUM" | "HIGH";
  /** `null` en las excepciones que no nacen de un gasto — el patrón de faltantes. */
  expenseId: string | null;
  branchName: string;
  category: string;
  amountCents: number;
  description: string;
  detail: string;
  createdAt: Date;
}

export interface AuditFilters {
  branchId?: string;
  action?: AuditLogEntry["action"];
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Audit Trail
// ---------------------------------------------------------------------------

/**
 * Builds a unified audit trail from operatingExpenses.
 * Each state transition (CREATED → APPROVED/REJECTED → PAID) is an entry.
 */
export async function getAuditTrail(
  companyId: string,
  filters?: AuditFilters
): Promise<{ entries: AuditLogEntry[]; total: number }> {
  const conditions = [eq(operatingExpenses.companyId, companyId)];

  if (filters?.branchId) {
    conditions.push(eq(operatingExpenses.branchId, filters.branchId));
  }

  const reqUser = db.select({ id: users.id, name: users.name, role: users.role }).from(users).as("reqUser");
  const appUser = db.select({ id: users.id, name: users.name, role: users.role }).from(users).as("appUser");

  // Fetch raw expenses with both user joins
  const expenses = await db
    .select({
      id: operatingExpenses.id,
      branchName: branches.name,
      category: operatingExpenses.category,
      amountCents: operatingExpenses.amount,
      description: operatingExpenses.description,
      status: operatingExpenses.status,
      requestedBy: operatingExpenses.requestedBy,
      requestedByName: reqUser.name,
      requestedByRole: reqUser.role,
      approvedBy: operatingExpenses.approvedBy,
      approvedByName: appUser.name,
      approvedByRole: appUser.role,
      approvalNotes: operatingExpenses.approvalNotes,
      paidAt: operatingExpenses.paidAt,
      createdAt: operatingExpenses.createdAt,
      updatedAt: operatingExpenses.updatedAt,
    })
    .from(operatingExpenses)
    .innerJoin(branches, eq(operatingExpenses.branchId, branches.id))
    .leftJoin(reqUser, eq(operatingExpenses.requestedBy, reqUser.id))
    .leftJoin(appUser, eq(operatingExpenses.approvedBy, appUser.id))
    .where(and(...conditions))
    .orderBy(desc(operatingExpenses.createdAt));

  // Build audit entries from each expense's lifecycle
  const entries: AuditLogEntry[] = [];

  for (const e of expenses) {
    // 1. CREATED event
    entries.push({
      id: `created-${e.id}`,
      expenseId: e.id,
      branchName: e.branchName,
      category: e.category,
      amountCents: e.amountCents,
      action: "CREATED",
      actorName: e.requestedByName,
      actorRole: e.requestedByRole,
      notes: e.description,
      timestamp: e.createdAt,
    });

    // 2. APPROVED event
    if (e.status === "APPROVED" || e.status === "PAID") {
      entries.push({
        id: `approved-${e.id}`,
        expenseId: e.id,
        branchName: e.branchName,
        category: e.category,
        amountCents: e.amountCents,
        action: "APPROVED",
        actorName: e.approvedByName,
        actorRole: e.approvedByRole,
        notes: e.approvalNotes,
        timestamp: e.updatedAt ?? e.createdAt,
      });
    }

    // 3. REJECTED event
    if (e.status === "REJECTED") {
      entries.push({
        id: `rejected-${e.id}`,
        expenseId: e.id,
        branchName: e.branchName,
        category: e.category,
        amountCents: e.amountCents,
        action: "REJECTED",
        actorName: e.approvedByName,
        actorRole: e.approvedByRole,
        notes: e.approvalNotes,
        timestamp: e.updatedAt ?? e.createdAt,
      });
    }

    // 4. PAID event
    if (e.status === "PAID" && e.paidAt) {
      entries.push({
        id: `paid-${e.id}`,
        expenseId: e.id,
        branchName: e.branchName,
        category: e.category,
        amountCents: e.amountCents,
        action: "PAID",
        actorName: null,
        actorRole: null,
        notes: null,
        timestamp: e.paidAt,
      });
    }
  }

  // Sort all entries by timestamp descending
  entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  // Filter by action if requested
  const filtered = filters?.action
    ? entries.filter((e) => e.action === filters.action)
    : entries;

  const total = filtered.length;
  const offset = filters?.offset ?? 0;
  const limit = filters?.limit ?? 50;
  const paged = filtered.slice(offset, offset + limit);

  return { entries: paged, total };
}

// ---------------------------------------------------------------------------
// Violation Detection
// ---------------------------------------------------------------------------

/**
 * Scans the company's expenses for control violations:
 * - SELF_APPROVAL: same person created and approved (segregation of duties)
 * - OVERDUE_APPROVAL: expense pending approval for >48 hours
 * - ROLE_MISMATCH: approver doesn't have the required role per rules
 */
export async function detectViolations(
  companyId: string,
  branchId?: string
): Promise<Violation[]> {
  const violations: Violation[] = [];
  const now = new Date();
  const overdueThreshold = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48h ago

  const reqUser = db.select({ id: users.id, name: users.name, role: users.role }).from(users).as("reqUser");
  const appUser = db.select({ id: users.id, name: users.name, role: users.role }).from(users).as("appUser");

  const expenses = await db
    .select({
      id: operatingExpenses.id,
      branchName: branches.name,
      category: operatingExpenses.category,
      amountCents: operatingExpenses.amount,
      description: operatingExpenses.description,
      status: operatingExpenses.status,
      requestedBy: operatingExpenses.requestedBy,
      requestedByName: reqUser.name,
      requestedByRole: reqUser.role,
      approvedBy: operatingExpenses.approvedBy,
      approvedByName: appUser.name,
      approvedByRole: appUser.role,
      approvalNotes: operatingExpenses.approvalNotes,
      createdAt: operatingExpenses.createdAt,
    })
    .from(operatingExpenses)
    .innerJoin(branches, eq(operatingExpenses.branchId, branches.id))
    .leftJoin(reqUser, eq(operatingExpenses.requestedBy, reqUser.id))
    .leftJoin(appUser, eq(operatingExpenses.approvedBy, appUser.id))
    .where(
      and(
        eq(operatingExpenses.companyId, companyId),
        ...(branchId ? [eq(operatingExpenses.branchId, branchId)] : [])
      )
    );

  // Fetch authorization rules
  const rules = await db
    .select()
    .from(expenseAuthorizationRules)
    .where(eq(expenseAuthorizationRules.companyId, companyId));

  for (const e of expenses) {
    const matchingRule = rules.find(
      (r) => e.amountCents >= r.minAmount && (r.maxAmount === null || e.amountCents <= r.maxAmount)
    );

    // SELF_APPROVAL: same person created and approved (for amounts that require authorization)
    if (
      e.status === "APPROVED" &&
      e.requestedBy === e.approvedBy &&
      matchingRule &&
      matchingRule.minAmount > 0
    ) {
      violations.push({
        id: `self-${e.id}`,
        type: "SELF_APPROVAL",
        severity: "HIGH",
        expenseId: e.id,
        branchName: e.branchName,
        category: e.category,
        amountCents: e.amountCents,
        description: e.description,
        detail: `${e.requestedByName || "Usuario"} creó y aprobó su propio gasto. Se requiere segregación de funciones para montos > $${(matchingRule.minAmount / 100).toFixed(2)} MXN.`,
        createdAt: e.createdAt,
      });
    }

    // OVERDUE_APPROVAL: pending for >48h
    if (e.status === "PENDING_APPROVAL" && e.createdAt < overdueThreshold) {
      const hoursPending = Math.round((now.getTime() - e.createdAt.getTime()) / (60 * 60 * 1000));
      violations.push({
        id: `overdue-${e.id}`,
        type: "OVERDUE_APPROVAL",
        severity: hoursPending > 72 ? "HIGH" : "MEDIUM",
        expenseId: e.id,
        branchName: e.branchName,
        category: e.category,
        amountCents: e.amountCents,
        description: e.description,
        detail: `Gasto pendiente de aprobación desde hace ${hoursPending}h. Requiere atención inmediata del nivel autorizado.`,
        createdAt: e.createdAt,
      });
    }

    // ROLE_MISMATCH: approver doesn't have the required role
    if (
      e.status === "APPROVED" &&
      e.approvedByRole &&
      matchingRule &&
      !roleIsAtLeast(e.approvedByRole, matchingRule.approverRole)
    ) {
      violations.push({
        id: `role-${e.id}`,
        type: "ROLE_MISMATCH",
        severity: "HIGH",
        expenseId: e.id,
        branchName: e.branchName,
        category: e.category,
        amountCents: e.amountCents,
        description: e.description,
        detail: `${e.approvedByName || "Aprobador"} (rol: ${e.approvedByRole}) aprobó un gasto que requiere rol ${matchingRule.approverRole}.`,
        createdAt: e.createdAt,
      });
    }
  }

  // 4. CONTRACT_VARIANCE_EXCEEDED: Facturas de servicios recurrentes (Renta/CFE) que exceden la tolerancia base (Módulo 4.2 & 5.1)
  const contracts = await db.query.recurringContracts.findMany({
    where: and(
      eq(recurringContracts.companyId, companyId),
      eq(recurringContracts.active, true),
      ...(branchId ? [eq(recurringContracts.branchId, branchId)] : [])
    ),
  });

  for (const contract of contracts) {
    const recentInvoices = await db.query.invoices.findMany({
      where: and(
        eq(invoices.companyId, companyId),
        eq(invoices.supplierId, contract.supplierId),
        ...(contract.branchId ? [eq(invoices.branchId, contract.branchId)] : [])
      ),
      limit: 5,
      orderBy: (inv, { desc }) => [desc(inv.createdAt)],
    });

    for (const inv of recentInvoices) {
      const varianceCents = inv.total - contract.baseAmountCents;
      const variancePercent = contract.baseAmountCents > 0
        ? Math.round((varianceCents / contract.baseAmountCents) * 1000) / 10
        : 0;

      const folio = inv.folio || inv.uuid.slice(0, 8);
      const sucursal = contract.branchId ? "Sucursal asignada" : "Corporativo / Cadena";

      if (variancePercent > contract.varianceTolerancePercent) {
        violations.push({
          id: `contract-${inv.id}`,
          type: "CONTRACT_VARIANCE_EXCEEDED",
          severity: variancePercent > 25 ? "HIGH" : "MEDIUM",
          expenseId: inv.id,
          branchName: sucursal,
          category: contract.contractType,
          amountCents: inv.total,
          description: `Sobrecosto en contrato recurrente: ${contract.title}`,
          detail: `Factura ${folio} por $${(inv.total / 100).toFixed(2)} MXN supera el monto contratado de $${(contract.baseAmountCents / 100).toFixed(2)} MXN (+${variancePercent}% vs tolerancia +${contract.varianceTolerancePercent}%).`,
          createdAt: inv.createdAt,
        });
      } else if (
        // `null` = el contrato no pidió alerta por debajo, que es lo correcto
        // en una renta. Sólo se evalúa cuando alguien la configuró a propósito.
        contract.varianceToleranceBelowPercent !== null &&
        variancePercent < -contract.varianceToleranceBelowPercent
      ) {
        const caida = Math.abs(variancePercent);
        violations.push({
          id: `contract-below-${inv.id}`,
          type: "CONTRACT_VARIANCE_BELOW",
          // Severidad más baja que un sobrecosto del mismo tamaño: no es dinero
          // que ya se fue, es dinero que probablemente llegue después. Se
          // reporta para que nadie tome el mes bueno como la nueva normalidad.
          severity: caida > 50 ? "MEDIUM" : "LOW",
          expenseId: inv.id,
          branchName: sucursal,
          category: contract.contractType,
          amountCents: inv.total,
          description: `Recibo anormalmente bajo: ${contract.title}`,
          detail: `Factura ${folio} por $${(inv.total / 100).toFixed(2)} MXN queda ${caida}% por debajo del monto base de $${(contract.baseAmountCents / 100).toFixed(2)} MXN (tolerancia -${contract.varianceToleranceBelowPercent}%). En servicios medidos suele ser lectura estimada: verifica el recibo, porque el ajuste llega en el período siguiente.`,
          createdAt: inv.createdAt,
        });
      }
    }
  }

  // 5. RECURRING_SHORTAGE: faltantes repetidos en el mismo turno de una sucursal.
  //
  // Es el único tipo que no sale de un gasto: se deriva del ledger de eventos
  // (`cash-variance-alert-service`), igual de recalculado que los otros cuatro
  // y sin tabla propia. Si falla, el panel muestra las excepciones de gasto en
  // vez de no mostrar nada: una consulta caída no debe borrar el resto del
  // análisis de control interno.
  try {
    const patrones = await getRecurringShortageFindings(companyId, branchId);
    for (const p of patrones) {
      violations.push({
        id: `shortage-${p.branchId}-${p.shift}`,
        type: "RECURRING_SHORTAGE",
        // A partir de 5 faltantes en la ventana ya no es un turno flojo: es
        // dinero que sale con regularidad por el mismo lugar.
        severity: p.shortageCount >= 5 ? "HIGH" : "MEDIUM",
        expenseId: null,
        branchName: p.branchName,
        category: `Turno ${shiftLabel(p.shift)}`,
        amountCents: p.totalShortageCents,
        description: "Faltantes recurrentes en arqueo de caja",
        detail:
          `${p.shortageCount} faltantes en los últimos ${p.windowCuts} cortes del turno ` +
          `${shiftLabel(p.shift)}, por $${(p.totalShortageCents / 100).toFixed(2)} MXN acumulados. ` +
          `El más reciente es del ${p.lastCutDate}. El patrón es por sucursal y turno: el corte no ` +
          `registra quién manejó la caja.`,
        // La fecha del hallazgo es la del corte que lo mantiene vivo, para que
        // ordene junto a las excepciones de esos días y no siempre hasta arriba.
        createdAt: new Date(`${p.lastCutDate}T12:00:00Z`),
      });
    }
  } catch (err) {
    console.error("[ControlInterno] No se pudieron derivar los faltantes recurrentes:", err);
  }

  // Sort by severity (HIGH first) then by date
  const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  violations.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      b.createdAt.getTime() - a.createdAt.getTime()
  );

  return violations;
}
