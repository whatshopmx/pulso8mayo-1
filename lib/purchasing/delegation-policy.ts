import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { purchaseDelegationRules } from "@/lib/db/schema";
import { assertBranchOfCompany } from "@/lib/branch-scope";
import { APPROVER_ROLES_HIERARCHY, roleIsAtLeast } from "@/lib/permissions";

/**
 * Controles de solicitud y emisión de compras (C16.2).
 *
 * La matriz de autorización de C16.1 decide **quién aprueba**. Esto decide
 * **quién solicita y quién emite**, que hasta hoy sólo dependía de
 * `inventory:create` e `inventory:update` — el mismo permiso para todos.
 *
 * **Lo que este módulo no hace, y es deliberado.**
 *
 * - No lee la dimensión de estructura de compras. La auditoría H04 ya lo dijo:
 *   esa modalidad se guarda y se describe, pero ningún servicio la leía. C15 la
 *   clasificó como `descriptiva` y la decisión de producto del 13-10-2026 fue
 *   que cada empresa elija a sus responsables explícitamente. Deducir permisos
 *   de `CENTRALIZADA`/`POR_SUCURSAL`/`HIBRIDO` sería repetir el defecto con
 *   otro nombre.
 * - No lleva montos. Los montos pertenecen a la matriz de la C16.1 (quién
 *   aprueba cada rango) y a la autonomía del gerente de C20; un rango aquí
 *   sería otro contrato con otro consumidor.
 * - No siembra reglas por omisión. La matriz OC siembra una matriz predeterminada
 *   porque sus reglas son las que hacen que el flujo no se bloquee; aquí sembrar
 *   significaría **conceder** permisos que nadie eligió. Sin reglas no hay control
 *   adicional y decide el RBAC vigente, que es lo que hay hoy.
 *
 * **Semántica de resolución.** Con reglas activas para la acción, la operación
 * necesita *al menos una* que la cubra y cuyo rol exigido alcance al del actor.
 * Si las reglas existen y ninguna cubre la sucursal o la categoría, se rechaza
 * nombrando el hueco. Es la misma semántica de la matriz: lo que no cubre una
 * regla activa no se improvisa.
 */

export type DelegationAction = "REQUEST" | "EMIT";
export type DelegationScope = "COMPANY" | "BRANCH" | "CATEGORY";

export const DELEGATION_ACTIONS: readonly DelegationAction[] = ["REQUEST", "EMIT"];
export const DELEGATION_SCOPES: readonly DelegationScope[] = ["COMPANY", "BRANCH", "CATEGORY"];

/** Rol mínimo admitido en un control. Se limita a roles de persona real. */
export const DELEGATION_ROLES = ["OWNER", "ADMIN", "GERENTE", "SUPERVISOR", "EMPLEADO"] as const;
export type DelegationRole = (typeof DELEGATION_ROLES)[number];

/** Forma de una regla, sin la compañía: la resolución no la necesita. */
export interface DelegationRule {
  action: DelegationAction;
  scope: DelegationScope;
  branchId: string | null;
  category: string | null;
  requiredRole: string;
  active: boolean;
}

/** Lo que hay que saber de la operación para decidir quién puede ejecutarla. */
export interface DelegationContext {
  action: DelegationAction;
  /**
   * Rol del actor. `null` = actor de sistema (una sugerencia del PAR, un job):
   * puede dejar un borrador, nunca emitir una orden al proveedor.
   */
  role: string | null;
  branchId: string | null;
  /** Categorías de los artículos involucradas, ya normalizadas o sin normalizar. */
  categories: string[];
}

export interface DelegationAllowance {
  allowed: true;
  /** Por qué se permite: no hay controles, o una regla concreta lo concede. */
  basis: "sin_controles" | "regla" | "sistema_borrador";
  /** La regla que decidió, cuando la decidió. */
  rule: DelegationRule | null;
  /** Rol que la regla exigía, para poder explicarlo en la respuesta. */
  requiredRole: string | null;
  /** Frase lista para el mensaje de rechazo o para la interfaz. */
  reason: string;
}

