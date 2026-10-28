/**
 * OPS-02.nomina.D — recordatorio de aguinaldo por empresa.
 *
 * El cron original (`lib/inngest/functions/cron-aguinaldo-reminder.ts`) hacía
 * tres cosas que no resisten el lote RLS de nómina:
 *
 *   1. Leía `payroll_runs` de TODAS las empresas en una sola consulta. Con las
 *      políticas del lote, esa lectura no devuelve filas (el rol runtime no
 *      tiene bypass) y el recordatorio se apagaría en silencio. Aquí cada
 *      empresa se lee en su propia transacción con `withCompanyContext`, sin
 *      sesión HTTP y sin asumir alcance privilegiado.
 *   2. Dependía del rol `OWNER` para elegir destinatarios. `OWNER` existe en el
 *      enum de la base (`roleEnum`) y en la matriz de permisos (`Role`), pero
 *      NO existe en `UserRole` ni en `ROUTE_PERMISSIONS`: un usuario `OWNER` no
 *      puede abrir `/dashboard/labor/payroll`. El recordatorio se dirige sólo a
 *      roles que el RBAC de rutas reconoce y que además pueden ejecutar la
 *      nómina (`reports:manage`). Las empresas cuya única dirección sea `OWNER`
 *      se devuelven aparte (`sinDestinatario`) para que la brecha sea visible.
 *   3. Trataba una corrida `COMPLETED` como "ya dispersada". `COMPLETED` es
 *      timbrado (CFDI 002), no entrega del dinero. El estado `TIMBRADO` genera
 *      un aviso que pide confirmar la dispersión real y dice explícitamente que
 *      el sistema no puede verificar el pago desde el CFDI.
 *
 * Este servicio no envía notificaciones ni abre conexiones fuera de la
 * transacción de cada empresa: el cron decide y `NotificationDispatcher` envía.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { payrollRuns, users } from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission, type Role } from "@/lib/permissions";
import type { UserRole } from "@/lib/rbac/permissions";
import type { NotificationEventType } from "@/lib/notifications/routing-policy";

/** Límite legal del Art. 87 LFT (multa Art. 1002: 50–5,000 UMA). */
export const LIMITE_AGUINALDO = "19 de diciembre";

/**
 * Roles de la DB que la dirección usa hoy. `OWNER` se incluye aquí SÓLO para
 * detectar empresas sin destinatario válido; no es un destinatario.
 */
const ROLES_DIRECCION_DB: Role[] = ["SUPER_ADMIN", "OWNER", "ADMIN"];

/**
 * Destinatarios del recordatorio.
 *
 * Ambos valores existen en `UserRole` (guards de ruta) y tienen
 * `reports:manage` (ejecutar la corrida). `OWNER` queda fuera a propósito: el
 * enum de la DB lo admite, pero el RBAC de rutas no lo reconoce, así que el
 * `actionUrl` del aviso estaría bloqueado. Unificar `Role`/`UserRole` es una
 * tarea transversal, no parte de este lote.
 */
export const ROLES_RECORDATORIO: readonly UserRole[] = ["SUPER_ADMIN", "ADMIN"];

/** Estado del aguinaldo de una empresa en el año causado. */
export type EstadoAguinaldo = "SIN_CORRIDA" | "EN_PROCESO" | "TIMBRADO";

export interface EstadoAguinaldoEmpresa {
  companyId: string;
  anioFiscal: number;
  estado: EstadoAguinaldo;
  /** Estado crudo de la corrida del año; `null` si no existe. */
  estadoCorrida: string | null;
  /**
   * `true` sólo con la corrida en `COMPLETED` (todos los recibos timbrados).
   * Nunca significa que el dinero haya salido.
   */
  timbradoCompleto: boolean;
}

/**
 * Clasificación pura del estado. Se separa de la consulta para poder probar
 * cada transición sin base de datos.
 *
 * `COMPLETED_WITH_ERRORS`, `PROCESSING`, `DRAFT` y `ERROR` son `EN_PROCESO`:
 * el timbrado no terminó para todos los recibos.
 */
export function clasificarEstadoAguinaldo(estadoCorrida: string | null): EstadoAguinaldo {
  if (!estadoCorrida) return "SIN_CORRIDA";
  return estadoCorrida === "COMPLETED" ? "TIMBRADO" : "EN_PROCESO";
}

/**
 * Lee la corrida de aguinaldo de UNA empresa dentro de su contexto.
 *
 * El `companyId` viene del evento/job autorizado, nunca del cliente HTTP. La
 * transacción es breve y no envuelve al PAC ni a ningún proveedor.
 */
export async function leerEstadoAguinaldo(
  companyId: string,
  anioFiscal: number,
  client: typeof db = db,
): Promise<EstadoAguinaldoEmpresa> {
  return withCompanyContext(
    { companyId },
    async (tx) => {
      const [corrida] = await tx
        .select({ status: payrollRuns.status })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.companyId, companyId),
            eq(payrollRuns.aguinaldoFiscalYear, anioFiscal),
          ),
        )
        // El índice parcial garantiza una corrida por empresa/año; `desc` deja
        // determinista una fila histórica anterior al índice.
        .orderBy(desc(payrollRuns.createdAt))
        .limit(1);

      const estadoCorrida = corrida?.status ?? null;
      return {
        companyId,
        anioFiscal,
        estado: clasificarEstadoAguinaldo(estadoCorrida),
        estadoCorrida,
        timbradoCompleto: estadoCorrida === "COMPLETED",
      };
    },
    client,
  );
}

