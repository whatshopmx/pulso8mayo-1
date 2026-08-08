// M17: Control Interno Service
// Audit trail, violation detection, and segregation of duties enforcement.

import { db } from "@/lib/db";
import {
  operatingExpenses,
  expenseAuthorizationRules,
  users,
  branches,
} from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { roleIsAtLeast } from "@/lib/permissions";

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
  type: "SELF_APPROVAL" | "OVERDUE_APPROVAL" | "ROLE_MISMATCH";
  severity: "LOW" | "MEDIUM" | "HIGH";
  expenseId: string;
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

  // Sort by severity (HIGH first) then by date
  const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  violations.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      b.createdAt.getTime() - a.createdAt.getTime()
  );

  return violations;
}
