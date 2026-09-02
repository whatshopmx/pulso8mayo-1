// M16 / T37-T38: Operating Expense & Authorization Service
// Manages recurring/operating expenses (rent, utilities, maintenance) and amount-based approvals.

import { db } from "@/lib/db";
import {
  operatingExpenses,
  expenseAuthorizationRules,
  users,
  branches,
  payees,
  costCenters,
} from "@/lib/db/schema";
import { eq, ne, and, desc, lte, gte, or, isNull, inArray, type SQL } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";
import { roleIsAtLeast, type Role } from "@/lib/permissions";
import { getPayeeForCompany } from "./payee-service";
import { ApiError } from "@/lib/api/error";
import { isBranchScopedRole, type BranchScope } from "@/lib/branch-scope";
import type { expensePaymentMethodEnum } from "@/lib/db/schema";

/** Formas de pago que admite un gasto operativo (A4.1). */
export type ExpensePaymentMethod = typeof expensePaymentMethodEnum.enumValues[number];

/**
 * Umbral de deducibilidad del pago en efectivo (LISR art. 27-III).
 *
 * El artículo condiciona la deducción de un pago mayor a $2,000 MXN a que se
 * haga por transferencia, cheque nominativo, tarjeta o monedero electrónico.
 * Es configurable en el sentido de que vive aquí y no repartido por el código:
 * si la cifra cambia en una reforma, se cambia en un lugar.
 */
export const UMBRAL_EFECTIVO_DEDUCIBLE_CENTS = 200_000;
import { denyExpenseResolution, rolExigidoPorMonto } from "@/lib/expenses/approval-policy";
import { getTenantOperatingConfig } from "./tenant-config-service";
import { checkBudgetAvailability } from "./budget-service";
import { emitDomainEvent } from "./domain-event-service";

/**
 * ¿Puede este alcance resolver un gasto de esta sucursal?
 *
 * Aprobar y rechazar sólo se acotaban por `companyId`. Un GERENTE fijado a
 * Condesa no *veía* los gastos de Polanco en la lista, pero con el `expenseId`
 * en la mano los resolvía igual por API: el filtro de sucursal estaba en la
 * lectura y no en la escritura, que es donde se decide el dinero.
 *
 * `NONE` niega en vez de dejar pasar. Es el caso para el que existe
 * `resolveBranchScope`: un rol acotado a sucursal que no tiene ninguna asignada
 * no debe caer en el mismo `null` que significa "ve toda la empresa", porque
 * fallar abierto aquí es poder firmar cualquier gasto.
 */
function assertScopeCoversBranch(scope: BranchScope, expenseBranchId: string | null) {
  if (scope.kind === "ALL") return;

  if (scope.kind === "NONE") {
    throw ApiError.forbidden(
      "Tu usuario no tiene una sucursal asignada, así que no puede resolver gastos. Pide que te asignen una."
    );
  }

  if (expenseBranchId !== scope.branchId) {
    throw ApiError.forbidden("No puedes resolver un gasto de otra sucursal.");
  }
}

/**
 * Valor del filtro "sin centro de costo" en el listado. Es un centinela y no un
 * uuid a propósito: `costCenterId=` vacío en el query string no distingue "no
 * filtres" de "los que no tienen".
 */
