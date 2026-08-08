// Arqueo de caja fuera de tolerancia → evento de dominio + aviso.
//
// Hasta ahora el arqueo se persistía (`daily_sales_cuts.cash_counted_cents`) y
// se pintaba en rojo en la tabla de /dashboard/sales, y ahí terminaba: no
// emitía evento, no avisaba a nadie y no escalaba. Detectar un faltante de
// efectivo y no decírselo a nadie es media función.
//
// El diseño (M8/M11) pide que una discrepancia se marque para revisión y
// escale como cualquier tarea vencida. Este servicio cubre el primer tramo:
// deja rastro en el ledger de eventos y notifica a quien puede actuar.
//
// Lo que NO hace todavía, y por qué: no abre un incidente formal.
// `incidents.instance_id` es NOT NULL y referencia una instancia de workflow
// (`schema.ts:231`), y dos de los tres puntos de captura de cortes —el alta
// manual por API y la ingesta del archivo POS— no nacen de un workflow. Abrir
// incidentes desde eventos que no son de workflow requiere relajar esa
// columna, que es un cambio con radio de impacto en todo el módulo de
// incidentes y merece su propia decisión.

import { db } from "@/lib/db";
import { branches, users } from "@/lib/db/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import { emitDomainEvent } from "@/lib/services/domain-event-service";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";
import { computeCashVariance } from "@/lib/sales/cash-variance";

/**
 * Tolerancia del arqueo. Se avisa cuando la diferencia supera AMBOS pisos:
 * un porcentaje del efectivo declarado y un monto absoluto.
 *
 * El piso absoluto evita que un turno de $300 en efectivo dispare una alerta
 * por $6 de redondeo; el porcentual evita que un faltante proporcionalmente
 * grave pase inadvertido en una sucursal de mucho volumen.
 *
 * Son constantes de módulo a propósito: convertirlas en configuración del
 * tenant es deseable, pero pertenece al mismo trabajo que expuso los objetivos
 * de food/labor cost en `tenant_operating_config`.
 */
const VARIANCE_TOLERANCE_PERCENT = 1;
const VARIANCE_TOLERANCE_CENTS = 5000; // $50 MXN

/** Roles que reciben el aviso a nivel grupo. */
const GROUP_ALERT_ROLES = ["OWNER", "ADMIN"] as const;
/** Roles que lo reciben acotados a la sucursal del corte. */
const BRANCH_ALERT_ROLES = ["GERENTE", "SUPERVISOR"] as const;

export interface CashVarianceCheckInput {
  id: string;
  companyId: string;
  branchId: string;
  businessDate: string;
  shift: string;
  cashSales: number | null;
  cashCountedCents: number | null;
}

export interface CashVarianceCheckResult {
  alerted: boolean;
  reason?: "within-tolerance" | "not-comparable";
  varianceCents?: number;
  notified?: number;
}

const pesos = (cents: number) => (Math.abs(cents) / 100).toFixed(2);

/**
 * Evalúa el arqueo de un corte recién registrado y, si la diferencia supera la
 * tolerancia, emite `CashVarianceDetected` y avisa a dirección y a la gerencia
 * de la sucursal.
 *
 * Pensado para llamarse fire-and-forget desde los puntos de captura: un fallo
 * aquí no debe tumbar el alta del corte, que es el dato primario.
 */