export interface DelegationDenial {
  allowed: false;
  /** `sin_cobertura`: hay reglas y ninguna cubre la operación. */
  basis: "sin_cobertura" | "rol_insuficiente" | "sistema_no_emite";
  /** Rol que habría hecho falta, cuando el hueco es de autoridad. */
  requiredRole: string | null;
  reason: string;
  /** Ámbitos que ninguna regla cubre; sirve para decir dónde está el hueco. */
  uncoveredScopes: string[];
}

export type DelegationVerdict = DelegationAllowance | DelegationDenial;

/**
 * Categorías en forma comparable. La categoría del artículo es texto libre
 * (`inventory_items.category`), así que la comparación no puede exigir un
 * catálogo que no existe: recorta, mayúsculas y sin espacios dobles.
 */
export function normalizarCategoria(categoria: string | null | undefined): string {
  return (categoria ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("es-MX");
}

/** ¿La regla cubre esta operación, según su alcance? */
export function reglaCubre(regla: DelegationRule, contexto: DelegationContext): boolean {
  switch (regla.scope) {
    case "COMPANY":
      return true;
    case "BRANCH":
      return Boolean(contexto.branchId) && regla.branchId === contexto.branchId;
    case "CATEGORY":
      return normalizarCategoria(regla.category) !== "" &&
        contexto.categories.some(
          (c) => normalizarCategoria(c) === normalizarCategoria(regla.category),
        );
  }
}

/** Ámbito legible, para nombrar el hueco sin adivinar. */
export function alcanceDe(
  regla: Pick<DelegationRule, "scope"> &
    Partial<Pick<DelegationRule, "branchId" | "category">>,
): string {
  switch (regla.scope) {
    case "COMPANY":
      return "toda la empresa";
    case "BRANCH":
      return `la sucursal ${regla.branchId ?? "sin definir"}`;
    case "CATEGORY":
      return `la categoría ${regla.category ?? "sin definir"}`;
  }
}

/**
 * Decisión pura: reglas activas de la acción contra la operación. Sin base de
 * datos, sin efectos; la prueba la recorre entera.
 *
 * El orden importa sólo para el mensaje: cuando varias reglas cubren, gana la
 * más permisiva que el actor pueda satisfacer, y se citan las demás para que el
 * rechazo diga qué estaba cerca.
 */
export function resolverDelegacion(
  reglas: DelegationRule[],
  contexto: DelegationContext,
): DelegationVerdict {
  // Un actor de sistema nunca emite, con controles o sin ellos: enviar una orden
  // al proveedor es una decisión de persona. Va antes que el caso «sin
  // controles» porque «nadie está» no es «nadie ha escrito una regla».
  if (contexto.role === null && contexto.action === "EMIT") {
    return {
      allowed: false,
      basis: "sistema_no_emite",
      requiredRole: null,
      reason:
        "Una orden sólo la emite alguien con sesión: las sugerencias automáticas dejan borradores, " +
        "no órdenes enviadas al proveedor.",
      uncoveredScopes: [],
    };
  }

  const activas = reglas.filter((r) => r.action === contexto.action && r.active !== false);

  // Sin controles: el RBAC vigente sigue decidiendo. No es «cualquiera puede»,
  // es «esta política no añade nada».
  if (activas.length === 0) {
    if (contexto.role === null) {
      return {
        allowed: true,
        basis: "sistema_borrador",
        rule: null,
        requiredRole: null,
        reason:
          "No hay controles de delegación y el actor es de sistema: sólo puede dejar un borrador, " +
          "que no llega al proveedor sin emisión.",
      };
    }
    return {
      allowed: true,
      basis: "sin_controles",
      rule: null,
      requiredRole: null,
      reason: "Esta empresa no ha configurado controles de delegación para esta acción; decide el permiso vigente.",
    };
  }

  const queCubren = activas.filter((r) => reglaCubre(r, contexto));

  if (queCubren.length === 0) {
    const haySucursal = activas.some((r) => r.scope === "BRANCH");
    const hayCategoria = activas.some((r) => r.scope === "CATEGORY");
    const uncoveredScopes = [
      haySucursal ? `la sucursal ${contexto.branchId ?? "sin definir"}` : null,
      hayCategoria && contexto.categories.length === 0 ? "artículos sin categoría" : null,
    ].filter((x): x is string => x !== null);

    return {
      allowed: false,
      basis: "sin_cobertura",
      requiredRole: null,
      reason:
        "Los controles de delegación de esta empresa no cubren esta operación" +
        (uncoveredScopes.length > 0 ? ` (${uncoveredScopes.join("; ")})` : "") +
        ". Agrega una regla que la cubra o elimina las que sobran.",
      uncoveredScopes,
    };
  }

  // Con varias reglas que cubren, basta con que una conceda lo suficiente.
  // Se ordena de menor a mayor exigencia para que la primera que encuentra el
  // actor sea la más permisiva que puede usar.
  const candidatas = [...queCubren].sort(
    (a, b) =>
      (APPROVER_ROLES_HIERARCHY[a.requiredRole] ?? -1) -
      (APPROVER_ROLES_HIERARCHY[b.requiredRole] ?? -1),
  );

  for (const regla of candidatas) {
    if (roleIsAtLeast(contexto.role, regla.requiredRole)) {
      return {
        allowed: true,
        basis: "regla",
        rule: regla,
        requiredRole: regla.requiredRole,
        reason:
          `Un control de delegación concede ${regla.requiredRole} para ${alcanceDe(regla)}.`,
      };
    }
  }

  const masBaja = candidatas[0];
  return {
    allowed: false,
    basis: "rol_insuficiente",
    requiredRole: masBaja.requiredRole,
    reason:
      `${contexto.role} no alcanza ningún control de delegación que cubra ${alcanceDe(masBaja)}: ` +
      `el mínimo es ${masBaja.requiredRole}.`,
    uncoveredScopes: [],
  };
}

// ── Carga desde la base ──

/**
 * Reglas activas de una empresa para una acción. Falla cerrada si la base no
 * responde: un error de lectura no puede convertirse en «sin controles», que
 * dejaría emitir a quien no debe.
 */
export async function cargarReglasDeDelegacion(
  companyId: string,
  accion: DelegationAction,
): Promise<DelegationRule[]> {
  const filas = await db
    .select()
    .from(purchaseDelegationRules)
    .where(
      and(
        eq(purchaseDelegationRules.companyId, companyId),
        eq(purchaseDelegationRules.action, accion),
      ),
    )
    .orderBy(asc(purchaseDelegationRules.scope));

  return filas.map((f) => ({
    action: f.action,
    scope: f.scope,
    branchId: f.branchId,
    category: f.category,
    requiredRole: f.requiredRole,
    active: f.active,
  }));
}

/** Veredicto con las reglas ya leídas: es lo que llaman los caminos de escritura. */
export async function evaluarDelegacion(
  companyId: string,
  contexto: DelegationContext,
): Promise<DelegationVerdict> {
  const reglas = await cargarReglasDeDelegacion(companyId, contexto.action);
  return resolverDelegacion(reglas, contexto);
}

// ── Validación y persistencia (configuración) ──

export interface DelegationRuleInput {
  action: DelegationAction;
  scope: DelegationScope;
  branchId?: string | null;
  category?: string | null;
  requiredRole: string;
  active?: boolean;
}

export type DelegationValidation =
  | { ok: true; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

/**
 * Valida el conjunto antes de reemplazar los controles de una acción:
 * - Coherencia del alcance con su destino (BRANCH exige sucursal, CATEGORY exige
 *   categoría, COMPANY no admite ninguno de los dos).
 * - Rol exigido existente. Como `roleIsAtLeast` falla cerrado, un rol mal escrito
 *   dejaría la regla inaplicable para siempre: es un error de configuración,
 *   no una advertencia.
 * - Una sucursal que no pertenece a la empresa se rechaza: sin esto, la empresa
 *   podría concederse permisos sobre una sucursal ajena que nunca va a usar.
 * - Aviso, no error, cuando dos reglas activas cubren lo mismo: la más
 *   permisiva gana y la otra queda muerta, que es confuso de leer más que roto.
 */
export async function validarReglasDeDelegacion(
  companyId: string,
  reglas: DelegationRuleInput[],
): Promise<DelegationValidation> {
  const warnings: string[] = [];

  for (const r of reglas) {
    if (r.scope === "BRANCH" && !r.branchId) {
      return { ok: false, error: "Una regla por sucursal necesita su sucursal.", warnings };
    }
    if (r.scope === "CATEGORY" && !normalizarCategoria(r.category)) {
      return { ok: false, error: "Una regla por categoría necesita la categoría del artículo.", warnings };
    }
    if (r.scope === "COMPANY" && (r.branchId || r.category)) {
      return { ok: false, error: "Una regla de toda la empresa no lleva sucursal ni categoría.", warnings };
    }
    if (!(r.requiredRole in APPROVER_ROLES_HIERARCHY)) {
      return { ok: false, error: `Rol desconocido en la regla: "${r.requiredRole}".`, warnings };
    }
    // Una sucursal que no es de la empresa no es un aviso: es una regla que no
    // puede volver a concederse sola y que ocultaría el hueco de cobertura.
    // `assertBranchOfCompany` es la misma comprobación que usan turnos, caja
    // chica y gastos, con el mismo mensaje para el operador.
    if (r.scope === "BRANCH" && r.branchId) {
      try {
        await assertBranchOfCompany(companyId, r.branchId);
      } catch {
        return { ok: false, error: "Alguna de las sucursales no pertenece a esta empresa.", warnings };
      }
    }
  }

  const activos = reglas.filter((r) => r.active !== false);
  for (let i = 0; i < activos.length; i++) {
    for (let j = i + 1; j < activos.length; j++) {
      const a = activos[i];
      const b = activos[j];
      if (a.scope !== b.scope) continue;
      const mismo =
        a.scope === "COMPANY" ||
        (a.scope === "BRANCH" && a.branchId === b.branchId) ||
        (a.scope === "CATEGORY" &&
          normalizarCategoria(a.category) === normalizarCategoria(b.category));
      if (mismo) {
        warnings.push(
          `Dos reglas activas cubren ${alcanceDe(a)} con roles distintos (${a.requiredRole} y ${b.requiredRole}): ` +
            `se aplica la más permisiva. Deja una sola si no querías dos niveles.`,
        );
      }
    }
  }

  return { ok: true, warnings };
}

/** Reemplaza los controles de una acción, como hace `replaceMatrixRules`. */
export async function reemplazarReglasDeDelegacion(
  companyId: string,
  accion: DelegationAction,
  reglas: DelegationRuleInput[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(purchaseDelegationRules)
      .where(
        and(
          eq(purchaseDelegationRules.companyId, companyId),
          eq(purchaseDelegationRules.action, accion),
        ),
      );
    if (reglas.length === 0) return;
    await tx.insert(purchaseDelegationRules).values(
      reglas.map((r) => ({
        companyId,
        action: accion,
        scope: r.scope,
        branchId: r.scope === "BRANCH" ? (r.branchId ?? null) : null,
        category: r.scope === "CATEGORY" ? normalizarCategoria(r.category) || null : null,
        requiredRole: r.requiredRole,
        active: r.active ?? true,
      })),
    );
  });
}

/** Resumen por acción para la pantalla de configuración. */
export async function resumenDeDelegacion(companyId: string) {
  const reglas = await db
    .select()
    .from(purchaseDelegationRules)
    .where(eq(purchaseDelegationRules.companyId, companyId))
    .orderBy(asc(purchaseDelegationRules.action), asc(purchaseDelegationRules.scope));

  const porAccion: Record<DelegationAction, typeof reglas> = { REQUEST: [], EMIT: [] };
  for (const regla of reglas) porAccion[regla.action].push(regla);

  const descripcion = (lista: typeof reglas) => {
    const activas = lista.filter((r) => r.active);
    if (activas.length === 0) return "Sin controles: decide el permiso de inventario vigente.";
    return activas
      .map((r) => `${r.requiredRole} puede ${r.action === "REQUEST" ? "solicitar" : "emitir"} en ${alcanceDe(r)}`)
      .join(" · ");
  };

  return {
    REQUEST: { reglas: porAccion.REQUEST, descripcion: descripcion(porAccion.REQUEST) },
    EMIT: { reglas: porAccion.EMIT, descripcion: descripcion(porAccion.EMIT) },
  };
}
