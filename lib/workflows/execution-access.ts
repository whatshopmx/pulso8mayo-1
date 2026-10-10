/**
 * Alcance autorizado sobre instancias de workflow (H02).
 *
 * Las rutas por id sólo comprobaban que hubiera sesión: `POST
 * /api/workflows/execute` llevaba un `// TODO: Check permissions` y
 * `GET /api/workflows/executions/[id]` cargaba la instancia por id a secas.
 * Como `workflow_instances` no tiene columna de empresa, la pregunta "de quién es
 * esta ejecución" se responde por su sucursal —y la llave foránea no dice nada
 * sobre quién pregunta—, así que adivinar un id era leer la ejecución de otra
 * empresa.
 *
 * Esa ausencia de `company_id` en la instancia es deliberada: la instancia
 * cuelga de una sucursal, y la sucursal sí tiene `company_id`. Por eso aquí la
 * empresa se verifica siempre con `assertBranchOfCompany`, en vez de confiar en
 * una columna que no existe.
 *
 * Contrato congelado en este módulo:
 * - `SUPER_ADMIN`/`OWNER`/`ADMIN`: cualquier instancia de su empresa.
 * - `GERENTE`/`SUPERVISOR`: sólo las de su sucursal (`NONE` si no tiene).
 * - `EMPLEADO`: sólo las que tiene asignadas, o las sin asignar de su sucursal.
 * - `READONLY`: lectura de su empresa.
 *
 * Los caminos por token (smart links y enlaces públicos) **no** pasan por aquí:
 * su contexto es el token, no la sesión. Siguen usando el cargador sin acotar, y
 * esa es la diferencia entre un bypass y una entrada alternativa con su propia
 * garantía.
 */

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import { assertBranchOfCompany, resolveBranchScope } from "@/lib/branch-scope";
import { requirePermissionApi } from "@/lib/rbac/abac";
import type { Role } from "@/lib/permissions";

/** Verbos de autorización sobre `workflows`. */
export type ExecutionAction = "read" | "create" | "update";

/** Identidad autorizada, derivada de la sesión y sólo de la sesión. */
export interface ExecutionActor {
  userId: string;
  role: Role;
  companyId: string;
  branchId: string | null;
}

/** Roles que administran toda la empresa en vez de una sucursal. */
const ROLES_EMPRESA: Role[] = ["SUPER_ADMIN", "OWNER", "ADMIN"];

/**
 * Puerta de autorización: sesión, permiso sobre `workflows` y empresa.
 *
 * Reutiliza `requirePermissionApi` para no mantener una segunda matriz de
 * roles. Sin `companyId` la respuesta es 403 y no un vacío ambiguo: sin empresa
 * no hay contra qué acotar, y un listado vacío se confunde con "no hay nada".
 */
export async function requireExecutionAccess(action: ExecutionAction): Promise<ExecutionActor> {
  const { user } = await requirePermissionApi("workflows", action);

  if (!user.companyId) {
    throw ApiError.forbidden(
      "Tu usuario no tiene una empresa asignada. Completa el onboarding antes de operar workflows."
    );
  }

  return {
    userId: user.id,
    role: user.role as Role,
    companyId: user.companyId,
    branchId: user.branchId ?? null,
  };
}

/**
 * Puerta de la sucursal destino: dentro del alcance del actor y de su empresa.
 *
 * Dos comprobaciones que no se sustituyen. El alcance responde "puedo trabajar
 * en esta sucursal"; `assertBranchOfCompany` responde "esa sucursal existe y es
 * mía". Una `ADMIN` puede tener alcance `ALL` y aun así no poder escribir sobre
 * la sucursal de otra empresa.
 */
export async function assertBranchDestino(actor: ExecutionActor, branchId: string): Promise<void> {
  const alcance = resolveBranchScope(actor.role, actor.branchId, null);

  if (alcance.kind === "NONE") {
    throw ApiError.forbidden(
      "Tu usuario no tiene una sucursal asignada, así que no puede operar workflows. Pide que te asignen una."
    );
  }

  if (alcance.kind === "BRANCH" && branchId !== alcance.branchId) {
    throw ApiError.forbidden("No puedes operar workflows de otra sucursal.");
  }

  await assertBranchOfCompany(actor.companyId, branchId);
}

/**
 * Puerta del responsable asignado.
 *
 * Sin `assigneeId`, quien arranca la ejecución es el propio actor y eso ya es
 * una asignación válida. Con `assigneeId` explícito, el destinatario tiene que
 * ser de esta empresa y, si tiene sucursal, caer dentro del alcance de quien
 * asigna: mandar el turno de una sucursal a una gerencia de otra no es una
 * decisión que el alcance deba permitir.
 */
