// M16 / T37-T38: Operating Expense & Authorization Service
// Manages recurring/operating expenses (rent, utilities, maintenance) and amount-based approvals.

import { db } from "@/lib/db";
import {
  operatingExpenses,
  tenantOperatingConfig,
  users,
  branches,
  invoices,
} from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";

import { getTenantOperatingConfig } from "./tenant-operating-config-service";

export interface CreateExpenseInput {
  companyId: string;
  branchId: string;
  category: "RENTA" | "SERVICIOS" | "MANTENIMIENTO" | "PUBLICIDAD" | "SERVICIOS_PROFESIONALES" | "OTROS";
  amountCents: number;
  description: string;
  invoiceId?: string;
  dueDate?: string;
  requestedBy: string;
  userRole?: string;
}

export async function createOperatingExpense(input: CreateExpenseInput) {
  // Fetch tenant limits from tenant_operating_config (T41/T43)
  const config = await getTenantOperatingConfig(input.companyId);

  const managerLimit = config?.managerAuthLimitCents ?? 100000; // $1,000 default
  const doubleThreshold = config?.doubleApprovalThresholdCents ?? 1000000; // $10,000 default

  let initialStatus: "APPROVED" | "PENDING_APPROVAL" = "PENDING_APPROVAL";
  let approvedBy: string | null = null;
  let approvalNotes: string | null = null;

  // Auto-approve if requested by Manager/Admin and amount is under manager limit
  if (
    input.amountCents <= managerLimit &&
    (input.userRole === "GERENTE" || input.userRole === "ADMIN" || input.userRole === "OWNER")
  ) {
    initialStatus = "APPROVED";
    approvedBy = input.requestedBy;
    approvalNotes = "Auto-aprobado dentro del límite de autonomía del gerente.";
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
      status: initialStatus,
      requestedBy: input.requestedBy,
      approvedBy,
      approvalNotes,
      dueDate: input.dueDate || null,
    })
    .returning();

  // If pending approval, notify required approvers
  if (initialStatus === "PENDING_APPROVAL") {
    const requiredRole = input.amountCents >= doubleThreshold ? "OWNER" : "DIRECTOR_OPS";
    try {
      await NotificationDispatcher.sendNotification({
        userId: input.companyId,
        title: "📑 Gasto Pendiente de Aprobación",
        message: `Nuevo gasto de ${input.category} por $${(input.amountCents / 100).toLocaleString("es-MX")} MXN requiere aprobación (${requiredRole}).`,
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
  notes?: string
) {
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

  if (!updated) {
    throw new Error("El gasto especificado no fue encontrado.");
  }

  return updated;
}

export async function getOperatingExpenses(companyId: string, branchId?: string) {
  const conditions = [eq(operatingExpenses.companyId, companyId)];
  if (branchId) {
    conditions.push(eq(operatingExpenses.branchId, branchId));
  }

  const requestedUser = db.select({ id: users.id, name: users.name }).from(users).as("reqUser");
  const approvedUser = db.select({ id: users.id, name: users.name }).from(users).as("appUser");

  return db
    .select({
      id: operatingExpenses.id,
      companyId: operatingExpenses.companyId,
      branchId: operatingExpenses.branchId,
      branchName: branches.name,
      category: operatingExpenses.category,
      amountCents: operatingExpenses.amount,
      description: operatingExpenses.description,
      status: operatingExpenses.status,
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
}
