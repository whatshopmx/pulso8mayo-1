/**
 * SLA de excepción canónica — Phase 0 / D7.
 *
 * Módulo puro (sin `db`): severidad → ventana. Defaults pensados para QSR
 * multi-unidad; se podrán configurar por tenant en una fase posterior sin
 * migrar (ver plan Phase 0 §D7).
 *
 *   fatal / critical → 30 min
 *   high             → 4 h
 *   warning          → 24 h
 *   info             → 72 h
 */
import type { ExceptionSeverity } from "./exception-types";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const SLA_WINDOWS_MS: Record<ExceptionSeverity, number> = {
  fatal: 30 * MINUTE,
  critical: 30 * MINUTE,
  high: 4 * HOUR,
  warning: 24 * HOUR,
  info: 72 * HOUR,
};

/** Fecha límite de atención a partir de `from` (default: ahora). */
export function computeSlaDueAt(
  severity: ExceptionSeverity,
  from: Date = new Date(),
): Date {
  return new Date(from.getTime() + SLA_WINDOWS_MS[severity]);
}

/** ¿La excepción ya venció su SLA? `null` ⇒ sin SLA declarado ⇒ no vencida. */
export function isSlaBreached(
  slaDueAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!slaDueAt) return false;
  const due = slaDueAt instanceof Date ? slaDueAt : new Date(slaDueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
}

/** Milisegundos restantes (negativo = vencida); `null` si no hay SLA. */
export function msUntilSla(
  slaDueAt: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!slaDueAt) return null;
  const due = slaDueAt instanceof Date ? slaDueAt : new Date(slaDueAt);
  if (Number.isNaN(due.getTime())) return null;
  return due.getTime() - now.getTime();
}
