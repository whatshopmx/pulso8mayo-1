// M16 / T37-T38: Operating Expense & Authorization Service
// Manages recurring/operating expenses (rent, utilities, maintenance) and amount-based approvals.

import { db } from "@/lib/db";
import {
  operatingExpenses,
  expenseAuthorizationRules,
  users,
  branches,
  invoices,
} from "@/lib/db/schema";
import { eq, and, desc, lte, gte, or, isNull } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";
import { ROLES_HIERARCHY } from "@/lib/permissions";
import type { Role } from "@/lib/permissions";

export interface CreateExpenseInput {
  companyId: string;
  branchId: string;
  category: "RENTA" | "SERVICIOS" | "MANTENIMIENTO" | "PUBLICIDAD" | "SERVICIOS_PROFESIONALES" | "OTROS";
  amountCents: number;
  description: string;
  invoiceId?: string;
  dueDate?: string;
  /** URL del ticket/foto de evidencia (R2). */
  evidenceUrl?: string;
  requestedBy: string;
  userRole?: string;
}

/**
 * Find the authorization rule that applies to a given amount.
 * Returns the required approver role, or null if no rule matches.
 */
async function findAuthorizationRule(companyId: string, amountCents: number) {
  const [rule] = await db
    .select()
    .from(expenseAuthorizationRules)
    .where(
      and(
        eq(expenseAuthorizationRules.companyId, companyId),
        lte(expenseAuthorizationRules.minAmount, amountCents),
        or(
          isNull(expenseAuthorizationRules.maxAmount),
          gte(expenseAuthorizationRules.maxAmount, amountCents)
        )
      )
    )
    .limit(1);

  return rule ?? null;
}

/**
 * Check if a user's role is sufficient to satisfy a required approver role.
 * Uses the role hierarchy: higher number = more authority.
 */
function roleIsAtLeast(userRole: string, requiredRole: string): boolean {
  const userLevel = ROLES_HIERARCHY[userRole as Role] ?? 0;
  const requiredLevel = ROLES_HIERARCHY[requiredRole as Role] ?? 0;
  return userLevel >= requiredLevel;
}

export async function createOperatingExpense(input: CreateExpenseInput) {
  // Query expenseAuthorizationRules to determine the required approver role
  const rule = await findAuthorizationRule(input.companyId, input.amountCents);
  const requiredApproverRole = rule?.approverRole ?? "OWNER"; // default to OWNER if no rule

  let initialStatus: "APPROVED" | "PENDING_APPROVAL" = "PENDING_APPROVAL";
  let approvedBy: string | null = null;
  let approvalNotes: string | null = null;

  // Auto-approve if the requesting user's role is sufficient per the authorization rule
  if (input.userRole && roleIsAtLeast(input.userRole, requiredApproverRole)) {
    initialStatus = "APPROVED";
    approvedBy = input.requestedBy;
    approvalNotes = `Auto-aprobado según regla: rol ${input.userRole} ≥ ${requiredApproverRole} para montos hasta $${((rule?.maxAmount ?? Infinity) / 100).toLocaleString("es-MX")} MXN.`;
  }

  const [expense] = await db
    .insert(operatingExpenses)
    .values({
      companyId: input.companyId,
      branchId: input.branchId,
      category: input.category,
      amount: input.amountCents,
      description: input.description,
      invoiceId: input.invoiceId || null,
      evidenceUrl: input.evidenceUrl || null,
      status: initialStatus,
      requestedBy: input.requestedBy,
      approvedBy,
      approvalNotes,
      dueDate: input.dueDate || null,
    })
    .returning();

  // If pending approval, notify the required approvers
  if (initialStatus === "PENDING_APPROVAL") {
    try {
      await NotificationDispatcher.sendNotification({
        userId: input.companyId,
        title: "📑 Gasto Pendiente de Aprobación",
        message: `Nuevo gasto de ${input.category} por $${(input.amountCents / 100).toLocaleString("es-MX")} MXN requiere aprobación de ${requiredApproverRole}.`,
        type: "info",
        eventType: "shift_approval_request",
        actionUrl: `/dashboard/finance/expenses?id=${expense.id}`,
        actionLabel: "Revisar Gasto",
      });
    } catch (err) {
      console.warn("[Expense Service] Approval notification warning:", err);
    }
  }

  return expense;
}

