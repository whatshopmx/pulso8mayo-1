/**
 * Canonical Exception lifecycle — Phase 0 / Epic 0.1.
 *
 * Máquina de estados **pura**: no importa `db` ni conoce Drizzle. El servicio
 * (`exception-service.ts`) la usa para autorizar cada mutación; así las reglas
 * de lifecycle se prueban en milisegundos y una ruta/acción no puede saltarse
 * una guarda por olvido.
 *
 * Diagrama (D3 del plan):
 *
 *   OPEN → ASSIGNED → IN_ACTION → RESOLVED → VERIFIED → CLOSED
 *     └──────────────┴───────────┴──────────┴───────────┴→ REOPENED
 *     └→ ESCALATED (desde cualquier estado no terminal)
 *     └→ CANCELLED (desde cualquier estado no terminal)
 *
 * Guardas:
 *  - `RESOLVE` exige `resolution` no vacía.
 *  - `VERIFY` exige verificador ≠ resolvedor (segregación de funciones).
 *  - `CLOSE` solo desde `VERIFIED` (lo garantiza la tabla de transiciones).
 *  - `REOPEN` exige `reason` no vacía (por qué se reabre).
 */

export type ExceptionStatus =
  | "OPEN"
  | "ASSIGNED"
  | "IN_ACTION"
  | "RESOLVED"
  | "VERIFIED"
  | "CLOSED"
  | "REOPENED"
  | "ESCALATED"
  | "CANCELLED";

export type ExceptionEvent =
  | "ASSIGN"
  | "START_ACTION"
  | "RESOLVE"
  | "VERIFY"
  | "CLOSE"
  | "REOPEN"
  | "ESCALATE"
  | "CANCEL";

export interface TransitionContext {
  /** Actor que ejecuta el evento (usuario autenticado). */
  actorId?: string;
  /** Owner destino para `ASSIGN`. */
  ownerId?: string;
  /** Texto de resolución para `RESOLVE`. */
  resolution?: string;
  /** Quien resolvió la excepción (se compara contra `actorId` en `VERIFY`). */
  resolvedBy?: string;
  /** Motivo para `REOPEN` / `ESCALATE`. */
  reason?: string;
}

export interface TransitionResult {
  ok: boolean;
  /** Estado destino cuando `ok` es true; `null` en caso contrario. */
  to: ExceptionStatus | null;
  /** Explicación cuando `ok` es false; `null` en caso contrario. */
  reason: string | null;
}

/** Transiciones legales. Un estado ausente de la tabla = evento ilegal. */
const TRANSITIONS: Record<
  ExceptionStatus,
  Partial<Record<ExceptionEvent, ExceptionStatus>>
> = {
  OPEN: {
    ASSIGN: "ASSIGNED",
    ESCALATE: "ESCALATED",
    CANCEL: "CANCELLED",
  },
  ASSIGNED: {
    ASSIGN: "ASSIGNED", // reasignación
    START_ACTION: "IN_ACTION",
    ESCALATE: "ESCALATED",
    CANCEL: "CANCELLED",
  },
  IN_ACTION: {
    ASSIGN: "ASSIGNED", // reasignación
    RESOLVE: "RESOLVED",
    ESCALATE: "ESCALATED",
    CANCEL: "CANCELLED",
  },
  RESOLVED: {
    VERIFY: "VERIFIED",
    REOPEN: "REOPENED",
    ESCALATE: "ESCALATED",
    CANCEL: "CANCELLED",
  },
  VERIFIED: {
    CLOSE: "CLOSED",
    REOPEN: "REOPENED",
    ESCALATE: "ESCALATED",
  },
  CLOSED: {
    REOPEN: "REOPENED",
  },
  REOPENED: {
    ASSIGN: "ASSIGNED",
    START_ACTION: "IN_ACTION",
    ESCALATE: "ESCALATED",
    CANCEL: "CANCELLED",
  },
  ESCALATED: {
    ASSIGN: "ASSIGNED",
    START_ACTION: "IN_ACTION",
    RESOLVE: "RESOLVED",
    CANCEL: "CANCELLED",
  },
  CANCELLED: {},
};

const TERMINAL: ReadonlySet<ExceptionStatus> = new Set(["CLOSED", "CANCELLED"]);

export function isTerminal(status: ExceptionStatus): boolean {
  return TERMINAL.has(status);
}

/** Eventos legales desde un estado (útil para decidir qué botones ofrecer). */
export function allowedEvents(status: ExceptionStatus): ExceptionEvent[] {
  return Object.keys(TRANSITIONS[status] ?? {}) as ExceptionEvent[];
}

function nonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Valida y aplica una transición.
 *
 * Devuelve `{ ok: true, to }` si el evento es legal desde `from` y cumple sus
 * guardas; en cualquier otro caso `{ ok: false, reason }` con la explicación.
 */
export function transition(
  from: ExceptionStatus,
  event: ExceptionEvent,
  ctx: TransitionContext = {},
): TransitionResult {
  const next = TRANSITIONS[from]?.[event];

  if (!next) {
    return {
      ok: false,
      to: null,
      reason: `Transición ilegal: ${from} --${event}-->`,
    };
  }

  switch (event) {
    case "ASSIGN":
      if (!nonEmpty(ctx.ownerId)) {
        return { ok: false, to: null, reason: "ASSIGN requiere ownerId." };
      }
      break;
    case "RESOLVE":
      if (!nonEmpty(ctx.resolution)) {
        return {
          ok: false,
          to: null,
          reason: "RESOLVE requiere resolution no vacía.",
        };
      }
      break;
    case "VERIFY": {
      if (!nonEmpty(ctx.actorId) || !nonEmpty(ctx.resolvedBy)) {
        return {
          ok: false,
          to: null,
          reason: "VERIFY requiere actorId y resolvedBy.",
        };
      }
      if (ctx.actorId === ctx.resolvedBy) {
        return {
          ok: false,
          to: null,
          reason:
            "Segregación de funciones: quien resuelve no puede verificar la misma excepción.",
        };
      }
      break;
    }
    case "REOPEN":
      if (!nonEmpty(ctx.reason)) {
        return { ok: false, to: null, reason: "REOPEN requiere reason no vacía." };
      }
      break;
    default:
      break;
  }

  return { ok: true, to: next, reason: null };
}
