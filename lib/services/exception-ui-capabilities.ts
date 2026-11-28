/**
 * EXC-05 — Capacidades de UI y resolución de acciones canónicas de excepciones.
 *
 * Módulo puro (sin DB): compartido entre `ExceptionLifecycleActions`,
 * `app/dashboard/exceptions/page.tsx` y pruebas V3.
 *
 * Garantías:
 * 1. Solo ofrece acciones legales según la máquina de estados del servidor
 *    (`allowedEvents`) y el permiso efectivo del rol (`exceptions:update`).
 * 2. Refleja segregación de funciones en UI: quien resolvió (`resolvedBy`) no
 *    recibe el botón `Verificar` habilitado; se declara el bloqueo explícito.
 * 3. El feed nunca acredita una acción canónica inexistente: una fila legacy sin
 *    proyección canónica (`lifecycle` ni `canonical`) se presenta únicamente como
 *    enlace de consulta al módulo origen, nunca como "Resolver".
 */
import { hasPermission, type Role } from "@/lib/permissions";
import {
  allowedEvents,
  type ExceptionEvent,
  type ExceptionStatus,
} from "./exception-lifecycle";
import type {
  GroupException,
  GroupExceptionLifecycle,
} from "./group-exceptions-service";

export const PRIMARY_EXCEPTION_EVENT: Partial<Record<ExceptionStatus, ExceptionEvent>> = {
  OPEN: "ASSIGN",
  ASSIGNED: "START_ACTION",
  IN_ACTION: "RESOLVE",
  RESOLVED: "VERIFY",
  VERIFIED: "CLOSE",
  REOPENED: "START_ACTION",
  ESCALATED: "RESOLVE",
};

export interface ResolvedCanonicalTarget {
  exceptionId: string;
  lifecycle: GroupExceptionLifecycle;
  source: "CANONICAL" | "LEGACY_WITH_CANONICAL";
}

export interface BlockedActionReason {
  event: ExceptionEvent;
  reason: string;
}

export interface ExceptionUiCapabilities {
  canMutate: boolean;
  allowedActions: ExceptionEvent[];
  primaryAction: ExceptionEvent | null;
  secondaryActions: ExceptionEvent[];
  blockedActions: BlockedActionReason[];
  readOnlyReason: string | null;
}

/**
 * Determina si el rol puede ejecutar mutaciones del lifecycle canónico
 * (mismo predicado RBAC que `withExceptionMutation` en el servidor).
 */
export function canMutateExceptionsRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return hasPermission(role as Role, "exceptions", "update");
}

/**
 * Resuelve si una fila del feed posee una excepción canónica operable por API.
 * Devuelve `null` si la fila legacy aún no tiene proyección canónica.
 */
export function resolveCanonicalTarget(
  item: Pick<GroupException, "id" | "lifecycle" | "canonical">,
): ResolvedCanonicalTarget | null {
  if (item.lifecycle) {
    return {
      exceptionId: item.id,
      lifecycle: item.lifecycle,
      source: "CANONICAL",
    };
  }
  if (item.canonical) {
    return {
      exceptionId: item.canonical.id,
      lifecycle: {
        status: item.canonical.status,
        ownerId: item.canonical.ownerId,
        slaDueAt: item.canonical.slaDueAt,
        ...(item.canonical.resolvedBy ? { resolvedBy: item.canonical.resolvedBy } : {}),
      },
      source: "LEGACY_WITH_CANONICAL",
    };
  }
  return null;
}

/**
 * Calcula qué botones canónicos puede ejecutar este usuario sobre la excepción.
 */
export function computeExceptionUiCapabilities(params: {
  lifecycle: GroupExceptionLifecycle;
  canUpdate: boolean;
  currentUserId?: string | null;
}): ExceptionUiCapabilities {
  const legal = allowedEvents(params.lifecycle.status);
  if (!params.canUpdate) {
    return {
      canMutate: false,
      allowedActions: [],
      primaryAction: null,
      secondaryActions: [],
      blockedActions: legal.map((event) => ({
        event,
        reason: "Solo lectura: tu rol no tiene permiso para modificar excepciones.",
      })),
      readOnlyReason: "Solo lectura",
    };
  }

  const allowedActions: ExceptionEvent[] = [];
  const blockedActions: BlockedActionReason[] = [];

  for (const event of legal) {
    if (
      event === "VERIFY" &&
      params.lifecycle.resolvedBy &&
      params.currentUserId &&
      params.lifecycle.resolvedBy === params.currentUserId
    ) {
      blockedActions.push({
        event,
        reason: "Requiere otro verificador (segregación de funciones).",
      });
      continue;
    }
    allowedActions.push(event);
  }

  const preferredPrimary = PRIMARY_EXCEPTION_EVENT[params.lifecycle.status];
  const primaryAction =
    preferredPrimary && allowedActions.includes(preferredPrimary)
      ? preferredPrimary
      : (allowedActions[0] ?? null);
  const secondaryActions = allowedActions.filter((e) => e !== primaryAction);

  return {
    canMutate: true,
    allowedActions,
    primaryAction,
    secondaryActions,
    blockedActions,
    readOnlyReason: null,
  };
}

/**
 * Etiqueta honesta para filas del feed que aún no tienen excepción canónica:
 * nunca afirma "Resolver" como si existiera una acción canónica inexistente.
 */
export function resolveLegacyFeedLinkLabel(
  actionLabel: string | undefined,
): string {
  const trimmed = actionLabel?.trim();
  if (!trimmed || /^resolver\b/i.test(trimmed)) {
    return "Ver en módulo";
  }
  return trimmed;
}