export const SIN_CENTRO_DE_COSTO = "SIN_CENTRO";

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
  /**
   * Partida presupuestal. Opcional por la misma razón que `payeeId`; un gasto
   * sin ella no consume presupuesto y no dispara aviso (F3.1/F3.2).
   */
  costCenterId?: string;
  requestedBy: string;
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
 * Quiénes pueden aprobar de verdad un gasto, para poder avisarles.
 *
 * `createOperatingExpense` notificaba con `userId: input.companyId` — que no es
 * un id de usuario. `getUserPreferences` no lo encontraba, registraba
 * "No preferences found" y **retornaba sin enviar nada**: ningún aprobador se
 * enteraba jamás de un gasto pendiente, y la cola de autorizaciones dependía de
 * que alguien recordara abrir la pantalla.
 *
 * Se resuelve el conjunto que *puede actuar*: cualquiera cuyo rol alcance el
 * exigido por la regla (`roleIsAtLeast`, el mismo criterio que usa
 * `approveOperatingExpense`). Los roles acotados a sucursal se filtran por la
 * del gasto — desde A4 no pueden aprobar la de otra, así que avisarles sería
 * ruido que además invita a intentar algo que va a dar 403.
 *
 * Por el mismo motivo se excluye a `requestedBy`: desde A16 quien registra un
 * gasto no lo resuelve, y un aviso de "pendiente de tu aprobación" que lleva a
 * una fila sin botón sólo enseña a ignorar los avisos.
 */
type CandidatoAprobador = { id: string; role: string | null; branchId: string | null };

/** Todos los usuarios vivos de la empresa. Se consulta una vez y se filtra en memoria. */
async function candidatosAprobadores(companyId: string): Promise<CandidatoAprobador[]> {
  return db
    .select({ id: users.id, role: users.role, branchId: users.branchId })
    .from(users)
    .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)));
}

/** El filtro, sin base de datos, para poder aplicarlo a muchos gastos de una sola consulta. */
function elegiblesPara(
  candidatos: CandidatoAprobador[],
  branchId: string | null,
  requiredRole: string,
  requestedBy: string | null
): Array<{ id: string; role: string }> {
  return candidatos
    .filter((u) => u.role && roleIsAtLeast(u.role, requiredRole))
    .filter((u) => !isBranchScopedRole(u.role as Role) || u.branchId === branchId)
    .filter((u) => {
      if (u.role === "SUPER_ADMIN" || u.role === "OWNER") return true;
      return u.id !== requestedBy;
    })
    .map((u) => ({ id: u.id, role: u.role as string }));
}

async function findApprovers(
  companyId: string,
  branchId: string,
  requiredRole: string,
  requestedBy: string
): Promise<Array<{ id: string; role: string }>> {
  return elegiblesPara(
    await candidatosAprobadores(companyId),
    branchId,
    requiredRole,
    requestedBy
  );
}

/**
 * El rol que hace falta para resolver un gasto de este monto.
 *
 * Dos fuentes, en orden: la regla explícita de `expense_authorization_rules`
 * —que un administrador escribió a mano y por tanto manda— y, si ninguna la
 * cubre, la escalera derivada de los umbrales de la empresa.
 *
 * Antes el respaldo era la constante `"OWNER"`, y con la segregación de A16
 * encima eso dejaba atascada a toda empresa sin reglas sembradas: los gerentes
 * no alcanzaban el rol y el dueño no podía firmar lo suyo. Ver
 * `rolExigidoPorMonto`.
 */
