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
import { roleIsAtLeast, type Role } from "@/lib/permissions";
import { getPayeeForCompany } from "./payee-service";
import { ApiError } from "@/lib/api/error";
import { isBranchScopedRole, type BranchScope } from "@/lib/branch-scope";
import { denyExpenseResolution } from "@/lib/expenses/approval-policy";

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
async function findApprovers(
  companyId: string,
  branchId: string,
  requiredRole: string,
  requestedBy: string
): Promise<Array<{ id: string; role: string }>> {
  const candidatos = await db
    .select({ id: users.id, role: users.role, branchId: users.branchId })
    .from(users)
    .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)));

  return candidatos
    .filter((u) => u.role && roleIsAtLeast(u.role, requiredRole))
    .filter((u) => !isBranchScopedRole(u.role as Role) || u.branchId === branchId)
    .filter((u) => u.id !== requestedBy)
    .map((u) => ({ id: u.id, role: u.role as string }));
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

  return expense;
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
  const rule = await findAuthorizationRule(companyId, expense.amount);
  const requiredRole = rule?.approverRole ?? "OWNER";

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
  const rule = await findAuthorizationRule(companyId, expense.amount);
  const requiredRole = rule?.approverRole ?? "OWNER";

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
