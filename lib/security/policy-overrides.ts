/**
 * Excepciones autorizadas a una política, con rastro.
 *
 * Envuelve `policy_overrides` (`lib/db/schema/security.ts`) con las tres
 * preguntas que la tabla responde y ninguna más:
 *
 * 1. **¿Existe una excepción vigente?** — para permitir el paso.
 * 2. **¿Quién puede concederla?** — no todos los que autorizan la operación
 *    pueden saltarse una regla; ése es un poder distinto.
 * 3. **¿Con qué motivo?** — obligatorio. Sin motivo, la fila no se escribe: una
 *    excepción sin explicación es un `if` con una tabla delante.
 *
 * Vigente significa: concedida, no revocada y, si tiene caducidad, dentro de
 * plazo. Una excepción caducada es exactamente tan historia como una revocada,
 * así que la consulta filtra por las dos y el resto se lee en la fila.
 */

import { db } from "@/lib/db";
import { policyOverrides } from "@/lib/db/schema";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import type { Role } from "@/lib/permissions";

/** Dominios con excepciones hoy. Texto en la base, unión aquí. */
export type OverrideDomain = "SHIFT_VALIDATION" | "WORKFLOW_REVIEW";

/** Reglas concretas dentro de un dominio. Texto en la base, unión aquí. */
export type OverrideRule =
  /** Jornada diaria de 8 h como bloqueo en vez de advertencia. */
  | "MAX_DAILY_HOURS"
  /** Revisar una ejecución en la que se participó. */
  | "SELF_REVIEW";

/** Qué recurso concreto queda afectado. */
export interface OverrideTarget {
  domain: OverrideDomain;
  rule: OverrideRule;
  /** `planned_shift` | `workflow_instance` — cada dominio tiene su tipo de id. */
  resourceType: string;
  /** Id del recurso. Texto porque un turno es uuid y una instancia también, pero
      el modelo no obliga a que ambos lo sean. */
  resourceId: string;
}

export interface GrantOverrideInput extends OverrideTarget {
  companyId: string;
  branchId?: string | null;
  grantedBy: string;
  /** Sin motivo no hay excepción. */
  reason: string;
  /** `null` = sin caducidad, que es la opción cara: úsese con justificante. */
  expiresAt?: Date | null;
}

/**
 * Quién puede conceder una excepción.
 *
 * Un poder distinto del de operar. `OWNER` y `SUPER_ADMIN` pueden saltarse una
 * regla con motivo; `ADMIN` no, aunque administre la empresa: ADMIN ejecuta y
 * ve, pero no redefine la política que lo ata. La decisión de incluirlo o no es
 * del negocio; hoy es deliberadamente cerrada y está anotada como pendiente.
 */
const ROLES_CONCEDEN: Role[] = ["OWNER", "SUPER_ADMIN"];

export function assertPuedeConcederExcepcion(role: Role): void {
  if (!ROLES_CONCEDEN.includes(role)) {
    throw ApiError.forbidden(
      "Sólo el propietario de la empresa puede autorizar una excepción a una política."
    );
  }
}

/** Motivo obligatorio y legible: una razón de un carácter no es una razón. */
function motivoValido(motivo: string): string {
  const limpio = motivo.trim();
  if (limpio.length < 10) {
    throw ApiError.badRequest(
      "Escribe el motivo de la excepción: se guarda como evidencia y se revisa después."
    );
  }
  return limpio;
}

/**
 * Concede una excepción y devuelve la fila.
 *
 * El índice único garantiza una excepción viva por recurso y regla. Si ya
 * existe, se devuelve la existente en lugar de reescribirla: cambiar el motivo
 * de una excepción ya concedida debe ser un acto explícito de revocación, o el
 * rastro deja de explicar por qué se concedió.
 */
export async function concederExcepcion(
  input: GrantOverrideInput
): Promise<typeof policyOverrides.$inferSelect> {
  const reason = motivoValido(input.reason);

  const existente = await db.query.policyOverrides.findFirst({
    where: and(
      eq(policyOverrides.companyId, input.companyId),
      eq(policyOverrides.domain, input.domain),
      eq(policyOverrides.rule, input.rule),
      eq(policyOverrides.resourceType, input.resourceType),
      eq(policyOverrides.resourceId, input.resourceId),
      isNull(policyOverrides.revokedAt)
    ),
  });

  if (existente) return existente;

  const [concedida] = await db
    .insert(policyOverrides)
    .values({
      companyId: input.companyId,
      branchId: input.branchId ?? null,
      domain: input.domain,
      rule: input.rule,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      grantedBy: input.grantedBy,
      reason,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();

  return concedida;
}

/**
 * ¿Hay una excepción vigente para este objetivo?
 *
 * Filtra por empresa además de por recurso: una excepción concedida a un turno
 * de otra empresa no debe habilitar nada aquí, ni aunque el id coincida.
 */
export async function hayExcepcionVigente(
  companyId: string,
  target: OverrideTarget,
  ahora: Date = new Date()
): Promise<boolean> {
  const [fila] = await db
    .select({ id: policyOverrides.id })
    .from(policyOverrides)
    .where(
      and(
        eq(policyOverrides.companyId, companyId),
        eq(policyOverrides.domain, target.domain),
        eq(policyOverrides.rule, target.rule),
        eq(policyOverrides.resourceType, target.resourceType),
        eq(policyOverrides.resourceId, target.resourceId),
        isNull(policyOverrides.revokedAt),
        or(isNull(policyOverrides.expiresAt), gt(policyOverrides.expiresAt, ahora))
      )
    )
    .limit(1);

  return Boolean(fila);
}

/**
 * Revoca una excepción sin borrarla.
 *
 * La fila es el registro de que alguien pudo saltarse una regla y por qué; si
 * desaparece, la pregunta "cuánto nos ahorramos por trabajar sin descanso" deja de
 * tener respuesta.
 */
export async function revocarExcepcion(
  companyId: string,
  target: OverrideTarget,
  actorId: string,
  motivo: string
): Promise<void> {
  await db
    .update(policyOverrides)
    .set({
      revokedAt: new Date(),
      revokedBy: actorId,
      revokedReason: motivoValido(motivo),
    })
    .where(
      and(
        eq(policyOverrides.companyId, companyId),
        eq(policyOverrides.domain, target.domain),
        eq(policyOverrides.rule, target.rule),
        eq(policyOverrides.resourceType, target.resourceType),
        eq(policyOverrides.resourceId, target.resourceId),
        isNull(policyOverrides.revokedAt)
      )
    );
}

/** Historial de excepciones de un recurso, para explicarlo en la pantalla. */
export async function historialDeExcepcion(
  companyId: string,
  target: OverrideTarget
) {
  return db.query.policyOverrides.findMany({
    where: and(
      eq(policyOverrides.companyId, companyId),
      eq(policyOverrides.domain, target.domain),
      eq(policyOverrides.rule, target.rule),
      eq(policyOverrides.resourceType, target.resourceType),
      eq(policyOverrides.resourceId, target.resourceId)
    ),
    orderBy: [policyOverrides.grantedAt],
  });
}