export async function checkCashVarianceAndAlert(
  cut: CashVarianceCheckInput,
): Promise<CashVarianceCheckResult> {
  const arqueo = computeCashVariance(cut);

  // Sin los dos lados de la comparación no hay diferencia que reportar.
  if (arqueo === null) return { alerted: false, reason: "not-comparable" };
  if (arqueo.direction === "cuadrado") {
    return { alerted: false, reason: "within-tolerance", varianceCents: 0 };
  }

  const declaredCents = cut.cashSales ?? 0;
  const absVariance = Math.abs(arqueo.varianceCents);
  const variancePercent =
    declaredCents > 0 ? Number(((absVariance / declaredCents) * 100).toFixed(1)) : 100;

  const exceedsTolerance =
    absVariance >= VARIANCE_TOLERANCE_CENTS && variancePercent >= VARIANCE_TOLERANCE_PERCENT;

  if (!exceedsTolerance) {
    return { alerted: false, reason: "within-tolerance", varianceCents: arqueo.varianceCents };
  }

  const [branch] = await db
    .select({ name: branches.name })
    .from(branches)
    .where(eq(branches.id, cut.branchId))
    .limit(1);

  const branchName = branch?.name ?? "la sucursal";

  // 1. Rastro en el ledger inmutable. Va primero: aunque la notificación falle,
  //    el hecho queda registrado y disponible para el twin y las proyecciones.
  await emitDomainEvent({
    companyId: cut.companyId,
    branchId: cut.branchId,
    eventType: "CashVarianceDetected",
    payload: {
      cutId: cut.id,
      businessDate: cut.businessDate,
      shift: cut.shift,
      declaredCents,
      countedCents: cut.cashCountedCents,
      varianceCents: arqueo.varianceCents,
      variancePercent,
      direction: arqueo.direction,
    },
  });

  // 2. Destinatarios: dirección del grupo + gerencia de esa sucursal.
  const recipients = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.companyId, cut.companyId),
        eq(users.active, true),
        or(
          inArray(users.role, [...GROUP_ALERT_ROLES]),
          and(inArray(users.role, [...BRANCH_ALERT_ROLES]), eq(users.branchId, cut.branchId)),
        ),
      ),
    );

  // Un faltante es dinero que no está; un sobrante suele ser error de captura
  // o de cobro. Ambos se avisan, con distinto tono.
  const isFaltante = arqueo.direction === "faltante";
  const title = isFaltante
    ? "💵 Faltante en arqueo de caja"
    : "💵 Sobrante en arqueo de caja";

  const message =
    `${branchName} · corte del ${cut.businessDate} (${cut.shift.toLowerCase()}): ` +
    `${arqueo.direction} de $${pesos(arqueo.varianceCents)} MXN (${variancePercent}%). ` +
    `Declarado $${pesos(declaredCents)} contra $${pesos(cut.cashCountedCents ?? 0)} contados.`;

  let notified = 0;
  for (const recipient of recipients) {
    try {
      await NotificationDispatcher.sendNotification({
        userId: recipient.id,
        title,
        message,
        type: isFaltante ? "warning" : "info",
        eventType: "cash_variance_detected",
        actionUrl: `/dashboard/sales?branchId=${cut.branchId}`,
        actionLabel: "Ver corte",
        metadata: {
          cutId: cut.id,
          branchName,
          branchId: cut.branchId,
          businessDate: cut.businessDate,
          shift: cut.shift,
          declaredAmount: pesos(declaredCents),
          countedAmount: pesos(cut.cashCountedCents ?? 0),
          varianceAmount: pesos(arqueo.varianceCents),
          variancePercent,
          direction: arqueo.direction,
        },
      });
      notified++;
    } catch (err) {
      console.warn(
        `[CashVarianceAlert] Falló el aviso del corte ${cut.id} → ${recipient.id}:`,
        err,
      );
    }
  }

  return { alerted: true, varianceCents: arqueo.varianceCents, notified };
}

/**
 * Envoltura fire-and-forget para los puntos de captura: registra el fallo y
 * nunca lo propaga, porque el alta del corte no debe depender de que la alerta
 * salga.
 */
export function checkCashVarianceAndAlertSafe(cut: CashVarianceCheckInput): void {
  void checkCashVarianceAndAlert(cut).catch((err) => {
    console.error(`[CashVarianceAlert] Error al evaluar el arqueo del corte ${cut.id}:`, err);
  });
}
