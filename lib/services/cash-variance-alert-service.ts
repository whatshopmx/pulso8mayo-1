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
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
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
  /** Resultado de la evaluación del patrón de faltantes (F3.4), si aplicó. */
  recurringShortage?: RecurringShortageReport;
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

  // 4. Patrón (F3.4). Va después del evento porque se detecta consultándolo, y
  //    dentro de un try propio: el aviso del corte de hoy ya salió y no debe
  //    caerse porque la consulta del patrón falle.
  let recurringShortage: RecurringShortageReport | undefined;
  if (isFaltante) {
    try {
      recurringShortage = await reportRecurringShortage(cut.companyId, cut.branchId, cut.shift);
    } catch (err) {
      console.error(
        `[CashVarianceAlert] Error al evaluar faltantes recurrentes de ${cut.branchId}/${cut.shift}:`,
        err,
      );
    }
  }

  return { alerted: true, varianceCents: arqueo.varianceCents, notified, recurringShortage };
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

// ---------------------------------------------------------------------------
// F3.4 — Faltantes recurrentes
//
// Un faltante de $80 en un turno es ruido. El mismo turno de la misma sucursal
// con faltantes chicos una y otra vez es un patrón, y es el patrón lo que se
// investiga. La detección consulta el ledger de eventos (`CashVarianceDetected`,
// emitido arriba) en vez de recalcular arqueos: el criterio de tolerancia vive
// en un solo lugar y el hallazgo no puede contradecir a la alerta.
//
// **El patrón es por sucursal + turno, no por persona.** `daily_sales_cuts` no
// sabe quién manejó la caja: su único campo de usuario es `received_by`, quien
// subió el corte. Atribuirlo a alguien requiere un campo de cajero en el corte,
// que es otra tarea.
//
// **No se persiste el hallazgo.** Se deriva al consultarlo, como los otros
// cuatro tipos de `control-interno-service`. Persistirlo permitiría marcarlo
// como atendido, y hace falta el día que este hallazgo tenga ciclo de vida
// —alguien lo investiga y lo cierra—, pero eso es una tabla nueva. Mientras
// tanto el hallazgo desaparece solo cuando los faltantes salen de la ventana.
// ---------------------------------------------------------------------------

/**
 * Ventana en **cortes**, no en días. Una sucursal que sólo abre fines de semana
 * acumula 30 cortes en cuatro meses; 30 días naturales le mirarían ocho cortes
 * y el patrón nunca alcanzaría el umbral.
 */
export const RECURRING_SHORTAGE_WINDOW_CUTS = 30;
/** Tres faltantes en la ventana. Dos son casualidad; tres ya es una costumbre. */
export const RECURRING_SHORTAGE_THRESHOLD = 3;

const SHIFT_LABELS: Record<string, string> = {
  MATUTINO: "matutino",
  VESPERTINO: "vespertino",
  COMPLETO: "completo",
};

export function shiftLabel(shift: string): string {
  return SHIFT_LABELS[shift] ?? shift.toLowerCase();
}

export interface RecurringShortageFinding {
  branchId: string;
  branchName: string;
  shift: string;
  /** Cortes con faltante dentro de la ventana. */
  shortageCount: number;
  /** Suma de los faltantes de la ventana, en centavos y en positivo. */
  totalShortageCents: number;
  /** Fecha del corte con faltante más reciente (`YYYY-MM-DD`). */
  lastCutDate: string;
  /** Cortes efectivamente mirados: puede ser menor que 30 si hay menos historia. */
  windowCuts: number;
  /** Fecha del corte más antiguo de la ventana; delimita el hallazgo "abierto". */
  windowStartDate: string;
}

/** `db.execute` devuelve `{ rows }` con el driver serverless y un arreglo con otros. */
function filasDe<T>(result: unknown): T[] {
  const conRows = (result as { rows?: unknown }).rows;
  if (Array.isArray(conRows)) return conRows as T[];
  return Array.isArray(result) ? (result as T[]) : [];
}

