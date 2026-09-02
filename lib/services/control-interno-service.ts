// M17: Control Interno Service
// Audit trail, violation detection, and segregation of duties enforcement.

import { db } from "@/lib/db";
import {
  operatingExpenses,
  expenseAuthorizationRules,
  invoices,
  tenantOperatingConfig,
  users,
  branches,
} from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { UMBRAL_EFECTIVO_DEDUCIBLE_CENTS } from "@/lib/services/expense-service";
import { roleIsAtLeast } from "@/lib/permissions";
import {
  getRecurringShortageFindings,
  shiftLabel,
} from "@/lib/services/cash-variance-alert-service";
import { getRecurringContractFindings } from "@/lib/services/recurring-contract-variance";

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
    /**
     * Consumo de un servicio medido que subió y se quedó arriba (V2.3).
     *
     * No nace de una factura sino de la pendiente de varias. Existe porque es
     * el riesgo que introduce la base móvil: si el consumo sube y se sostiene,
     * la mediana lo absorbe y la fuga se vuelve la nueva normalidad sin que
     * ningún recibo suelto rebase su tolerancia.
     */
    | "CONTRACT_TREND_RISING"
    /** Faltantes repetidos en el mismo turno de una sucursal (F3.4). */
    | "RECURRING_SHORTAGE"
    /**
     * Varios gastos de la misma contraparte y centro de costo dentro de 72h
     * que, sumados, cruzan un umbral de autorización que ninguno cruza por
     * separado (A5.3).
     *
     * Es la forma número uno de evadir una escalera de aprobación en operación
     * multisucursal: tres facturas de $4,000 en lugar de una de $12,000. La
     * severidad arranca en MEDIA a propósito —el insumo perecedero comprado a
     * diario produce falsos positivos— y se sube a ALTA después de calibrarla
     * contra datos reales.
     */
    | "SPLIT_PURCHASE"
    /** Misma contraparte, mismo monto exacto, dentro de 7 días, ambos pagados (A5.4). */
    | "DUPLICATE_PAYMENT"
    /**
     * Gasto en efectivo por encima del umbral del artículo 27-III de la LISR
     * (A4.3). Severidad MEDIA: es dinero que se paga de más en impuestos, no
     * dinero que se fue.
     */
    | "NON_DEDUCTIBLE_CASH"
    /**
     * CFDI ya conciliado que el emisor canceló después (A6.3).
     *
     * La cancelación es unilateral y no avisa. Si el grupo ya dedujo esa
     * factura, la deducción se cae y se entera cuando el SAT la rechaza —meses
     * después y con recargos.
     */
    | "CFDI_CANCELADO";
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

/**
 * Los umbrales de autorización que alguien podría querer evadir, en centavos.
 *
 * Salen de dos lugares y los dos hacen falta:
 *
 *  - Los `minAmount` de `expense_authorization_rules`, que es la escalera que
 *    el grupo configuró. Un escalón en cero es el tramo por omisión y no
 *    representa una barrera, así que se descarta.
 *  - `tenant_operating_config.doubleApprovalThresholdCents`, que existe con
 *    default ($10,000 MXN) aunque nadie haya capturado una sola regla. Sin este
 *    respaldo la detección de fraccionamiento no corría en ningún inquilino
 *    nuevo — que es donde más falta hace, porque es donde nadie está mirando.
 *
 * Ordenados de menor a mayor: la regla busca el escalón **más bajo** que la
 * racha cruza sumada y ninguno de sus gastos cruza por separado.
 */
function umbralesDeAutorizacion(
  rules: Array<{ minAmount: number }>,
  doubleApprovalThresholdCents: number | null,
): number[] {
  const escalones = new Set<number>();
  for (const r of rules) if (r.minAmount > 0) escalones.add(r.minAmount);
  if (doubleApprovalThresholdCents && doubleApprovalThresholdCents > 0) {
    escalones.add(doubleApprovalThresholdCents);
  }
  return [...escalones].sort((a, b) => a - b);
}

