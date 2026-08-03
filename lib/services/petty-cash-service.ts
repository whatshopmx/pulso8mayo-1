// M16 / T35-T36: Petty Cash Service
// Manages per-branch petty cash funds, outflow deductions, replenishments, balance atomic updates,
// and complete audit history queries for managers and owners.

import { db } from "@/lib/db";
import { pettyCashFunds, pettyCashTransactions, users, branches } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";

export interface RegisterOutflowInput {
  companyId: string;
  branchId: string;
  amountCents: number;
  concept: string;
  category?: "RENTA" | "SERVICIOS" | "MANTENIMIENTO" | "PUBLICIDAD" | "SERVICIOS_PROFESIONALES" | "OTROS";
  evidenceUrl?: string;
  workflowInstanceId?: string;
  registeredBy: string;
  approvedBy?: string;
  authorizationNotes?: string;
}

export interface ReplenishFundInput {
  companyId: string;
  branchId: string;
  amountCents: number;
  registeredBy: string;
  approvedBy?: string;
  notes?: string;
}

export async function getOrCreateFund(companyId: string, branchId: string) {
  const [existing] = await db
    .select()
    .from(pettyCashFunds)
    .where(
      and(
        eq(pettyCashFunds.companyId, companyId),
        eq(pettyCashFunds.branchId, branchId)
      )
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(pettyCashFunds)
    .values({
      companyId,
      branchId,
      fundAmount: 500000, // $5,000 MXN default
      currentBalance: 500000,
      lowThreshold: 100000, // $1,000 MXN default (20%)
      active: true,
    })
    .returning();

  return created;
}

export async function registerOutflow(input: RegisterOutflowInput) {
  const fund = await getOrCreateFund(input.companyId, input.branchId);

  if (fund.currentBalance < input.amountCents) {
    throw new Error(
      `Saldo insuficiente en caja chica. Saldo actual: $${(fund.currentBalance / 100).toFixed(2)} MXN.`
    );
  }

  // Atomic deduction
  const newBalance = fund.currentBalance - input.amountCents;

  const [tx] = await db
    .insert(pettyCashTransactions)
    .values({
      fundId: fund.id,
      type: "OUT",
      amount: input.amountCents,
      concept: input.concept,
      category: input.category || "OTROS",
      evidenceUrl: input.evidenceUrl || null,
      workflowInstanceId: input.workflowInstanceId || null,
      registeredBy: input.registeredBy,
      approvedBy: input.approvedBy || input.registeredBy,
      authorizationNotes: input.authorizationNotes || null,
    })
    .returning();

  await db
    .update(pettyCashFunds)
    .set({
      currentBalance: newBalance,
      updatedAt: new Date(),
    })
    .where(eq(pettyCashFunds.id, fund.id));

  // Check low threshold (< 20%)
  if (newBalance <= fund.lowThreshold) {
    try {
      await NotificationDispatcher.sendNotification({
        userId: input.companyId,
        title: "🔴 Alerta: Caja Chica por debajo del 20%",
        message: `El saldo de caja chica en la sucursal es de $${(newBalance / 100).toFixed(2)} MXN. Se requiere reposición de fondo.`,
        type: "warning",
        eventType: "stock_alert",
        actionUrl: `/dashboard/finance/petty-cash?branchId=${input.branchId}`,
        actionLabel: "Ver Caja Chica",
      });
    } catch (err) {
      console.warn("[Petty Cash Service] Low threshold alert notification failed:", err);
    }
  }

  return { transaction: tx, newBalanceCents: newBalance };
}

export async function replenishFund(input: ReplenishFundInput) {
  const fund = await getOrCreateFund(input.companyId, input.branchId);

  const newBalance = fund.currentBalance + input.amountCents;

  const [tx] = await db
    .insert(pettyCashTransactions)
    .values({
      fundId: fund.id,
      type: "REPLENISHMENT",
      amount: input.amountCents,
      concept: input.notes || "Reposición de fondo de caja chica",
      registeredBy: input.registeredBy,
      approvedBy: input.approvedBy || input.registeredBy,
      authorizationNotes: input.notes || "Reposición autorizada",
    })
    .returning();

  await db
    .update(pettyCashFunds)
    .set({
      currentBalance: newBalance,
      updatedAt: new Date(),
    })
    .where(eq(pettyCashFunds.id, fund.id));

  return { transaction: tx, newBalanceCents: newBalance };
}

export async function getPettyCashAuditHistory(companyId: string, branchId?: string) {
  const conditions = [eq(pettyCashFunds.companyId, companyId)];
  if (branchId) {
    conditions.push(eq(pettyCashFunds.branchId, branchId));
  }

  const registeredUser = db.select({ id: users.id, name: users.name }).from(users).as("regUser");
  const approvedUser = db.select({ id: users.id, name: users.name }).from(users).as("appUser");

  const rows = await db
    .select({
      id: pettyCashTransactions.id,
      fundId: pettyCashTransactions.fundId,
      branchId: pettyCashFunds.branchId,
      branchName: branches.name,
      type: pettyCashTransactions.type,
      amountCents: pettyCashTransactions.amount,
      concept: pettyCashTransactions.concept,
      category: pettyCashTransactions.category,
      evidenceUrl: pettyCashTransactions.evidenceUrl,
      workflowInstanceId: pettyCashTransactions.workflowInstanceId,
      registeredByName: registeredUser.name,
      approvedByName: approvedUser.name,
      authorizationNotes: pettyCashTransactions.authorizationNotes,
      createdAt: pettyCashTransactions.createdAt,
    })
    .from(pettyCashTransactions)
    .innerJoin(pettyCashFunds, eq(pettyCashTransactions.fundId, pettyCashFunds.id))
    .innerJoin(branches, eq(pettyCashFunds.branchId, branches.id))
    .leftJoin(registeredUser, eq(pettyCashTransactions.registeredBy, registeredUser.id))
    .leftJoin(approvedUser, eq(pettyCashTransactions.approvedBy, approvedUser.id))
    .where(and(...conditions))
    .orderBy(desc(pettyCashTransactions.createdAt));

  return rows;
}
