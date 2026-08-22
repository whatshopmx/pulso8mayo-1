// M16 / T35-T36: Petty Cash Service
// Manages per-branch petty cash funds, outflow deductions, replenishments, balance atomic updates,
// and complete audit history queries for managers and owners.

import { db } from "@/lib/db";
import { pettyCashFunds, pettyCashTransactions, users, branches } from "@/lib/db/schema";
import { eq, and, desc, count, inArray } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";
import { ApiError } from "@/lib/api/error";
import { assertBranchOfCompany, type BranchScope } from "@/lib/branch-scope";

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

export async function getPettyCashAuditHistory(
  companyId: string,
  opts: {
    branchId?: string;
    /** Acota a fondos concretos. Lo usa el consolidado, que ya los resolvió. */
    fundIds?: string[];
    /**
     * A19 — La bitácora no se devuelve entera. Sin cota, una cadena con años de
     * movimientos manda miles de filas a una tabla que muestra las últimas.
     */
    limit?: number;
  } = {}
) {
  const conditions = [eq(pettyCashFunds.companyId, companyId)];
  if (opts.branchId) {
    conditions.push(eq(pettyCashFunds.branchId, opts.branchId));
  }
  if (opts.fundIds) {
    if (opts.fundIds.length === 0) return [];
    conditions.push(inArray(pettyCashTransactions.fundId, opts.fundIds));
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
    .orderBy(desc(pettyCashTransactions.createdAt))
    .limit(opts.limit ?? PETTY_CASH_MOVIMIENTOS_LIMIT);

  return rows;
}

/** Estado del fondo de una sucursal dentro de la vista consolidada. */
export interface BranchFundRow {
  branchId: string;
  branchName: string;
  currentBalanceCents: number;
  fundAmountCents: number;
  lowThresholdCents: number;
  belowThreshold: boolean;
}

export interface PettyCashConsolidado {
  totals: {
    currentBalanceCents: number;
    fundAmountCents: number;
    branchesWithFund: number;
    /**
     * El umbral NO es aditivo: sumarlo dejaría que la cadena luzca sana
     * mientras una sucursal está en cero. Se cuenta cuántas están bajo el suyo.
     */
    branchesBelowThreshold: number;
  };
  /** Ya ordenadas por urgencia: primero a quién hay que mandarle dinero. */
  rows: BranchFundRow[];
  /**
   * Sucursales del alcance sin fondo abierto. No es un error ni una omisión:
   * es efectivo que nadie ha entregado todavía, y hasta A1 el sistema lo
   * inventaba en vez de decirlo.
   */
  branchesWithoutFund: Array<{ branchId: string; branchName: string }>;
  movimientos: {
    items: Awaited<ReturnType<typeof getPettyCashAuditHistory>>;
    /** Cuántos hay en total, para que la bitácora declare lo que no muestra. */
    total: number;
    limit: number;
  };
}

/** Cota por omisión de la bitácora. Ver A19. */
export const PETTY_CASH_MOVIMIENTOS_LIMIT = 100;

/**
 * A17 — El estado de caja chica de todo el alcance, en una sola lectura.
 *
 * La pantalla pedía dos endpoints **por sucursal**: con 15 sucursales eran 30
 * peticiones, cada una pasando por el limitador de tasa y por una verificación
 * de sesión que es a su vez un `fetch` a `/api/auth/get-session`. Y como cada
 * una podía fallar por su cuenta, el saldo de la cadena era la suma de lo que
 * alcanzó a llegar: la página tenía que avisar de qué sucursales no sabía nada.
 *
 * Aquí son tres consultas fijas —fondos por sucursal, movimientos acotados y el
 * conteo de los que existen— sin importar cuántas sucursales haya. El
 * `LEFT JOIN` es lo que permite distinguir en el propio resultado la sucursal
 * **sin fondo abierto** (fila con `fund_id` nulo) de la que no respondió: ya no
 * hay "no respondió", porque la petición es una y falla entera o no falla.
 *
 * El orden por urgencia y el conteo bajo umbral salen de aquí y no del cliente:
 * son la respuesta a "¿a dónde mando dinero?", que es la pregunta de la
 * pantalla, y no deben depender de qué respuestas llegaron primero.
 *
 * `NONE` devuelve vacío en vez de la cadena entera: es un rol acotado a
 * sucursal sin sucursal asignada, y fallar abierto aquí es enseñar el efectivo
 * de todo el grupo.
 */
export async function getPettyCashConsolidado(
  companyId: string,
  scope: BranchScope,
  opts: { movimientosLimit?: number } = {}
): Promise<PettyCashConsolidado> {
  const limit = opts.movimientosLimit ?? PETTY_CASH_MOVIMIENTOS_LIMIT;

  const vacio: PettyCashConsolidado = {
    totals: {
      currentBalanceCents: 0,
      fundAmountCents: 0,
      branchesWithFund: 0,
      branchesBelowThreshold: 0,
    },
    rows: [],
    branchesWithoutFund: [],
    movimientos: { items: [], total: 0, limit },
  };

  if (scope.kind === "NONE") return vacio;

  const branchCond = [eq(branches.companyId, companyId)];
  if (scope.kind === "BRANCH") {
    // La sucursal pedida tiene que ser de esta empresa antes de contestar nada
    // sobre ella; si no, "sin fondo abierto" sería una respuesta sobre el
    // efectivo de alguien más.
    await assertBranchOfCompany(companyId, scope.branchId);
    branchCond.push(eq(branches.id, scope.branchId));
  }

  // Las sucursales mandan, no los fondos: el `LEFT JOIN` deja fila para la
  // sucursal que todavía no abrió el suyo. Se toman todas las de la empresa
  // (sin filtrar por `active`) para que esta lista coincida con la del selector
  // del encabezado, que usa `BranchService.listBranches` y tampoco filtra.
  const filas = await db
    .select({
      branchId: branches.id,
      branchName: branches.name,
      fundId: pettyCashFunds.id,
      currentBalance: pettyCashFunds.currentBalance,
      fundAmount: pettyCashFunds.fundAmount,
      lowThreshold: pettyCashFunds.lowThreshold,
    })
    .from(branches)
    .leftJoin(
      pettyCashFunds,
      and(
        eq(pettyCashFunds.branchId, branches.id),
        eq(pettyCashFunds.companyId, companyId),
        // Un fondo dado de baja se lee como si no hubiera fondo: es la columna
        // con la que se sacó del saldo el efectivo que el sistema inventó.
        eq(pettyCashFunds.active, true)
      )
    )
    .where(and(...branchCond));

  const conFondo = filas.filter((f) => f.fundId !== null);

  const rows: BranchFundRow[] = conFondo
    .map((f) => ({
      branchId: f.branchId,
      branchName: f.branchName,
      currentBalanceCents: f.currentBalance ?? 0,
      fundAmountCents: f.fundAmount ?? 0,
      lowThresholdCents: f.lowThreshold ?? 0,
      belowThreshold: (f.currentBalance ?? 0) <= (f.lowThreshold ?? 0),
    }))
    .sort((a, b) => {
      if (a.belowThreshold !== b.belowThreshold) return a.belowThreshold ? -1 : 1;
      return a.currentBalanceCents - b.currentBalanceCents;
    });

  const fundIds = conFondo.map((f) => f.fundId as string);

  // Sin fondos no hay movimientos que pedir, y un `inArray` vacío es SQL
  // inválido en Drizzle.
  const [items, [totalRow]] = fundIds.length
    ? await Promise.all([
        getPettyCashAuditHistory(companyId, {
          fundIds,
          limit,
        }),
        db
          .select({ n: count() })
          .from(pettyCashTransactions)
          .where(inArray(pettyCashTransactions.fundId, fundIds)),
      ])
    : [[], [{ n: 0 }]];

  return {
    totals: {
      currentBalanceCents: rows.reduce((s, r) => s + r.currentBalanceCents, 0),
      fundAmountCents: rows.reduce((s, r) => s + r.fundAmountCents, 0),
      branchesWithFund: rows.length,
      branchesBelowThreshold: rows.filter((r) => r.belowThreshold).length,
    },
    rows,
    branchesWithoutFund: filas
      .filter((f) => f.fundId === null)
      .map((f) => ({ branchId: f.branchId, branchName: f.branchName })),
    movimientos: { items, total: Number(totalRow?.n ?? 0), limit },
  };
}