/**
 * El escalón que una racha evade, o `null` si no evade ninguno.
 *
 * "Evadir" tiene una definición precisa: la suma lo cruza y **ningún gasto por
 * separado lo cruza**. Un gasto que ya requería firma por sí solo no está
 * fraccionando nada — se autorizó o no, pero el mecanismo es otro.
 */
function escalonEvadido(montos: number[], umbrales: number[]): number | null {
  const suma = montos.reduce((s, m) => s + m, 0);
  for (const t of umbrales) {
    if (suma > t && montos.every((m) => m < t)) return t;
  }
  return null;
}

/** `2026-09-01` → `1 sep`. Para el texto de una excepción, no para comparar. */
function fechaCorta(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

/** Cómo se nombra cada forma de pago en la bitácora. */
export const ETIQUETA_FORMA_PAGO: Record<string, string> = {
  EFECTIVO: "efectivo",
  TRANSFERENCIA: "transferencia",
  TARJETA: "tarjeta",
  DOMICILIADO: "domiciliación",
  CHEQUE: "cheque",
};

/**
 * Ventana por omisión del detector de excepciones (A5.1).
 *
 * Antes `detectViolations` traía **todos** los gastos históricos de la empresa a
 * memoria, sin filtro de período ni paginación, y los recorría en JavaScript: a
 * 15 sucursales y un año son decenas de miles de filas en cada carga de la
 * pantalla, y una excepción de hace ocho meses no es accionable de todos modos.
 *
 * Noventa días es la misma ventana que ya declara la detección de contratos
 * recurrentes, y la pantalla la dice en voz alta en vez de callarla.
 */
export const VENTANA_EXCEPCIONES_DIAS = 90;

/**
 * Cota dura de gastos que el detector carga en una pasada.
 *
 * Existe porque el filtro de período es configurable desde la ruta y un rango
 * amplio volvería a traer el histórico entero. Cuando se corta, se declara en
 * la respuesta: una lista que esconde filas en silencio es peor que una corta
 * que lo admite.
 */
export const LIMITE_GASTOS_EXCEPCIONES = 5_000;

/**
 * Ventana del fraccionamiento (A5.3). 72h: el ciclo de compra de un QSR es
 * diario, y una ventana más larga marca como fraccionamiento el reabasto normal
 * de perecedero.
 */
const VENTANA_FRACCIONAMIENTO_MS = 72 * 60 * 60 * 1000;

/** Ventana del pago duplicado (A5.4): una semana. */
const VENTANA_DUPLICADO_MS = 7 * 24 * 60 * 60 * 1000;

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
  // Tercer alias de `users`: quien pagó (A4.1). Es una persona distinta de quien
  // registró y de quien autorizó —esa distinción **es** la segregación de
  // funciones— así que necesita su propio join.
  const payUser = db.select({ id: users.id, name: users.name, role: users.role }).from(users).as("payUser");

  // Fetch raw expenses with the three user joins
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
      // A4.1 — quién pagó sale del join, no de una cadena en `approvalNotes`.
      paidBy: operatingExpenses.paidBy,
      paidByName: payUser.name,
      paidByRole: payUser.role,
      paymentMethod: operatingExpenses.paymentMethod,
      paidAt: operatingExpenses.paidAt,
      createdAt: operatingExpenses.createdAt,
      updatedAt: operatingExpenses.updatedAt,
    })
    .from(operatingExpenses)
    .innerJoin(branches, eq(operatingExpenses.branchId, branches.id))
    .leftJoin(reqUser, eq(operatingExpenses.requestedBy, reqUser.id))
    .leftJoin(appUser, eq(operatingExpenses.approvedBy, appUser.id))
    .leftJoin(payUser, eq(operatingExpenses.paidBy, payUser.id))
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
        // Antes las dos eran `null` y la bitácora no decía quién movió el
        // dinero: el nombre viajaba concatenado dentro de `approvalNotes` del
        // evento de aprobación, donde nadie lo buscaba.
        actorName: e.paidByName,
        actorRole: e.paidByRole,
        notes: e.paymentMethod ? `Pagado por ${ETIQUETA_FORMA_PAGO[e.paymentMethod]}` : null,
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
  branchId?: string,
  opts: { sinceDays?: number } = {}
): Promise<Violation[]> {
  const violations: Violation[] = [];
  const now = new Date();
  const overdueThreshold = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48h ago

  // A5.1 — período acotado. La pantalla lo declara; ver `VENTANA_EXCEPCIONES_DIAS`.
  const sinceDays = Math.max(1, opts.sinceDays ?? VENTANA_EXCEPCIONES_DIAS);
  const desde = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000);

  const reqUser = db.select({ id: users.id, name: users.name, role: users.role }).from(users).as("reqUser");
  const appUser = db.select({ id: users.id, name: users.name, role: users.role }).from(users).as("appUser");

  const expenses = await db
    .select({
      id: operatingExpenses.id,
      branchId: operatingExpenses.branchId,
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
      payeeId: operatingExpenses.payeeId,
      costCenterId: operatingExpenses.costCenterId,
      paymentMethod: operatingExpenses.paymentMethod,
      paidAt: operatingExpenses.paidAt,
      createdAt: operatingExpenses.createdAt,
    })
    .from(operatingExpenses)
    .innerJoin(branches, eq(operatingExpenses.branchId, branches.id))
    .leftJoin(reqUser, eq(operatingExpenses.requestedBy, reqUser.id))
    .leftJoin(appUser, eq(operatingExpenses.approvedBy, appUser.id))
    .where(
      and(
        eq(operatingExpenses.companyId, companyId),
        // El corte es por la fecha con la que el gasto entró al período —pago,
        // vencimiento o captura— y no sólo por `created_at`: un gasto capturado
        // hace cuatro meses y pagado ayer sigue siendo del período que se mira.
        sql`COALESCE(${operatingExpenses.paidAt}, ${operatingExpenses.createdAt}) >= ${desde}`,
        ...(branchId ? [eq(operatingExpenses.branchId, branchId)] : [])
      )
    )
    .orderBy(desc(operatingExpenses.createdAt))
    .limit(LIMITE_GASTOS_EXCEPCIONES);

  // Fetch authorization rules
  const rules = await db
    .select()
    .from(expenseAuthorizationRules)
    .where(eq(expenseAuthorizationRules.companyId, companyId));

  // El umbral de doble autorización del inquilino respalda la escalera cuando
  // no hay ninguna regla capturada, que es el estado de todo inquilino nuevo.
  const [configTenant] = await db
    .select({
      doubleApprovalThresholdCents: tenantOperatingConfig.doubleApprovalThresholdCents,
    })
    .from(tenantOperatingConfig)
    .where(eq(tenantOperatingConfig.companyId, companyId))
    .limit(1);

  for (const e of expenses) {
    const matchingRule = rules.find(
      (r) => e.amountCents >= r.minAmount && (r.maxAmount === null || e.amountCents <= r.maxAmount)
    );

    // SELF_APPROVAL — A5.2: sin carve-out por monto.
    //
    // La condición era `matchingRule && matchingRule.minAmount > 0`: justo el
    // carve-out que A16 eliminó de `expense-service` por vaciar la segregación
    // de funciones. El detector no veía los autoaprobados del tramo más bajo,
    // que es donde vive la mayoría de los gastos — y donde un fraccionamiento
    // los acomoda a propósito. La segregación de funciones no admite tramos.
    //
    // Se detecta también en PAID: un gasto autoaprobado y ya pagado no deja de
    // ser una violación por haberse consumado.
    if (
      (e.status === "APPROVED" || e.status === "PAID") &&
      e.requestedBy &&
      e.requestedBy === e.approvedBy
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
        detail:
          `${e.requestedByName || "Usuario"} registró y aprobó su propio gasto. ` +
          "La segregación de funciones no depende del monto: quien registra nunca firma.",
        createdAt: e.createdAt,
      });
    }

    // NON_DEDUCTIBLE_CASH — A4.3: LISR art. 27-III.
    //
    // Un pago en efectivo por más de $2,000 MXN no es deducible. Severidad
    // MEDIA y no ALTA a propósito: es dinero que se paga de más en impuestos,
    // no dinero que se fue. El gasto es legítimo; lo que se pierde es la
    // deducción.
    if (
      e.paymentMethod === "EFECTIVO" &&
      e.amountCents > UMBRAL_EFECTIVO_DEDUCIBLE_CENTS
    ) {
      violations.push({
        id: `cash-${e.id}`,
        type: "NON_DEDUCTIBLE_CASH",
        severity: "MEDIUM",
        expenseId: e.id,
        branchName: e.branchName,
        category: e.category,
        amountCents: e.amountCents,
        description: e.description,
        detail:
          `Pagado en efectivo por $${(e.amountCents / 100).toFixed(2)} MXN, arriba del límite de ` +
          `$${(UMBRAL_EFECTIVO_DEDUCIBLE_CENTS / 100).toFixed(2)} MXN del artículo 27-III de la LISR: ` +
          "no es deducible. Arriba de ese monto la deducción exige transferencia, cheque nominativo, tarjeta o monedero electrónico.",
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

  // ── A5.3 · Fraccionamiento ────────────────────────────────────────────────
  //
  // Varios gastos de la misma contraparte y el mismo centro de costo dentro de
  // 72h que, **sumados**, cruzan un umbral de autorización que ninguno cruza por
  // separado. Es la forma número uno de evadir una escalera de aprobación en
  // operación multisucursal —tres facturas de $4,000 en lugar de una de
  // $12,000— y hasta A5.3 no se detectaba.
  //
  // Requiere contraparte **y** centro de costo: sin los dos, la agrupación sería
  // "todo lo que se gastó el martes" y marcaría el reabasto normal. Y se acota a
  // una sola sucursal, porque dos sucursales que compran el mismo día al mismo
  // proveedor no están fraccionando nada: están operando.
  const umbralesFraccionamiento = umbralesDeAutorizacion(
    rules,
    configTenant?.doubleApprovalThresholdCents ?? null,
  );

  if (umbralesFraccionamiento.length > 0) {
    const grupos = new Map<string, typeof expenses>();

    for (const e of expenses) {
      // Sin contraparte o sin centro de costo no hay grupo que formar. No es un
      // hueco: es que el gasto casual —el taxi, el hielo— no tiene ninguno de
      // los dos, y agruparlo por descripción produciría ruido.
      if (!e.payeeId || !e.costCenterId) continue;
      if (e.status === "REJECTED") continue;
      const key = `${e.branchId}::${e.payeeId}::${e.costCenterId}`;
      const lista = grupos.get(key) ?? [];
      lista.push(e);
      grupos.set(key, lista);
    }

    for (const lista of grupos.values()) {
      if (lista.length < 2) continue;

      const ordenados = [...lista].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );

      // Ventana deslizante: se busca la racha más corta que ya cruza el umbral,
      // para que la excepción nombre exactamente los gastos que la producen y
      // no el mes entero del proveedor.
      let inicio = 0;
      const yaReportados = new Set<string>();

      for (let fin = 0; fin < ordenados.length; fin++) {
        while (
          inicio < fin &&
          ordenados[fin].createdAt.getTime() - ordenados[inicio].createdAt.getTime() >
            VENTANA_FRACCIONAMIENTO_MS
        ) {
          inicio++;
        }

        const ventana = ordenados.slice(inicio, fin + 1);
        if (ventana.length < 2) continue;

        const suma = ventana.reduce((s, x) => s + x.amountCents, 0);
        const umbralFraccionamiento = escalonEvadido(
          ventana.map((x) => x.amountCents),
          umbralesFraccionamiento,
        );

        if (umbralFraccionamiento === null) continue;

        // Una excepción por racha, anclada al gasto que la cierra: reportar
        // cada sub-ventana produciría N excepciones del mismo hecho.
        const ancla = ventana[ventana.length - 1];
        if (yaReportados.has(ancla.id)) continue;
        ventana.forEach((x) => yaReportados.add(x.id));

        violations.push({
          id: `split-${ancla.id}`,
          type: "SPLIT_PURCHASE",
          // MEDIA y no ALTA al inicio: el insumo perecedero comprado a diario
          // produce falsos positivos. Se sube después de calibrar con datos
          // reales del cliente.
          severity: "MEDIUM",
          expenseId: ancla.id,
          branchName: ancla.branchName,
          category: ancla.category,
          amountCents: suma,
          description: `Posible fraccionamiento: ${ventana.length} gastos a la misma contraparte`,
          detail:
            `${ventana.length} gastos de la misma contraparte y centro de costo en 72h suman ` +
            `$${(suma / 100).toFixed(2)} MXN y cruzan el umbral de autorización de ` +
            `$${(umbralFraccionamiento / 100).toFixed(2)} MXN, que ninguno cruza por separado ` +
            `(${ventana.map((x) => `$${(x.amountCents / 100).toFixed(2)}`).join(" + ")}). ` +
            "Verifica si debieron autorizarse como uno solo.",
          createdAt: ancla.createdAt,
        });
      }
    }
  }

  // ── A5.4 · Pago duplicado ─────────────────────────────────────────────────
  //
  // Misma contraparte, mismo monto **exacto**, dentro de 7 días, los dos ya
  // pagados. El monto exacto es lo que separa el duplicado del gasto recurrente
  // legítimo: una renta se paga una vez al mes, no dos veces en la misma semana.
  const pagados = expenses.filter(
    (e) => e.status === "PAID" && e.paidAt !== null && e.payeeId,
  );
  const porContraparteYMonto = new Map<string, typeof pagados>();

  for (const e of pagados) {
    const key = `${e.payeeId}::${e.amountCents}`;
    const lista = porContraparteYMonto.get(key) ?? [];
    lista.push(e);
    porContraparteYMonto.set(key, lista);
  }

  for (const lista of porContraparteYMonto.values()) {
    if (lista.length < 2) continue;
    const ordenados = [...lista].sort(
      (a, b) => (a.paidAt as Date).getTime() - (b.paidAt as Date).getTime(),
    );

    for (let i = 1; i < ordenados.length; i++) {
      const previo = ordenados[i - 1];
      const actual = ordenados[i];
      const delta =
        (actual.paidAt as Date).getTime() - (previo.paidAt as Date).getTime();
      if (delta > VENTANA_DUPLICADO_MS) continue;

      violations.push({
        id: `dup-${actual.id}`,
        type: "DUPLICATE_PAYMENT",
        // ALTA: a diferencia del fraccionamiento, aquí el dinero ya salió dos
        // veces. Recuperarlo depende de que alguien lo vea a tiempo.
        severity: "HIGH",
        expenseId: actual.id,
        branchName: actual.branchName,
        category: actual.category,
        amountCents: actual.amountCents,
        description: `Posible pago duplicado: ${actual.description}`,
        detail:
          `Se pagaron dos gastos de la misma contraparte por el mismo monto exacto ` +
          `($${(actual.amountCents / 100).toFixed(2)} MXN) con ${Math.round(delta / 86_400_000)} día(s) ` +
          `de diferencia (${fechaCorta(previo.paidAt as Date)} y ${fechaCorta(actual.paidAt as Date)}). ` +
          "Confirma con el proveedor antes de dar por buena la segunda salida.",
        createdAt: actual.paidAt as Date,
      });
    }
  }

  // ── A6.3 · CFDI conciliado que el emisor canceló ──────────────────────────
  //
  // El estado lo escribe el barrido mensual (`cron-cfdi-revalidation`) en
  // `invoices.sat_status`; aquí sólo se redacta la excepción. Aislado como los
  // demás bloques externos: si la consulta falla, el panel sigue mostrando las
  // excepciones de gasto.
  try {
    const canceladas = await db
      .select({
        id: invoices.id,
        uuid: invoices.uuid,
        folio: invoices.folio,
        total: invoices.total,
        fecha: invoices.fecha,
        nombreEmisor: invoices.nombreEmisor,
        rfcEmisor: invoices.rfcEmisor,
        paymentStatus: invoices.paymentStatus,
        branchName: branches.name,
        satCheckedAt: invoices.satCheckedAt,
      })
      .from(invoices)
      .leftJoin(branches, eq(invoices.branchId, branches.id))
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.satStatus, "CANCELADO"),
          ...(branchId ? [eq(invoices.branchId, branchId)] : []),
        ),
      )
      .limit(200);

    for (const f of canceladas) {
      violations.push({
        id: `cfdi-cancelado-${f.id}`,
        type: "CFDI_CANCELADO",
        // ALTA cuando ya se pagó: salió el dinero y el comprobante que lo
        // respalda dejó de existir. MEDIA cuando sigue pendiente: todavía se
        // puede no pagar.
        severity: f.paymentStatus === "PAID" ? "HIGH" : "MEDIUM",
        expenseId: f.id,
        branchName: f.branchName ?? "Sin sucursal",
        category: "FISCAL",
        amountCents: f.total,
        description: `CFDI cancelado por el emisor: ${f.nombreEmisor || f.rfcEmisor}`,
        detail:
          `La factura ${f.folio || f.uuid.slice(0, 8)} del ${f.fecha} por ` +
          `$${(f.total / 100).toFixed(2)} MXN aparece CANCELADA ante el SAT` +
          (f.paymentStatus === "PAID"
            ? ", y ya se pagó: el dinero salió y el comprobante que lo respalda dejó de existir. "
            : ", y sigue pendiente de pago. ") +
          "La deducción se cae. Pídele al proveedor el comprobante de sustitución antes de la declaración del mes.",
        createdAt: f.satCheckedAt ?? new Date(),
      });
    }
  } catch (error) {
    console.error("[ControlInterno] No se pudieron leer los CFDI cancelados:", error);
  }

  // 4. CONTRACT_VARIANCE_* y CONTRACT_TREND_RISING: facturas de contratos
  // recurrentes (renta, CFE, agua) fuera de su referencia, y consumos medidos
  // que subieron y se quedaron arriba.
  //
  // La regla y el emparejamiento viven en `recurring-contract-variance`; aquí
  // sólo se redacta la excepción. Antes esta función cruzaba cada contrato
  // contra las últimas 5 facturas del PROVEEDOR, sin acotar por contrato ni por
  // período: con dos contratos del mismo arrendador toda factura disparaba
  // sobrecosto contra el de base menor, y un recibo de hace ocho meses seguía
  // apareciendo como excepción abierta para siempre.
  //
  // Se aísla igual que los faltantes recurrentes: si la consulta falla, el
  // panel muestra las excepciones de gasto en vez de no mostrar nada.
  try {
    const { variance, trend } = await getRecurringContractFindings(companyId, branchId);

    for (const d of variance) {
      const facturado = `$${(d.invoiceTotalCents / 100).toFixed(2)} MXN`;
      const referencia = `$${(d.referenceCents / 100).toFixed(2)} MXN`;
      // De dónde salió el umbral. Se dice siempre: un número que el sistema
      // calculó solo y uno que el dueño capturó no valen lo mismo, y quien
      // investiga la excepción necesita saber cuál está discutiendo.
      const origen =
        d.referenceBasis === "ROLLING_MEDIAN"
          ? `mediana de sus ${d.referenceSampleSize} recibos anteriores`
          : "monto base capturado en el contrato";
      // Una desviación medida contra un contrato deducido no vale lo mismo que
      // una contra el contrato que la factura declara. Se dice, no se esconde.
      const procedencia =
        d.matchBasis === "INFERRED"
          ? " Contrato deducido por proveedor y sucursal: captúralo en la factura para confirmarlo."
          : "";

      if (d.kind === "ABOVE") {
        violations.push({
          id: `contract-${d.invoiceId}`,
          type: "CONTRACT_VARIANCE_EXCEEDED",
          severity: d.variancePercent > 25 ? "HIGH" : "MEDIUM",
          expenseId: d.invoiceId,
          branchName: d.branchName,
          category: d.contractType,
          amountCents: d.invoiceTotalCents,
          description: `Sobrecosto en contrato recurrente: ${d.contractTitle}`,
          detail:
            `Factura ${d.invoiceFolio} del ${d.periodDate} por ${facturado} supera su referencia ` +
            `de ${referencia} (${origen}) en +${d.variancePercent}%, con tolerancia ` +
            `+${d.toleranceAbovePercent}%.${procedencia}`,
          createdAt: d.createdAt,
        });
      } else {
        const caida = Math.abs(d.variancePercent);
        violations.push({
          id: `contract-below-${d.invoiceId}`,
          type: "CONTRACT_VARIANCE_BELOW",
          // Severidad más baja que un sobrecosto del mismo tamaño: no es dinero
          // que ya se fue, es dinero que probablemente llegue después. Se
          // reporta para que nadie tome el mes bueno como la nueva normalidad.
          severity: caida > 50 ? "MEDIUM" : "LOW",
          expenseId: d.invoiceId,
          branchName: d.branchName,
          category: d.contractType,
          amountCents: d.invoiceTotalCents,
          description: `Recibo anormalmente bajo: ${d.contractTitle}`,
          detail:
            `Factura ${d.invoiceFolio} del ${d.periodDate} por ${facturado} queda ${caida}% por ` +
            `debajo de su referencia de ${referencia} (${origen}), con tolerancia ` +
            `-${d.toleranceBelowPercent}%. En servicios medidos suele ser lectura estimada: ` +
            `verifica el recibo, porque el ajuste llega en el período siguiente.${procedencia}`,
          createdAt: d.createdAt,
        });
      }
    }

    for (const t of trend) {
      const antes = `$${(t.previousMedianCents / 100).toFixed(2)} MXN`;
      const ahora = `$${(t.recentMedianCents / 100).toFixed(2)} MXN`;
      violations.push({
        // Por sucursal y no por nombre de sucursal: renombrar un local no
        // debe cambiar la identidad de la excepción.
        id: `contract-trend-${t.contractId}-${t.branchId ?? "sin-sucursal"}`,
        type: "CONTRACT_TREND_RISING",
        // Alta a partir de la mitad: una subida sostenida de ese tamaño en un
        // servicio medido ya no es temporada, es una fuga o un equipo fallando.
        severity: t.risePercent > 50 ? "HIGH" : "MEDIUM",
        expenseId: null,
        branchName: t.branchName,
        category: t.contractType,
        amountCents: t.recentMedianCents,
        description: `Consumo al alza sostenida: ${t.contractTitle}`,
        detail:
          `Los últimos ${t.blockSize} recibos promedian ${ahora} contra ${antes} de los ` +
          `${t.blockSize} anteriores: +${t.risePercent}%, y los ${t.blockSize} están por encima ` +
          `del nivel previo. Ningún recibo suelto rebasó su tolerancia, así que la desviación ` +
          `por factura no lo ve: la referencia móvil absorbe lo que sube y se queda. El último ` +
          `es del ${t.latestPeriodDate}. Revisa fugas, equipo encendido fuera de horario o ` +
          `cambio de tarifa.`,
        createdAt: t.createdAt,
      });
    }
  } catch (err) {
    console.error("[ControlInterno] No se pudieron evaluar los contratos recurrentes:", err);
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