export async function approveOperatingExpense(
  expenseId: string,
  companyId: string,
  approverId: string,
  approverRole: string,
  notes?: string
) {
  // Fetch the expense to verify it exists and check authorization rules
  const [expense] = await db
    .select()
    .from(operatingExpenses)
    .where(
      and(
        eq(operatingExpenses.id, expenseId),
        eq(operatingExpenses.companyId, companyId)
      )
    )
    .limit(1);

  if (!expense) {
    throw new Error("El gasto especificado no fue encontrado.");
  }

  if (expense.status !== "PENDING_APPROVAL") {
    throw new Error(`No se puede aprobar un gasto en estado "${expense.status}".`);
  }

  // Verify the approver has the required role per authorization rules
  const rule = await findAuthorizationRule(companyId, expense.amount);
  const requiredRole = rule?.approverRole ?? "OWNER";

  if (!roleIsAtLeast(approverRole, requiredRole)) {
    throw new Error(
      `No tienes el nivel de autorización necesario. Este gasto requiere aprobación de ${requiredRole} (tu rol: ${approverRole}).`
    );
  }

  // Prevent self-approval for amounts above the lowest threshold
  if (expense.requestedBy === approverId && rule && rule.minAmount > 0) {
    throw new Error(
      "Segregación de funciones: la misma persona no puede crear y aprobar un gasto que requiere autorización."
    );
  }

  const [updated] = await db
    .update(operatingExpenses)
    .set({
      status: "APPROVED",
      approvedBy: approverId,
      approvalNotes: notes || "Aprobado",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operatingExpenses.id, expenseId),
        eq(operatingExpenses.companyId, companyId)
      )
    )
    .returning();

  return updated;
}

export async function getOperatingExpenses(companyId: string, branchId?: string) {
  const conditions = [eq(operatingExpenses.companyId, companyId)];
  if (branchId) {
    conditions.push(eq(operatingExpenses.branchId, branchId));
  }

  const requestedUser = db.select({ id: users.id, name: users.name }).from(users).as("reqUser");
  const approvedUser = db.select({ id: users.id, name: users.name }).from(users).as("appUser");

  const expenses = await db
    .select({
      id: operatingExpenses.id,
      companyId: operatingExpenses.companyId,
      branchId: operatingExpenses.branchId,
      branchName: branches.name,
      category: operatingExpenses.category,
      amountCents: operatingExpenses.amount,
      description: operatingExpenses.description,
      evidenceUrl: operatingExpenses.evidenceUrl,
      status: operatingExpenses.status,
      requestedBy: operatingExpenses.requestedBy,
      requestedByName: requestedUser.name,
      approvedByName: approvedUser.name,
      approvalNotes: operatingExpenses.approvalNotes,
      paidAt: operatingExpenses.paidAt,
      dueDate: operatingExpenses.dueDate,
      createdAt: operatingExpenses.createdAt,
    })
    .from(operatingExpenses)
    .innerJoin(branches, eq(operatingExpenses.branchId, branches.id))
    .leftJoin(requestedUser, eq(operatingExpenses.requestedBy, requestedUser.id))
    .leftJoin(approvedUser, eq(operatingExpenses.approvedBy, approvedUser.id))
    .where(and(...conditions))
    .orderBy(desc(operatingExpenses.createdAt));

  // Enrich each expense with its required approver role from the rules table
  const rules = await db
    .select()
    .from(expenseAuthorizationRules)
    .where(eq(expenseAuthorizationRules.companyId, companyId));

  return expenses.map((expense) => {
    const matchingRule = rules.find(
      (r) => expense.amountCents >= r.minAmount && (r.maxAmount === null || expense.amountCents <= r.maxAmount)
    );
    return {
      ...expense,
      requiredApproverRole: matchingRule?.approverRole ?? null,
    };
  });
}