async function resolverRolExigido(
  companyId: string,
  amountCents: number
): Promise<{ rol: string; regla: Awaited<ReturnType<typeof findAuthorizationRule>> }> {
  const regla = await findAuthorizationRule(companyId, amountCents);
  if (regla) return { rol: regla.approverRole, regla };

  const config = await getTenantOperatingConfig(companyId);
  return {
    rol: rolExigidoPorMonto(amountCents, {
      managerAuthLimitCents: config.managerAuthLimitCents,
      doubleApprovalThresholdCents: config.doubleApprovalThresholdCents,
    }),
    regla: null,
  };
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

  // El centro de costo también es un dato de la empresa: uno de otro tenant no
  // existe aquí, y aceptarlo sin comprobar dejaría el gasto consumiendo un
  // presupuesto ajeno. Mismo criterio que la contraparte, arriba.
  if (input.costCenterId) {
    const [cc] = await db
      .select({ id: costCenters.id })
      .from(costCenters)
      .where(
        and(
          eq(costCenters.id, input.costCenterId),
          eq(costCenters.companyId, input.companyId),
          eq(costCenters.active, true)
        )
      )
      .limit(1);
    if (!cc) {
      throw ApiError.badRequest(
        "El centro de costo seleccionado no existe o está inactivo para esta empresa. Recarga el catálogo e inténtalo de nuevo.",
      );
    }
  }

  const { rol: requiredApproverRole } = await resolverRolExigido(
    input.companyId,
    input.amountCents
  );

  // A16 — **Todo gasto nace pendiente.** Antes se auto-aprobaba aquí cuando el
  // rol de quien registraba alcanzaba el exigido por la regla, y quedaba escrito
  // en `approvalNotes`. Eso vacíaba la segregación de funciones que la pantalla
  // afirmaba tener: el dueño que captura su propia renta la aprobaba con el
  // mismo clic, sin que nadie más la mirara. Decidido con David (2026-08-21):
  // gana la segregación. Quien registra no resuelve — la regla vive en
  // `lib/expenses/approval-policy.ts` y la comparte la UI.
  const initialStatus = "PENDING_APPROVAL" as const;

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
      costCenterId: input.costCenterId || null,
      status: initialStatus,
      requestedBy: input.requestedBy,
      dueDate: input.dueDate || null,
    })
    .returning();

  // Notificar a quienes pueden resolverlo. Ya no hay rama alterna: desde A16
  // todo gasto entra a la cola, así que este aviso es el único camino por el
  // que alguien se entera.
  try {
    const aprobadores = await findApprovers(
      input.companyId,
      input.branchId,
      requiredApproverRole,
      input.requestedBy
    );

    if (aprobadores.length === 0) {
      // Sin nadie que pueda aprobarlo, el gasto queda en una cola que no
      // tiene dueño. Se dice en voz alta en vez de fallar en silencio, que
      // es exactamente como este hueco pasó desapercibido.
      console.warn(
        `[Expense Service] Gasto ${expense.id} quedó PENDING_APPROVAL y no hay ningún usuario ` +
          `distinto de quien lo registró con rol >= ${requiredApproverRole} en la empresa ` +
          `${input.companyId} (sucursal ${input.branchId}). Nadie recibirá la notificación.`
      );
    }

    await NotificationDispatcher.sendBatchNotifications(
      aprobadores.map((aprobador) => ({
        userId: aprobador.id,
        title: "📑 Gasto Pendiente de Aprobación",
        message: `Nuevo gasto de ${input.category} por $${(input.amountCents / 100).toLocaleString("es-MX")} MXN requiere aprobación de ${requiredApproverRole}.`,
        type: "info" as const,
        // Plantilla propia, no la de turnos: `shift_approval_request` habla de
        // "Solicitud de Aprobación de Turno" y pide `{employeeName}` /
        // `{approvalType}`, que un gasto no tiene — el aviso llegaba con el
        // encabezado equivocado y los marcadores sin sustituir.
        eventType: "expense_approval_request" as const,
        // El despachador arma título y mensaje desde la plantilla, así que las
        // variables viajan aquí; `title`/`message` de arriba sólo aplican si
        // alguien manda por el camino directo.
        metadata: {
          categoria: input.category,
          monto: `$${(input.amountCents / 100).toLocaleString("es-MX")} MXN`,
          concepto: input.description,
          rolRequerido: requiredApproverRole,
        },
        // `?focus=`, no `?id=`: es el parámetro que la pantalla de Gastos
        // sabe resaltar. Con `?id=` el enlace llevaba a la lista sin señalar
        // cuál de las filas era la del aviso.
        actionUrl: `/dashboard/finance/expenses?focus=${expense.id}`,
        actionLabel: "Revisar Gasto",
      }))
    );
  } catch (err) {
    console.warn("[Expense Service] Approval notification warning:", err);
  }

  // Consumo de presupuesto (F3.2). Fire-and-forget: avisa, no bloquea.
  checkExpenseBudgetAndAlertSafe({
    id: expense.id,
    companyId: expense.companyId,
    branchId: expense.branchId,
    costCenterId: expense.costCenterId,
    amountCents: expense.amount,
    description: expense.description,
    createdAt: expense.createdAt,
  });

  return expense;
}