export interface EmpresasRecordatorio {
  /** Empresas con al menos un destinatario reconocido por el RBAC de rutas. */
  conDestinatario: string[];
  /**
   * Empresas con dirección en la DB pero sin rol reconocido (p. ej. sólo
   * `OWNER`). No se notifican: el aviso no tendría acción posible. Se reportan
   * para que la brecha no desaparezca del resultado del job.
   */
  sinDestinatario: string[];
}

/**
 * Enumera empresas con dirección activa y separa las que tienen destinatario
 * válido. `users` todavía no tiene RLS en este lote, así que la enumeración no
 * necesita contexto; la lectura de `payroll_runs` sí (ver `leerEstadoAguinaldo`).
 */
export async function enumerarEmpresasRecordatorio(
  client: typeof db = db,
): Promise<EmpresasRecordatorio> {
  const filas = await client
    .select({ companyId: users.companyId, role: users.role })
    .from(users)
    .where(and(inArray(users.role, ROLES_DIRECCION_DB), eq(users.active, true)));

  const reconocidos = new Set<string>(ROLES_RECORDATORIO);
  const conDestinatario = new Set<string>();
  const sinDestinatario = new Set<string>();

  for (const fila of filas) {
    if (!fila.companyId) continue;
    if (fila.role && reconocidos.has(fila.role)) conDestinatario.add(fila.companyId);
    else sinDestinatario.add(fila.companyId);
  }

  for (const companyId of conDestinatario) sinDestinatario.delete(companyId);

  return {
    conDestinatario: [...conDestinatario],
    sinDestinatario: [...sinDestinatario],
  };
}

/** Usuarios activos por empresa, acotados a los destinatarios reconocidos. */
export async function destinatariosPorEmpresa(
  companyIds: readonly string[],
  client: typeof db = db,
): Promise<Record<string, string[]>> {
  if (companyIds.length === 0) return {};

  const filas = await client
    .select({ id: users.id, companyId: users.companyId })
    .from(users)
    .where(
      and(
        inArray(users.companyId, [...companyIds]),
        inArray(users.role, [...ROLES_RECORDATORIO]),
        eq(users.active, true),
      ),
    );

  const mapa: Record<string, string[]> = {};
  for (const fila of filas) {
    if (!fila.companyId) continue;
    (mapa[fila.companyId] ??= []).push(fila.id);
  }
  return mapa;
}

export interface RecordatorioAguinaldo {
  estado: EstadoAguinaldo;
  titulo: string;
  mensaje: string;
  tipo: "info" | "warning" | "error";
  eventType: NotificationEventType;
  /** Clave lógica de deduplicación (empresa + año + estado). */
  dedupe: string;
}

/**
 * Construye el aviso según el estado. Nunca afirma que el aguinaldo esté
 * pagado: el sistema no tiene una confirmación de pago de nómina (NOM-05) y el
 * timbre del CFDI no la sustituye.
 */
export function construirRecordatorio(estado: EstadoAguinaldoEmpresa): RecordatorioAguinaldo {
  const anio = estado.anioFiscal;
  const dedupe = `aguinaldo-${estado.companyId}-${anio}-${estado.estado}`;

  if (estado.estado === "SIN_CORRIDA") {
    return {
      estado: estado.estado,
      titulo: `Recordatorio: dispersar el aguinaldo ${anio} antes del ${LIMITE_AGUINALDO}`,
      mensaje:
        `No hay corrida de aguinaldo ${anio} registrada. El Art. 87 LFT obliga a pagarlo antes del ` +
        `${LIMITE_AGUINALDO} (multa de 50 a 5,000 UMA por incumplir, Art. 1002). Cálculo vigente: ` +
        `15 días por año prorrateados. Timbra la nómina extraordinaria (CFDI 002) desde Personal → ` +
        `Payroll → Aguinaldo ${anio} y registra la dispersión real cuando el dinero haya salido.`,
      tipo: "warning",
      eventType: "aguinaldo_dispersion_reminder",
      dedupe,
    };
  }

  if (estado.estado === "EN_PROCESO") {
    return {
      estado: estado.estado,
      titulo: `Aguinaldo ${anio}: la corrida no ha terminado de timbrarse`,
      mensaje:
        `La corrida de aguinaldo ${anio} está en estado ${estado.estadoCorrida ?? "desconocido"} y ` +
        `todavía no tiene todos los recibos timbrados. Un timbre pendiente no acredita el pago: ` +
        `completa el timbrado y registra la dispersión real antes del ${LIMITE_AGUINALDO} ` +
        `(Art. 87 LFT).`,
      tipo: "warning",
      eventType: "aguinaldo_dispersion_reminder",
      dedupe,
    };
  }

  return {
    estado: estado.estado,
    titulo: `Aguinaldo ${anio}: timbrado, dispersión sin confirmar`,
    mensaje:
      `La corrida de aguinaldo ${anio} ya está timbrada (CFDI 002). El timbre acredita la nómina ` +
      `extraordinaria, no la entrega del dinero: el sistema no puede confirmar el pago desde el ` +
      `CFDI. Registra la dispersión real cuando el dinero haya salido; el plazo legal vence el ` +
      `${LIMITE_AGUINALDO} (Art. 87 LFT).`,
    tipo: "info",
    eventType: "aguinaldo_dispersion_reminder",
    dedupe,
  };
}

/** Verdad de la dependencia de roles: destinatario válido = RBAC + reports:manage. */
export function esDestinatarioValido(role: string): boolean {
  return (
    (ROLES_RECORDATORIO as readonly string[]).includes(role) &&
    hasPermission(role as Role, "reports", "manage")
  );
}
