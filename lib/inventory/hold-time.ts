// lib/inventory/hold-time.ts
//
// Task 5 (plan-loteprod-gaps §6.4): ciclo de vencimiento del tiempo de
// retención en línea. Task 4 ya deriva `production_results.expires_at` de
// `recipes.hold_time_minutes`; aquí vive la lógica pura que decide qué hacer
// con esa fecha — sin DB, para que el cron, la API de confirmación y los tests
// compartan EXACTAMENTE el mismo criterio.
//
// Manual (§6.4): "al vencer, se registra en el waste log y se tira".
// Manual (§7, 21:00): "waste log firmado, mermas de retención registradas" —
// la confirmación es del turno, pero la merma NO puede quedarse sin registrar:
// si nadie confirma dentro de la gracia, el cron la cierra solo (marcada como
// automática) para que la varianza del día no mienta.
//
// RELOJ: todas estas funciones reciben `now` — nunca lo leen. El servicio le
// pasa el `now()::timestamp` del servidor, no `new Date()`: `expires_at` es
// `timestamp` sin zona y el driver lo entrega como fecha naive, así que en una
// máquina con huso local (Windows/CST) mezclar ambos relojes corre el
// vencimiento varias horas. Mismo cuidado con el que Task 4 lo escribió.

/** Estado de una tanda respecto a su ventana en línea. */
export type HoldTimeStatus = "OK" | "EXPIRING" | "EXPIRED";

/**
 * Antelación con la que una tanda entra en "por vencer". Los hold times del
 * manual van de 7 a 30 min, así que la ventana de aviso se mide en minutos,
 * no en horas como la caducidad de lotes (§5.4).
 */
export const HOLD_TIME_WARNING_MINUTES = 5;

/**
 * Gracia antes de que el cron registre la merma sin confirmación humana.
 * Tres horas es varias veces el hold time más largo del manual (30 min): si
 * a esas alturas nadie confirmó, el producto ya no está en línea y dejar la
 * merma sin registrar sólo rompe la conciliación del día.
 */
export const HOLD_TIME_AUTO_WASTE_GRACE_MINUTES = 180;

/** `origin` de la merma confirmada por el turno. */
export const HOLD_TIME_ORIGIN_CONFIRMED = "hold_time";
/** `origin` de la merma que el cron cerró sin confirmación (§7 21:00). */
export const HOLD_TIME_ORIGIN_AUTO = "hold_time_auto";

const MINUTE_MS = 60_000;

/**
 * Estado de la tanda respecto a `now`. Límite inclusive hacia el estado más
 * urgente: exactamente en la hora de vencimiento ya es EXPIRED.
 * `expiresAt` null (receta sin hold time) no se clasifica.
 */
export function classifyHoldStatus(
    expiresAt: Date | null,
    now: Date,
    warningMinutes: number = HOLD_TIME_WARNING_MINUTES
): HoldTimeStatus | null {
    if (!expiresAt) return null;
    const t = expiresAt.getTime();
    const n = now.getTime();
    if (t <= n) return "EXPIRED";
    if (t <= n + warningMinutes * MINUTE_MS) return "EXPIRING";
    return "OK";
}

/** Minutos que lleva vencida la tanda (0 si aún no vence). */
export function minutesOverdue(expiresAt: Date, now: Date): number {
    return Math.max(0, Math.floor((now.getTime() - expiresAt.getTime()) / MINUTE_MS));
}

/** Minutos que le quedan en línea (0 si ya venció). */
export function minutesRemaining(expiresAt: Date, now: Date): number {
    return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / MINUTE_MS));
}

/**
 * ¿El cron ya debe cerrar la merma sin esperar confirmación? Sólo cuando la
 * tanda venció hace más de la gracia; antes de eso el turno todavía puede
 * confirmar cuánto se tiró de verdad (o cero, si alcanzó a venderse).
 */
export function shouldAutoRegisterWaste(
    expiresAt: Date,
    now: Date,
    graceMinutes: number = HOLD_TIME_AUTO_WASTE_GRACE_MINUTES
): boolean {
    return minutesOverdue(expiresAt, now) >= graceMinutes;
}