// ---------------------------------------------------------------------------
// F3.2 — Consumo de presupuesto al registrar un gasto
// ---------------------------------------------------------------------------

/** Umbral de aviso temprano: 80% del presupuesto del mes consumido. */
const BUDGET_WARN_RATIO = 0.8;

/** Roles que reciben el aviso a nivel grupo. */
const BUDGET_GROUP_ROLES = ["SUPER_ADMIN", "OWNER", "ADMIN"] as const;
/** Rol que lo recibe acotado a la sucursal del gasto. */
const BUDGET_BRANCH_ROLES = ["GERENTE"] as const;

export type BudgetAlertLevel = "WARNING" | "ALERT";

export interface BudgetAlertResult {
  alerted: boolean;
  level?: BudgetAlertLevel;
  reason?:
    | "sin-centro-de-costo"
    | "sin-presupuesto"
    | "sin-cruce-de-umbral";
  consumedPercent?: number;
  notified?: number;
}

/** Mes contable del gasto, en la MISMA base que `budget-service`. */
function mesDelGasto(createdAt: Date): string {
  // `to_char(created_at, 'YYYY-MM')` sobre un `timestamp` sin zona devuelve el
  // mes tal como se guardó; `toISOString()` lee ese mismo instante en UTC. Es
  // la expresión que ya usa `service-order-service.monthOf` — reinventarla aquí
  // sería tener dos definiciones de "el mes" sobre el mismo presupuesto.
  return createdAt.toISOString().slice(0, 7);
}

const pesosDe = (cents: number) => `$${(cents / 100).toLocaleString("es-MX", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})} MXN`;

/**
 * Evalúa el consumo del presupuesto del mes tras registrar un gasto y avisa
 * cuando cruza un umbral.
 *
 * **No bloquea nada.** El gasto ya ocurrió —la luz se consumió, el plomero
 * vino— y negarlo sólo lo sacaría del sistema, que es exactamente el resultado
 * que este módulo existe para evitar. Se avisa, no se impide.
 *
 * **Sólo al cruzar.** Se notifica cuando *este* gasto es el que empuja el
 * consumo por encima del 80% (WARNING) o del 100% (ALERT); los siguientes del
 * mismo mes ya no repiten el aviso. Sin esta condición, el vigésimo gasto de un
 * mes apretado mandaría el vigésimo correo idéntico y la gente aprendería a
 * ignorarlos. No hace falta estado extra: el consumo previo es el actual menos
 * el monto del gasto recién insertado.
 */
