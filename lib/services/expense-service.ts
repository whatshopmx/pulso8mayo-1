// M16 / T37-T38: Operating Expense & Authorization Service
// Manages recurring/operating expenses (rent, utilities, maintenance) and amount-based approvals.

import { db } from "@/lib/db";
import {
  operatingExpenses,
  expenseAuthorizationRules,
  users,
  branches,
  payees,
} from "@/lib/db/schema";
import { eq, ne, and, desc, lte, gte, or, isNull } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";
import { roleIsAtLeast } from "@/lib/permissions";
import { getPayeeForCompany } from "./payee-service";
import { ApiError } from "@/lib/api/error";

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
  /** Contraparte (payee) a la que se le paga. Opcional: los gastos casuales no la tienen. */
  payeeId?: string;
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

export async function createOperatingExpense(input: CreateExpenseInput) {
  // La contraparte es un dato de la empresa: se valida aquí, en el servicio,
  // y no confiando en el cliente. Un payee de otra empresa no existe para
  // este tenant — se rechaza sin revelar por qué (sin leak de datos).
  if (input.payeeId) {
    const payee = await getPayeeForCompany(input.companyId, input.payeeId);
    if (!payee) {
      throw ApiError.badRequest(
        "La contraparte seleccionada no existe para esta empresa. Recarga el catálogo e inténtalo de nuevo.",
      );
    }
  }

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
      payeeId: input.payeeId || null,
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

/**
 * Rechaza un gasto pendiente.
 *
 * Exige la misma autoridad que aprobar: negar el pago es una decisión de la
 * cadena de autorización, no un atajo para saltársela. El motivo es obligatorio
 * y queda en `approvalNotes`, de donde lo lee la bitácora de Control Interno.
 *
 * REJECTED es terminal — el enum no ofrece retorno a PENDING_APPROVAL; para
 * corregir un gasto rechazado se registra uno nuevo.
 */
export async function rejectOperatingExpense(
  expenseId: string,
  companyId: string,
  approverId: string,
  approverRole: string,
  reason: string
) {
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new Error("El motivo del rechazo es obligatorio.");
  }

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
    throw new Error(`No se puede rechazar un gasto en estado "${expense.status}".`);
  }

  const rule = await findAuthorizationRule(companyId, expense.amount);
  const requiredRole = rule?.approverRole ?? "OWNER";

  if (!roleIsAtLeast(approverRole, requiredRole)) {
    throw new Error(
      `No tienes el nivel de autorización necesario. Este gasto requiere resolución de ${requiredRole} (tu rol: ${approverRole}).`
    );
  }

  const [updated] = await db
    .update(operatingExpenses)
    .set({
      status: "REJECTED",
      approvedBy: approverId,
      approvalNotes: `Rechazado: ${trimmedReason}`,
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

/**
 * Marca un gasto como pagado.
 *
 * Registra **el estado del gasto, no el movimiento bancario**: Pulso no se
 * conecta al banco y esta función no concilia nada. Es la diferencia entre "ya
 * lo pagué" (lo que la dueña sabe) y "el banco lo confirmó" (lo que nadie aquí
 * puede afirmar). La pantalla que la invoca lo dice en voz alta.
 *
 * Sólo se paga lo aprobado: un gasto en PENDING_APPROVAL que se marca pagado
 * saltaría la cadena de autorización por la puerta de atrás.
 */
export async function markPaidOperatingExpense(
  expenseId: string,
  companyId: string,
  actorName: string,
  paidAt?: Date
) {
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

  // Idempotente: volver a marcar un gasto ya pagado no es un error del usuario
  // —dos clics, o dos personas a la vez— pero tampoco debe reescribir la fecha
  // de pago original.
  if (expense.status === "PAID") {
    return expense;
  }

  if (expense.status !== "APPROVED") {
    throw new Error(
      `Sólo se puede pagar un gasto aprobado. Este está en estado "${expense.status}".`
    );
  }

  const [updated] = await db
    .update(operatingExpenses)
    .set({
      status: "PAID",
      paidAt: paidAt ?? new Date(),
      // Misma bitácora que approve/reject: quién y qué, en el mismo campo que
      // lee Control Interno. No se toca `approvedBy` — sobrescribirlo borraría
      // quién autorizó el gasto, que es justo lo que la bitácora existe para
      // conservar. `operating_expenses` no tiene columna `paid_by`.
      approvalNotes: `${expense.approvalNotes ? `${expense.approvalNotes} · ` : ""}Pagado por ${actorName}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operatingExpenses.id, expenseId),
        eq(operatingExpenses.companyId, companyId),
        // Cerrojo optimista: si otra sesión lo pagó entre la lectura y esta
        // escritura, el UPDATE no toca ninguna fila en vez de pisar su fecha.
        eq(operatingExpenses.status, "APPROVED")
      )
    )
    .returning();

  return updated ?? expense;
}

/**
 * Reprograma la fecha de vencimiento de un gasto.
 *
 * Mover un vencimiento es una decisión real de tesorería —se negoció con el
 * proveedor, o simplemente no alcanza— y la proyección la refleja de inmediato.
 * Lo que no se puede es mover al pasado: eso no reprograma nada, sólo maquilla
 * un vencido para que deje de aparecer como tal.
 */
export async function rescheduleOperatingExpense(
  expenseId: string,
  companyId: string,
  actorName: string,
  newDueDate: string,
  today: string
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDueDate)) {
    throw new Error("La fecha debe venir como YYYY-MM-DD.");
  }

  if (newDueDate < today) {
    throw new Error("La nueva fecha no puede ser anterior a hoy.");
  }

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

  if (expense.status === "PAID") {
    throw new Error("Un gasto ya pagado no se puede reprogramar.");
  }

  if (expense.status === "REJECTED") {
    throw new Error("Un gasto rechazado no se puede reprogramar.");
  }

  const [updated] = await db
    .update(operatingExpenses)
    .set({
      dueDate: newDueDate,
      approvalNotes: `${expense.approvalNotes ? `${expense.approvalNotes} · ` : ""}Reprogramado de ${expense.dueDate ?? "sin fecha"} a ${newDueDate} por ${actorName}`,
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

/**
 * Cuántos gastos ya resueltos se devuelven. Ocho sucursales con un año de
 * rentas y servicios son miles de filas, y antes se traían y renderizaban
 * todas.
 */
const LIMITE_HISTORIAL = 200;

/** Consulta base. Se ejecuta dos veces con condiciones y cota distintas. */
async function consultarGastos(
  condiciones: ReturnType<typeof eq>[],
  limite?: number
) {
  const requestedUser = db.select({ id: users.id, name: users.name }).from(users).as("reqUser");
  const approvedUser = db.select({ id: users.id, name: users.name }).from(users).as("appUser");

  const consulta = db
    .select({
      id: operatingExpenses.id,
      companyId: operatingExpenses.companyId,
      branchId: operatingExpenses.branchId,
      branchName: branches.name,
      category: operatingExpenses.category,
      amountCents: operatingExpenses.amount,
      description: operatingExpenses.description,
      evidenceUrl: operatingExpenses.evidenceUrl,
      payeeId: operatingExpenses.payeeId,
      payeeName: payees.name,
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
    .leftJoin(payees, eq(operatingExpenses.payeeId, payees.id))
    .where(and(...condiciones))
    .orderBy(desc(operatingExpenses.createdAt));

  return limite === undefined ? consulta : consulta.limit(limite);
}

/**
 * Gastos operativos del inquilino, opcionalmente de una sola sucursal.
 *
 * **La cota es asimétrica a propósito.** Los pendientes se devuelven completos:
 * esto es una cola de autorizaciones y una aprobación que se quedó fuera del
 * `LIMIT` es un gasto que nadie ve. El historial ya resuelto sí se acota, y
 * cuando se corta se declara en `truncated` en vez de callarlo — una lista que
 * esconde filas en silencio es peor que una lista corta que lo admite.
 *
 * `branchId` tiene que venir ya pasado por `enforceBranchScope`: este servicio
 * confía en que el llamador resolvió el alcance, no lo vuelve a decidir.
 */
export async function getOperatingExpenses(
  companyId: string,
  branchId?: string,
  opciones?: { limiteHistorial?: number }
) {
  const limiteHistorial = opciones?.limiteHistorial ?? LIMITE_HISTORIAL;

  const base = [eq(operatingExpenses.companyId, companyId)];
  if (branchId) {
    base.push(eq(operatingExpenses.branchId, branchId));
  }

  // Se pide uno de más para saber si hubo corte sin un COUNT aparte.
  const [pendientes, historial] = await Promise.all([
    consultarGastos([...base, eq(operatingExpenses.status, "PENDING_APPROVAL")]),
    consultarGastos(
      [...base, ne(operatingExpenses.status, "PENDING_APPROVAL")],
      limiteHistorial + 1
    ),
  ]);

  const truncated = historial.length > limiteHistorial;
  const historialAcotado = truncated ? historial.slice(0, limiteHistorial) : historial;

  // Se reordena el conjunto: la pantalla puede mostrar "todos los estatus" y
  // dos bloques concatenados se leerían como dos tablas pegadas.
  const expenses = [...pendientes, ...historialAcotado].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Enrich each expense with its required approver role from the rules table
  const rules = await db
    .select()
    .from(expenseAuthorizationRules)
    .where(eq(expenseAuthorizationRules.companyId, companyId));

  const items = expenses.map((expense) => {
    const matchingRule = rules.find(
      (r) => expense.amountCents >= r.minAmount && (r.maxAmount === null || expense.amountCents <= r.maxAmount)
    );
    return {
      ...expense,
      requiredApproverRole: matchingRule?.approverRole ?? null,
    };
  });

  return { items, truncated };
}