export async function assertAssigneeAutorizado(
  actor: ExecutionActor,
  assigneeId: string | null
): Promise<void> {
  if (!assigneeId || assigneeId === actor.userId) return;

  const rechazo = () =>
    ApiError.badRequest(
      "El responsable seleccionado no pertenece a esta empresa. Recarga el catálogo e inténtalo de nuevo."
    );

  const [asignado] = await db
    .select({ companyId: users.companyId, branchId: users.branchId })
    .from(users)
    .where(eq(users.id, assigneeId))
    .limit(1);

  if (!asignado || asignado.companyId !== actor.companyId) throw rechazo();

  if (!asignado.branchId) return;

  const alcance = resolveBranchScope(actor.role, actor.branchId, null);
  if (alcance.kind === "NONE") throw rechazo();
  if (alcance.kind === "BRANCH" && asignado.branchId !== alcance.branchId) throw rechazo();
}

/**
 * Roles que pueden revisar una ejecución.
 *
 * Revisar es un acto de aprobación sobre trabajo ya terminado, no ejecutar un
 * paso. La matriz `workflows` no distingue las dos cosas —`EMPLEADO` puede
 * `update`, que es justo lo que necesita para cumplir sus propios pasos—, así
 * que usar `workflows:update` dejaría al empleado aprobando su propio trabajo.
 *
 * Esta lista traduce la regla que el propio esquema ya nombra: la columna de
 * revisión es "Revisión del supervisor". `SUPERVISOR` entra; `EMPLEADO` y
 * `READONLY` no. Es la lectura conservadora del producto, no una decisión
 * inventada, y queda como decisión abierta en el plan (C15) para que quien
 * define la política de revisión la confirme o la cambie.
 */
const ROLES_REVISION: Role[] = ["SUPER_ADMIN", "OWNER", "ADMIN", "GERENTE", "SUPERVISOR"];

/**
 * Puerta de revisión: permiso de `workflows` **y** rol de supervisory.
 *
 * Se compone de las dos mitades porque ninguna basta sola: `workflows:update`
 * incluye al empleado, y el rol sin permiso no aprueba nada aunque sea
 * gerencia de otra empresa.
 */
export async function requireReviewAccess(): Promise<ExecutionActor> {
  const actor = await requireExecutionAccess("update");

  if (!ROLES_REVISION.includes(actor.role)) {
    throw ApiError.forbidden("Tu rol no puede revisar ejecuciones.");
  }

  return actor;
}

/** Campos de la instancia que necesita la decisión de alcance. */
export interface ExecutionScopeTarget {
  id: string;
  branchId: string;
  assigneeId: string | null;
}

/**
 * Puerta de lectura sobre una instancia concreta.
 *
 * El mensaje no distingue "no existe" de "es de otra empresa" —la ruta lo
 * traduce a 404 en ambos casos—, para no confirmarle a quien prueba ids qué
 * ejecuciones existen en otras empresas.
 */
export async function assertExecutionInScope(
  actor: ExecutionActor,
  instance: ExecutionScopeTarget
): Promise<void> {
  // El alcance se resuelve primero: un rol acotado sin sucursal se cierra sin
  // tocar la base. Preguntar antes sólo wasted una consulta para acabar en el
  // mismo rechazo, y deja el id a un paso de la respuesta.
  const alcance = resolveBranchScope(actor.role, actor.branchId, null);

  if (alcance.kind === "NONE") {
    throw ApiError.forbidden(
      "Tu usuario no tiene una sucursal asignada, así que no puede ver estas ejecuciones. Pide que te asignen una."
    );
  }

  // Empresa después y en todos los casos: que la sucursal exista no significa
  // que sea de esta empresa. `workflow_instances` no guarda empresa, así que
  // esta es la única comprobación que responde "¿de quién es esta fila?".
  await assertBranchOfCompany(actor.companyId, instance.branchId);

  if (ROLES_EMPRESA.includes(actor.role)) return;

  if (alcance.kind === "BRANCH") {
    if (instance.branchId !== alcance.branchId) {
      throw ApiError.forbidden("No puedes ver una ejecución de otra sucursal.");
    }
    return;
  }

  // EMPLEADO y READONLY: decide la relación con el ejecutor, no el alcance de
  // empresa. Un empleado ve lo que tiene asignado, y una ejecución sin asignar
  // sólo si es de su sucursal —es trabajo sin dueño que puede tomar—.
  if (actor.role === "READONLY") return;

  if (instance.assigneeId === actor.userId) return;

  if (!instance.assigneeId && actor.branchId === instance.branchId) return;

  throw ApiError.forbidden("No tienes asignada esta ejecución.");
}