export async function checkExpenseBudgetAndAlert(gasto: {
  id: string;
  companyId: string;
  branchId: string;
  costCenterId: string | null;
  amountCents: number;
  description: string;
  createdAt: Date;
}): Promise<BudgetAlertResult> {
  // Un gasto sin partida no consume presupuesto: se cuenta aparte, en el
  // renglón "sin clasificar" del tablero.
  if (!gasto.costCenterId) return { alerted: false, reason: "sin-centro-de-costo" };

  const month = mesDelGasto(gasto.createdAt);

  // La MISMA función que valida OC y OS, para que el presupuesto signifique lo
  // mismo en los tres flujos. Se pide con `0`: el gasto ya está insertado y por
  // tanto ya viene dentro de `committed`; preguntar por su propio monto lo
  // contaría dos veces.
  const estado = await checkBudgetAvailability(gasto.branchId, gasto.costCenterId, month, 0);

  // Sin partida presupuestada para (sucursal, centro, mes) no hay contra qué
  // medir. Inventar una alerta aquí enseñaría a desconfiar de todas.
  if (estado.budgeted <= 0) return { alerted: false, reason: "sin-presupuesto" };

  const consumidoDespues = estado.committed;
  const consumidoAntes = Math.max(0, consumidoDespues - gasto.amountCents);
  const razonDespues = consumidoDespues / estado.budgeted;
  const razonAntes = consumidoAntes / estado.budgeted;

  let level: BudgetAlertLevel | null = null;
  if (razonDespues >= 1 && razonAntes < 1) level = "ALERT";
  else if (razonDespues >= BUDGET_WARN_RATIO && razonAntes < BUDGET_WARN_RATIO) level = "WARNING";

  const consumedPercent = Math.round(razonDespues * 1000) / 10;

  if (!level) return { alerted: false, reason: "sin-cruce-de-umbral", consumedPercent };

  const excedente = Math.max(0, consumidoDespues - estado.budgeted);

  const [contexto] = await db
    .select({ branchName: branches.name, costCenterName: costCenters.name, costCenterCode: costCenters.code })
    .from(branches)
    .leftJoin(costCenters, eq(costCenters.id, gasto.costCenterId))
    .where(eq(branches.id, gasto.branchId))
    .limit(1);

  const branchName = contexto?.branchName ?? "la sucursal";
  const costCenterName = contexto?.costCenterCode
    ? `${contexto.costCenterCode} · ${contexto.costCenterName}`
    : "la partida";

  // Rastro en el ledger antes que el aviso: aunque la notificación se caiga, el
  // sobregiro queda registrado y disponible para el cierre y el twin.
  if (level === "ALERT") {
    try {
      await emitDomainEvent({
        companyId: gasto.companyId,
        branchId: gasto.branchId,
        eventType: "BUDGET_EXCEEDED",
        payload: {
          expenseId: gasto.id,
          costCenterId: gasto.costCenterId,
          month,
          budgetedCents: estado.budgeted,
          consumedCents: consumidoDespues,
          overByCents: excedente,
          consumedPercent,
        },
      });
    } catch (err) {
      console.warn(`[Expense Service] No se pudo emitir BUDGET_EXCEEDED del gasto ${gasto.id}:`, err);
    }
  }

  const destinatarios = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.companyId, gasto.companyId),
        eq(users.active, true),
        isNull(users.deletedAt),
        or(
          inArray(users.role, [...BUDGET_GROUP_ROLES]),
          and(inArray(users.role, [...BUDGET_BRANCH_ROLES]), eq(users.branchId, gasto.branchId)),
        ),
      ),
    );

  const detalle =
    level === "ALERT"
      ? `Excedido por ${pesosDe(excedente)}.`
      : "Todavía cabe, pero queda poco margen para el resto del mes.";

  await NotificationDispatcher.sendBatchNotifications(
    destinatarios.map((d) => ({
      userId: d.id,
      title: level === "ALERT" ? "📊 Presupuesto excedido" : "📊 Presupuesto cerca del límite",
      message: `${branchName} · ${costCenterName} · ${month}: ${consumedPercent}% consumido.`,
      type: level === "ALERT" ? ("error" as const) : ("warning" as const),
      eventType: "budget_threshold_reached" as const,
      metadata: {
        nivel: level === "ALERT" ? "excedido" : "cerca del límite",
        branchName,
        costCenterName,
        month,
        budgetAmount: pesosDe(estado.budgeted),
        consumedAmount: pesosDe(consumidoDespues),
        consumedPercent,
        detalle,
        concepto: gasto.description,
        expenseAmount: pesosDe(gasto.amountCents),
      },
      actionUrl: `/dashboard/finance/expenses?costCenterId=${gasto.costCenterId}`,
      actionLabel: "Ver gastos de la partida",
    })),
  );

  return { alerted: true, level, consumedPercent, notified: destinatarios.length };
}

/**
 * Envoltura fire-and-forget para la creación del gasto: el mismo patrón que
 * `checkCashVarianceAndAlertSafe`. Que el aviso de presupuesto falle no puede
 * tumbar el alta del gasto, que es el dato primario.
 */
