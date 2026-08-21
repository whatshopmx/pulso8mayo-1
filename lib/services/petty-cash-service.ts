// M16 / T35-T36: Petty Cash Service
// Manages per-branch petty cash funds, outflow deductions, replenishments, balance atomic updates,
// and complete audit history queries for managers and owners.

import { db } from "@/lib/db";
import { pettyCashFunds, pettyCashTransactions, users, branches } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";
import { ApiError } from "@/lib/api/error";
import { assertBranchOfCompany } from "@/lib/branch-scope";

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

export interface OpenFundInput {
  companyId: string;
  branchId: string;
  /**
   * Efectivo que de verdad se entregó a la sucursal. No tiene default a
   * propósito: el que había ($5,000) llenó la base de fondos que nadie entregó
   * y los presentó como saldo real de la cadena. Abrir un fondo es un acto
   * explícito de quien puso el dinero.
   */
  fundAmountCents: number;
  /** Umbral de reposición. Por omisión, 20% del fondo entregado. */
  lowThresholdCents?: number;
  openedBy: string;
  notes?: string;
}

/**
 * Lectura pura del fondo **abierto** de una sucursal: `null` si no tiene.
 *
 * No crea nada. Antes esto era `getOrCreateFund` y el `GET` de la pantalla lo
 * llamaba una vez por sucursal, así que abrir Caja Chica con alcance "todas"
 * inventaba un fondo de $5,000 por sucursal sin que nadie hubiera entregado un
 * peso. Ver `scripts/check-fondos-fantasma.ts` para los ya escritos.
 *
 * `active = false` es un fondo dado de baja: se lee como si no hubiera fondo.
 * Hasta A1 la columna era decorativa —nadie la consultaba— y es la que usa
 * `scripts/baja-fondos-fantasma.ts` para sacar del saldo de la cadena el
 * efectivo que el sistema inventó, sin borrar la evidencia de que lo hizo.
 */
export async function getFund(companyId: string, branchId: string) {
  const [existing] = await db
    .select()
    .from(pettyCashFunds)
    .where(
      and(
        eq(pettyCashFunds.companyId, companyId),
        eq(pettyCashFunds.branchId, branchId),
        eq(pettyCashFunds.active, true)
      )
    )
    .limit(1);

  return existing ?? null;
}

/**
 * El fondo de una sucursal, o un error legible si no está abierto.
 * Las escrituras pasan por aquí: crear el fondo bajo la mesa era lo que hacía
 * indistinguible un saldo entregado de uno inventado.
 */
async function requireFund(companyId: string, branchId: string) {
  // Antes que el fondo, la sucursal: sin esto una sucursal de otra empresa
  // fallaba con "no tiene un fondo abierto", que es un mensaje que invita a
  // abrirle fondo a la sucursal de alguien más.
  await assertBranchOfCompany(companyId, branchId);

  const fund = await getFund(companyId, branchId);
  if (!fund) {
    throw ApiError.badRequest(
      "Esta sucursal no tiene un fondo de caja chica abierto. Ábrelo indicando el efectivo que se entregó antes de registrar movimientos."
    );
  }
  return fund;
}

/**
 * Abre el fondo de una sucursal con el monto entregado.
 *
 * La apertura deja su propio movimiento en la bitácora: un fondo con saldo y
 * sin un solo movimiento es precisamente la huella de los fondos fantasma, y
 * no queremos seguir produciéndola.
 *
 * Si la sucursal tiene una fila **dada de baja**, esto la reabre con el monto
 * nuevo en vez de fallar: el índice único es por `(company, branch)` sin mirar
 * `active`, así que sin esta rama una sucursal saneada quedaría con la pantalla
 * diciendo "sin fondo" y el botón de abrir chocando contra un conflicto
 * invisible.
 */
export async function openFund(input: OpenFundInput) {
  // La única escritura que inserta la sucursal tal cual llega. La llave foránea
  // la deja pasar —la sucursal ajena existe— así que la fila quedaba con el
  // `company_id` de quien abrió y el `branch_id` de otra empresa.
  await assertBranchOfCompany(input.companyId, input.branchId);

  const lowThreshold =
    input.lowThresholdCents ?? Math.round(input.fundAmountCents * 0.2);

  return await db.transaction(async (tx) => {
    // El índice único `petty_cash_fund_branch_unique` es la guarda real contra
    // dos aperturas simultáneas; el pre-SELECT solo daría un mensaje más bonito.
    const [created] = await tx
      .insert(pettyCashFunds)
      .values({
        companyId: input.companyId,
        branchId: input.branchId,
        fundAmount: input.fundAmountCents,
        currentBalance: input.fundAmountCents,
        lowThreshold,
        active: true,
      })
      .onConflictDoNothing({
        target: [pettyCashFunds.companyId, pettyCashFunds.branchId],
      })
      .returning();

    let fondo = created;
    let reapertura = false;

    if (!fondo) {
      // La lectura va por `tx`: fuera de la transacción no vería la fila que
      // la propia apertura pudo tocar, y decidiría la reapertura a ciegas.
      const [existente] = await tx
        .select()
        .from(pettyCashFunds)
        .where(
          and(
            eq(pettyCashFunds.companyId, input.companyId),
            eq(pettyCashFunds.branchId, input.branchId)
          )
        )
        .limit(1);
      if (existente?.active !== false) {
        throw ApiError.badRequest(
          "Esta sucursal ya tiene un fondo de caja chica abierto. Usa una reposición para agregarle saldo."
        );
      }
      const [reabierto] = await tx
        .update(pettyCashFunds)
        .set({
          fundAmount: input.fundAmountCents,
          currentBalance: input.fundAmountCents,
          lowThreshold,
          active: true,
          updatedAt: new Date(),
        })
        .where(eq(pettyCashFunds.id, existente.id))
        .returning();
      fondo = reabierto;
      reapertura = true;
    }

    await tx.insert(pettyCashTransactions).values({
      fundId: fondo.id,
      type: "REPLENISHMENT",
      amount: input.fundAmountCents,
      concept: reapertura
        ? "Reapertura del fondo de caja chica"
        : "Apertura del fondo de caja chica",
      registeredBy: input.openedBy,
      approvedBy: input.openedBy,
      authorizationNotes: input.notes?.trim() || "Efectivo entregado a la sucursal.",
    });

    return fondo;
  });
}

export async function registerOutflow(input: RegisterOutflowInput) {
  const fund = await requireFund(input.companyId, input.branchId);

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
  const fund = await requireFund(input.companyId, input.branchId);

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