/**
 * Pérdida en centavos de tirar `discardedQuantity` de una tanda cuyo costo de
 * insumos total fue `ingredientCost`. El costo del producto terminado no vive
 * en `inventory_items` (la producción no crea lote de producto final), así que
 * la única fuente honesta es el costo de insumos que ya consumió esa tanda.
 * Se redondea una sola vez, al final (A7).
 */
export function holdTimeLossCents(params: {
    ingredientCost: number | null;
    producedQuantity: number;
    discardedQuantity: number;
}): { costPerUnitCents: number | null; totalLossCents: number | null } {
    const { ingredientCost, producedQuantity, discardedQuantity } = params;
    if (!ingredientCost || ingredientCost <= 0 || producedQuantity <= 0) {
        return { costPerUnitCents: null, totalLossCents: null };
    }
    const perUnit = ingredientCost / producedQuantity;
    return {
        costPerUnitCents: Math.round(perUnit),
        totalLossCents: Math.round(perUnit * discardedQuantity),
    };
}

/** Motivos por los que una confirmación de descarte se rechaza. */
export type HoldTimeDiscardErrorCode =
    | "RESULT_NOT_FOUND"
    | "NOT_EXPIRED"
    | "ALREADY_DISCARDED"
    | "OVER_QUANTITY"
    | "INVALID_QUANTITY";

export interface HoldTimeDiscardCheck {
    ok: boolean;
    code?: HoldTimeDiscardErrorCode;
    message?: string;
}

/**
 * Validación de una confirmación de descarte. `discardedQuantity` cero es
 * legítimo y significativo: "venció en el sistema pero se vendió" — cierra la
 * tanda sin inventar una merma. Por eso el cero se acepta aquí y es el
 * servicio quien decide no escribir fila de merma.
 */
export function validateHoldTimeDiscard(params: {
    expiresAt: Date | null;
    discardedAt: Date | null;
    producedQuantity: number;
    discardedQuantity: number;
    now: Date;
}): HoldTimeDiscardCheck {
    const { expiresAt, discardedAt, producedQuantity, discardedQuantity, now } = params;

    if (discardedAt) {
        return { ok: false, code: "ALREADY_DISCARDED", message: "Esta tanda ya se cerró" };
    }
    if (!expiresAt) {
        return {
            ok: false,
            code: "NOT_EXPIRED",
            message: "La receta no maneja tiempo de retención",
        };
    }
    if (classifyHoldStatus(expiresAt, now) !== "EXPIRED") {
        return {
            ok: false,
            code: "NOT_EXPIRED",
            message: "La tanda todavía está dentro de su ventana en línea",
        };
    }
    if (!Number.isFinite(discardedQuantity) || discardedQuantity < 0) {
        return { ok: false, code: "INVALID_QUANTITY", message: "Cantidad inválida" };
    }
    if (discardedQuantity > producedQuantity) {
        return {
            ok: false,
            code: "OVER_QUANTITY",
            message: `No puedes tirar más de lo producido (${producedQuantity})`,
        };
    }
    return { ok: true };
}

export interface HoldTimeAlertLine {
    recipeName: string;
    quantity: number;
    unit: string;
    minutesOverdue: number;
}

/**
 * Mensaje al turno con la lista de productos a tirar (§6.4). Uno por sucursal
 * y corrida: mandar una notificación por tanda sería spam en plena línea.
 */
export function buildHoldTimeAlert(
    branchName: string,
    lines: HoldTimeAlertLine[]
): { severity: "ALTA" | "CRITICA"; message: string } {
    const detalle = lines
        .map(
            (l) =>
                `• ${l.recipeName}: ${l.quantity} ${l.unit} (venció hace ${l.minutesOverdue} min)`
        )
        .join("\n");

    return {
        // Una sola tanda vencida es ALTA; varias a la vez significan línea
        // desatendida y forecast mal calibrado (§9.3), no un descuido puntual.
        severity: lines.length > 1 ? "CRITICA" : "ALTA",
        message:
            `⏱️ *Tiempo de retención vencido* — ${branchName}\n` +
            `${detalle}\n\n` +
            `Tíralo y confirma la merma en Producción → En línea. ` +
            `Si alcanzó a venderse, confirma con cantidad 0.`,
    };
}