export function checkExpenseBudgetAndAlertSafe(gasto: Parameters<typeof checkExpenseBudgetAndAlert>[0]): void {
  void checkExpenseBudgetAndAlert(gasto).catch((err) => {
    console.error(`[Expense Service] Error al evaluar el presupuesto del gasto ${gasto.id}:`, err);
  });
}

export async function approveOperatingExpense(
  expenseId: string,
  companyId: string,
  scope: BranchScope,
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
    throw ApiError.notFound("El gasto especificado no fue encontrado.");
  }

  // Antes que el estado y antes que el rol: de un gasto fuera de tu alcance no
  // se responde ni siquiera en qué estado está.
  assertScopeCoversBranch(scope, expense.branchId);

  if (expense.status !== "PENDING_APPROVAL") {
    throw ApiError.badRequest(
      `No se puede aprobar un gasto en estado "${expense.status}".`
    );
  }

  // A16 — La misma regla que evalúa la pantalla (`lib/expenses/approval-policy.ts`).
  // El carve-out anterior sólo prohibía la auto-aprobación cuando la regla tenía
  // umbral (`minAmount > 0`), así que el tramo más bajo —donde vive la mayoría de
  // los gastos— se firmaba solo. La segregación de funciones no admite tramos.
  const { rol: requiredRole } = await resolverRolExigido(companyId, expense.amount);

  const denegado = denyExpenseResolution({
    actorRole: approverRole,
    actorId: approverId,
    requiredApproverRole: requiredRole,
    requestedBy: expense.requestedBy,
  });

  if (denegado === "ROLE") {
    throw ApiError.forbidden(
      `No tienes el nivel de autorización necesario. Este gasto requiere aprobación de ${requiredRole} (tu rol: ${approverRole}).`
    );
  }

  if (denegado === "SELF") {
    throw ApiError.forbidden(
      "Segregación de funciones: quien registra un gasto no puede aprobarlo. Pídeselo a alguien más."
    );
  }

  // El `WHERE` repite el alcance y exige el estado: el `SELECT` de arriba da
  // buenos mensajes, pero entre leer y escribir hay una ventana y dos
  // aprobaciones simultáneas la pasaban las dos — la segunda pisaba
  // `approved_by` y `approval_notes`, y la bitácora terminaba nombrando a quien
  // llegó tarde. Esta condición es la única guarda sin ventana.
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
        eq(operatingExpenses.companyId, companyId),
        eq(operatingExpenses.status, "PENDING_APPROVAL"),
        ...(scope.kind === "BRANCH"
          ? [eq(operatingExpenses.branchId, scope.branchId)]
          : [])
      )
    )
    .returning();

  if (!updated) {
    // Perdió la carrera: alguien más lo resolvió entre el SELECT y el UPDATE.
    throw ApiError.badRequest(
      "Este gasto ya fue resuelto por alguien más. Recarga la lista para ver cómo quedó."
    );
  }

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
  scope: BranchScope,
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
    throw ApiError.notFound("El gasto especificado no fue encontrado.");
  }

  // Rechazar es tan definitivo como aprobar: deja el gasto sin pagar y con un
  // motivo firmado por alguien que no responde por esa sucursal.
  assertScopeCoversBranch(scope, expense.branchId);

  if (expense.status !== "PENDING_APPROVAL") {
    throw ApiError.badRequest(
      `No se puede rechazar un gasto en estado "${expense.status}".`
    );
  }

  // Rechazar pasa por la misma regla que aprobar, incluida la auto-resolución:
  // la pantalla esconde los dos botones con la misma condición, y hasta A16 el
  // servidor no comprobaba nada aquí — quien registraba un gasto podía cerrarlo
  // como rechazado y sacarlo de la cola sin que ningún aprobador lo viera.
  const { rol: requiredRole } = await resolverRolExigido(companyId, expense.amount);

  const denegado = denyExpenseResolution({
    actorRole: approverRole,
    actorId: approverId,
    requiredApproverRole: requiredRole,
    requestedBy: expense.requestedBy,
  });

  if (denegado === "ROLE") {
    throw ApiError.forbidden(
      `No tienes el nivel de autorización necesario. Este gasto requiere resolución de ${requiredRole} (tu rol: ${approverRole}).`
    );
  }

  if (denegado === "SELF") {
    throw ApiError.forbidden(
      "Segregación de funciones: quien registra un gasto no puede rechazarlo. Pídeselo a alguien más."
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
        eq(operatingExpenses.companyId, companyId),
        eq(operatingExpenses.status, "PENDING_APPROVAL"),
        ...(scope.kind === "BRANCH"
          ? [eq(operatingExpenses.branchId, scope.branchId)]
          : [])
      )
    )
    .returning();

  if (!updated) {
    throw ApiError.badRequest(
      "Este gasto ya fue resuelto por alguien más. Recarga la lista para ver cómo quedó."
    );
  }

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
  scope: BranchScope,
  /** Quién paga. Sale de la sesión y se escribe en `paid_by` (A4.1). */
  actorId: string,
  /** Con qué se pagó. `null` cuando quien paga no lo declara. */
  paymentMethod: ExpensePaymentMethod | null,
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
    throw ApiError.notFound("El gasto especificado no fue encontrado.");
  }

  // Antes que el estado, igual que en `approveOperatingExpense`: de un gasto
  // fuera de tu alcance no se responde ni siquiera si ya está pagado. Pagar es
  // mover dinero, así que el alcance pesa aquí tanto como al aprobar —A0.1
  // cierra la mitad de la puerta que A16 había dejado abierta.
  assertScopeCoversBranch(scope, expense.branchId);

  // Idempotente: volver a marcar un gasto ya pagado no es un error del usuario
  // —dos clics, o dos personas a la vez— pero tampoco debe reescribir la fecha
  // de pago original.
  if (expense.status === "PAID") {
    return expense;
  }

  if (expense.status !== "APPROVED") {
    throw ApiError.badRequest(
      `Sólo se puede pagar un gasto aprobado. Este está en estado "${expense.status}".`
    );
  }

  const [updated] = await db
    .update(operatingExpenses)
    .set({
      status: "PAID",
      paidAt: paidAt ?? new Date(),
      // A4.1 — quién pagó sale de una llave foránea, no de texto concatenado en
      // `approvalNotes`. Antes se escribía `"… · Pagado por Fulano"` porque la
      // columna no existía, y Control Interno tenía que leer un nombre de una
      // cadena libre para saber quién movió el dinero: un nombre en una nota no
      // se puede unir, no sobrevive a un cambio de nombre y no distingue a dos
      // homónimos.
      //
      // No se toca `approvedBy`: sobrescribirlo borraría quién autorizó el
      // gasto, y la distinción entre quien autoriza y quien paga **es** la
      // segregación de funciones.
      paidBy: actorId,
      ...(paymentMethod ? { paymentMethod } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operatingExpenses.id, expenseId),
        eq(operatingExpenses.companyId, companyId),
        // Cerrojo optimista: si otra sesión lo pagó entre la lectura y esta
        // escritura, el UPDATE no toca ninguna fila en vez de pisar su fecha.
        eq(operatingExpenses.status, "APPROVED"),
        // El alcance se repite en el `WHERE` por la misma razón que en
        // `approveOperatingExpense`: entre el SELECT y el UPDATE hay una
        // ventana, y ésta es la única guarda que no la tiene.
        ...(scope.kind === "BRANCH"
          ? [eq(operatingExpenses.branchId, scope.branchId)]
          : [])
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
  scope: BranchScope,
  actorName: string,
  newDueDate: string,
  today: string
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDueDate)) {
    throw ApiError.badRequest("La fecha debe venir como YYYY-MM-DD.");
  }

  if (newDueDate < today) {
    throw ApiError.badRequest("La nueva fecha no puede ser anterior a hoy.");
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
    throw ApiError.notFound("El gasto especificado no fue encontrado.");
  }

  // Antes que el estado: reprogramar corre el vencimiento de un gasto ajeno y
  // lo saca de la lista de vencidos de otra sucursal.
  assertScopeCoversBranch(scope, expense.branchId);

  if (expense.status === "PAID") {
    throw ApiError.badRequest("Un gasto ya pagado no se puede reprogramar.");
  }

  if (expense.status === "REJECTED") {
    throw ApiError.badRequest("Un gasto rechazado no se puede reprogramar.");
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
        eq(operatingExpenses.companyId, companyId),
        ...(scope.kind === "BRANCH"
          ? [eq(operatingExpenses.branchId, scope.branchId)]
          : [])
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
  condiciones: SQL[],
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
      costCenterId: operatingExpenses.costCenterId,
      costCenterCode: costCenters.code,
      costCenterName: costCenters.name,
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
    .leftJoin(costCenters, eq(operatingExpenses.costCenterId, costCenters.id))
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
  opciones?: { limiteHistorial?: number; payeeId?: string; costCenterId?: string }
) {
  const limiteHistorial = opciones?.limiteHistorial ?? LIMITE_HISTORIAL;

  const base: SQL[] = [eq(operatingExpenses.companyId, companyId)];
  if (branchId) {
    base.push(eq(operatingExpenses.branchId, branchId));
  }
  if (opciones?.payeeId) {
    base.push(eq(operatingExpenses.payeeId, opciones.payeeId));
  }
  // `SIN_CENTRO` es el filtro que importa para la cobertura del presupuesto:
  // sin él, los gastos que nadie clasificó sólo se pueden encontrar leyendo la
  // lista completa a ojo.
  if (opciones?.costCenterId === SIN_CENTRO_DE_COSTO) {
    base.push(isNull(operatingExpenses.costCenterId));
  } else if (opciones?.costCenterId) {
    base.push(eq(operatingExpenses.costCenterId, opciones.costCenterId));
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

  // El rol exigido y quién puede satisfacerlo. Tres consultas fijas para toda la
  // lista —reglas, config y usuarios— en vez de una por gasto.
  const [rules, config, candidatos] = await Promise.all([
    db
      .select()
      .from(expenseAuthorizationRules)
      .where(eq(expenseAuthorizationRules.companyId, companyId)),
    getTenantOperatingConfig(companyId),
    candidatosAprobadores(companyId),
  ]);

  const items = expenses.map((expense) => {
    const matchingRule = rules.find(
      (r) => expense.amountCents >= r.minAmount && (r.maxAmount === null || expense.amountCents <= r.maxAmount)
    );

    // La misma escalera que usa el servicio al crear y al resolver. Antes esto
    // devolvía `null` y la pantalla lo traducía a "OWNER" por su cuenta: dos
    // sitios decidiendo la autoridad sobre el mismo gasto.
    const requiredApproverRole =
      matchingRule?.approverRole ??
      rolExigidoPorMonto(expense.amountCents, {
        managerAuthLimitCents: config.managerAuthLimitCents,
        doubleApprovalThresholdCents: config.doubleApprovalThresholdCents,
      });

    /**
     * Un pendiente que **nadie** puede resolver.
     *
     * No es una hipótesis: con la segregación de A16, si el único usuario cuyo
     * rol alcanza es quien registró el gasto, la fila se queda en la cola para
     * siempre y no entra a Cuentas por Pagar, que sólo lista lo aprobado. El
     * servicio ya lo gritaba por `console.warn` al crear; nadie mira esos logs.
     *
     * Se calcula al leer, no se guarda: si mañana das de alta a un segundo
     * aprobador, el aviso desaparece solo. Guardarlo lo dejaría mintiendo.
     */
    const sinAprobadorPosible =
      expense.status === "PENDING_APPROVAL" &&
      elegiblesPara(
        candidatos,
        expense.branchId ?? null,
        requiredApproverRole,
        expense.requestedBy ?? null
      ).length === 0;

    return { ...expense, requiredApproverRole, sinAprobadorPosible };
  });

  return { items, truncated };
}