/**
 * Patrones de faltante por (sucursal, turno) dentro de la ventana de los
 * últimos `RECURRING_SHORTAGE_WINDOW_CUTS` cortes de cada turno.
 *
 * El `DISTINCT ON (v.id)` importa: un corte corregido y vuelto a evaluar emite
 * un segundo `CashVarianceDetected`, y sin él ese corte contaría dos veces y
 * sumaría su faltante dos veces.
 */
async function consultarPatronesDeFaltante(
  companyId: string,
  filtros: { branchId?: string; shift?: string } = {},
): Promise<RecurringShortageFinding[]> {
  const filtroSucursal: SQL = filtros.branchId
    ? sql`AND c.branch_id = ${filtros.branchId}`
    : sql``;
  const filtroTurno: SQL = filtros.shift ? sql`AND c.shift = ${filtros.shift}` : sql``;

  const resultado = await db.execute(sql`
    WITH cortes AS (
      SELECT c.id, c.branch_id, c.shift, c.business_date,
             row_number() OVER (
               PARTITION BY c.branch_id, c.shift
               ORDER BY c.business_date DESC, c.created_at DESC
             ) AS rn
      FROM daily_sales_cuts c
      WHERE c.company_id = ${companyId}
        ${filtroSucursal}
        ${filtroTurno}
    ),
    ventana AS (
      SELECT * FROM cortes WHERE rn <= ${RECURRING_SHORTAGE_WINDOW_CUTS}
    ),
    limites AS (
      SELECT branch_id, shift,
             count(*)::int AS window_cuts,
             min(business_date) AS window_start
      FROM ventana
      GROUP BY branch_id, shift
    ),
    faltantes AS (
      SELECT DISTINCT ON (v.id)
             v.id, v.branch_id, v.shift, v.business_date,
             abs(coalesce((e.payload->>'varianceCents')::numeric, 0)) AS monto
      FROM ventana v
      JOIN domain_events e
        ON e.event_type = 'CashVarianceDetected'
       AND e.company_id = ${companyId}
       AND e.payload->>'cutId' = v.id::text
       AND e.payload->>'direction' = 'faltante'
      ORDER BY v.id, e.timestamp DESC
    )
    SELECT f.branch_id                     AS "branchId",
           b.name                          AS "branchName",
           f.shift::text                   AS "shift",
           count(*)::int                   AS "shortageCount",
           sum(f.monto)::bigint            AS "totalShortageCents",
           max(f.business_date)::text      AS "lastCutDate",
           l.window_cuts                   AS "windowCuts",
           l.window_start::text            AS "windowStartDate"
    FROM faltantes f
    JOIN branches b ON b.id = f.branch_id
    JOIN limites l ON l.branch_id = f.branch_id AND l.shift = f.shift
    GROUP BY f.branch_id, b.name, f.shift, l.window_cuts, l.window_start
    HAVING count(*) >= ${RECURRING_SHORTAGE_THRESHOLD}
    ORDER BY count(*) DESC, sum(f.monto) DESC
  `);

  return filasDe<Record<string, unknown>>(resultado).map((row) => ({
    branchId: String(row.branchId),
    branchName: String(row.branchName ?? "la sucursal"),
    shift: String(row.shift),
    shortageCount: Number(row.shortageCount),
    // `sum(...)::bigint` llega como string con el driver de Postgres.
    totalShortageCents: Number(row.totalShortageCents ?? 0),
    lastCutDate: String(row.lastCutDate),
    windowCuts: Number(row.windowCuts),
    windowStartDate: String(row.windowStartDate),
  }));
}

/**
 * Hallazgos de faltante recurrente de toda la empresa, o de una sucursal.
 * Lectura pura: la usa `control-interno-service` para derivar la excepción.
 */
export async function getRecurringShortageFindings(
  companyId: string,
  branchId?: string,
): Promise<RecurringShortageFinding[]> {
  return consultarPatronesDeFaltante(companyId, { branchId });
}

