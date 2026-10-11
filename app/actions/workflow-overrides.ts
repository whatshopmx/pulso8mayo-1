"use server";

/**
 * Excepciones a la revisión de workflows.
 *
 * La auto-revisión está cerrada por separación de funciones (`f701068`), pero
 * hay operaciones donde no existe "otra persona de la gerencia": un dueño solo
 * no podría cerrar nada. Este archivo es la salida, y es una salida con rastro:
 *
 * - Sólo `OWNER` y `SUPER_ADMIN` conceden; `ADMIN` no, aunque administre la
 *   empresa (`assertPuedeConcederExcepcion`).
 * - El motivo es obligatorio; sin él no se escribe la fila.
 * - Conceder es idempotente: si ya hay una excepción viva para esa ejecución,
 *   se devuelve la existente en vez de crear una segunda.
 *
 * Sin esta acción, la comprobación de `reviewExecution` sería una puerta que
 * nadie puede abrir: un consumidor sin productor es exactamente el tipo de
 * código muerto que la auditoría señalaba.
 */

import { requireTenantAuth } from "@/lib/api/with-auth";
import { db } from "@/lib/db";
import { branches, workflowInstances } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  assertPuedeConcederExcepcion,
  concederExcepcion,
  historialDeExcepcion,
  revocarExcepcion,
  type OverrideTarget,
} from "@/lib/security/policy-overrides";
import { requireExecutionAccess } from "@/lib/workflows/execution-access";
import { ApiError } from "@/lib/api/error";

const motivoSchema = z.string().trim().min(10, "Escribe el motivo: queda como evidencia.");

const concederSchema = z.object({
  instanceId: z.string().uuid("La ejecución no es válida."),
  reason: motivoSchema,
  /** Sin caducidad por defecto: una excepción permanente es política disfrazada. */
  expiresInDays: z.number().int().positive().max(365).optional(),
});

const revocarSchema = z.object({
  instanceId: z.string().uuid("La ejecución no es válida."),
  reason: motivoSchema,
});

/**
 * Fila de la ejecución dentro de esta empresa.
 *
 * `workflow_instances` no guarda empresa, así que la pertenencia se resuelve
 * por la sucursal igual que en el resto del módulo —misma regla, mismo sitio—.
 * Una excepción concedida sobre una ejecución de otra empresa no se concede
 * aquí: el id solo no abre nada.
 */
async function instanciaDeEmpresa(companyId: string, instanceId: string) {
  const [instancia] = await db
    .select({ id: workflowInstances.id, branchId: workflowInstances.branchId })
    .from(workflowInstances)
    .innerJoin(branches, eq(workflowInstances.branchId, branches.id))
    .where(
      and(
        eq(workflowInstances.id, instanceId),
        eq(branches.companyId, companyId)
      )
    );

  if (!instancia) {
    throw ApiError.notFound("No encontramos esta ejecución.");
  }

  return instancia;
}

function objetivo(instanceId: string): OverrideTarget {
  return {
    domain: "WORKFLOW_REVIEW",
    rule: "SELF_REVIEW",
    resourceType: "workflow_instance",
    resourceId: instanceId,
  };
}

/**
 * Autoriza a un owner a revisar una ejecución en la que participó.
 *
 * El alcance se comprueba antes que el poder de conceder: saber si la
 * ejecución existe en esta empresa no depende de si el actor puede saltarse la
 * regla, y al revés el mensaje revelaría quién pidió la excepción.
 */
export async function concederExcepcionAutoRevision(input: z.infer<typeof concederSchema>) {
  const { user, tenantId } = await requireTenantAuth();
  assertPuedeConcederExcepcion(user.role);

  // Sesión válida sobre workflows: concede quien además opera en el módulo.
  await requireExecutionAccess("read");

  const datos = concederSchema.parse(input);
  const instancia = await instanciaDeEmpresa(tenantId, datos.instanceId);

  return concederExcepcion({
    companyId: tenantId,
    branchId: instancia.branchId,
    grantedBy: user.id,
    reason: datos.reason,
    expiresAt: datos.expiresInDays
      ? new Date(Date.now() + datos.expiresInDays * 24 * 60 * 60 * 1000)
      : null,
    ...objetivo(datos.instanceId),
  });
}

/** Retira una excepción viva sin borrar el registro. */
export async function revocarExcepcionAutoRevision(input: z.infer<typeof revocarSchema>) {
  const { user, tenantId } = await requireTenantAuth();
  assertPuedeConcederExcepcion(user.role);
  await requireExecutionAccess("read");

  const datos = revocarSchema.parse(input);
  await instanciaDeEmpresa(tenantId, datos.instanceId);

  await revocarExcepcion(tenantId, objetivo(datos.instanceId), user.id, datos.reason);

  return { success: true };
}

/**
 * Historial de excepciones de una ejecución, para explicarlas en pantalla.
 *
 * Lo puede leer cualquiera con sesión en el módulo: el motivo de una excepción
 * no es un secreto, es la explicación que el operador necesita para entender
 * por qué una ejecución la aprobó la misma persona que la ejecutó.
 */
export async function historialDeExcepcionAutoRevision(instanceId: string) {
  const { tenantId } = await requireTenantAuth();
  await requireExecutionAccess("read");

  const zodId = z.string().uuid().parse(instanceId);
  return historialDeExcepcion(tenantId, objetivo(zodId));
}