export interface RecurringShortageReport {
  finding: RecurringShortageFinding | null;
  /** Ya había un hallazgo abierto para ese (sucursal, turno): no se volvió a avisar. */
  duplicate?: boolean;
  notified?: number;
}

/**
 * Evalúa el patrón de un (sucursal, turno) después de registrar un faltante y,
 * si cruza el umbral y no hay un hallazgo abierto igual, lo deja en el ledger y
 * avisa.
 *
 * El dedupe no necesita tabla: un hallazgo sigue "abierto" mientras el corte
 * más reciente que lo disparó siga dentro de la ventana actual. Cuando la
 * ventana avanza lo suficiente para dejarlo atrás, el patrón que se detecte
 * será otro y vuelve a avisar. Sin esto, cada faltante nuevo a partir del
 * tercero mandaría el mismo WhatsApp otra vez y la gente dejaría de leerlo.
 */
export async function reportRecurringShortage(
  companyId: string,
  branchId: string,
  shift: string,
): Promise<RecurringShortageReport> {
  const [finding] = await consultarPatronesDeFaltante(companyId, { branchId, shift });
  if (!finding) return { finding: null };

  const previos = await db.execute(sql`
    SELECT 1
    FROM domain_events e
    WHERE e.event_type = 'RecurringShortageDetected'
      AND e.company_id = ${companyId}
      AND e.branch_id = ${branchId}
      AND e.payload->>'shift' = ${shift}
      AND e.payload->>'lastCutDate' >= ${finding.windowStartDate}
    LIMIT 1
  `);
  if (filasDe(previos).length > 0) {
    return { finding, duplicate: true, notified: 0 };
  }

  await emitDomainEvent({
    companyId,
    branchId,
    eventType: "RecurringShortageDetected",
    payload: {
      shift,
      shortageCount: finding.shortageCount,
      totalShortageCents: finding.totalShortageCents,
      lastCutDate: finding.lastCutDate,
      windowCuts: finding.windowCuts,
      windowStartDate: finding.windowStartDate,
      thresholdCuts: RECURRING_SHORTAGE_WINDOW_CUTS,
      threshold: RECURRING_SHORTAGE_THRESHOLD,
    },
  });

  const recipients = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.companyId, companyId),
        eq(users.active, true),
        or(
          inArray(users.role, [...GROUP_ALERT_ROLES]),
          and(inArray(users.role, [...BRANCH_ALERT_ROLES]), eq(users.branchId, branchId)),
        ),
      ),
    );

  const etiquetaTurno = shiftLabel(shift);
  const montoAcumulado = pesos(finding.totalShortageCents);

  let notified = 0;
  for (const recipient of recipients) {
    try {
      await NotificationDispatcher.sendNotification({
        userId: recipient.id,
        title: "🔁 Faltantes recurrentes en caja",
        message:
          `${finding.branchName} · turno ${etiquetaTurno}: ${finding.shortageCount} faltantes ` +
          `en los últimos ${finding.windowCuts} cortes, por $${montoAcumulado} MXN acumulados. ` +
          `El más reciente, del ${finding.lastCutDate}.`,
        type: "warning",
        eventType: "recurring_shortage_detected",
        actionUrl: `/dashboard/sales?branchId=${branchId}`,
        actionLabel: "Ver cortes",
        metadata: {
          branchId,
          branchName: finding.branchName,
          shift,
          shiftLabel: etiquetaTurno,
          shortageCount: finding.shortageCount,
          windowCuts: finding.windowCuts,
          totalShortageAmount: montoAcumulado,
          lastCutDate: finding.lastCutDate,
        },
      });
      notified++;
    } catch (err) {
      console.warn(
        `[CashVarianceAlert] Falló el aviso de faltantes recurrentes ${branchId}/${shift} → ${recipient.id}:`,
        err,
      );
    }
  }

  return { finding, duplicate: false, notified };
}
