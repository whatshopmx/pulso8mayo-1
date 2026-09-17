/**
 * Servicio de resoluciones de la Cola de Decisiones ejecutiva.
 *
 * CRUD mínimo sobre `executive_decisions` (ver schema): la cabina ejecutiva
 * hidrata las resoluciones vigentes al montar y persiste cada despacho con
 * actualización optimista. `revoke` borra la fila — "Deshacer" devuelve el
 * caso a pendiente de verdad, no sólo en la memoria del cliente.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { executiveDecisions } from "@/lib/db/schema";
import type { ExecutiveDecisionResolution } from "@/lib/services/intelligence/types";

export interface ExecutiveDecisionRecord {
  decisionKey: string;
  resolution: ExecutiveDecisionResolution;
  resolvedByName: string | null;
  resolvedAt: Date;
}

export class ExecutiveDecisionService {
  /** Resoluciones vigentes de una compañía, indexadas por clave de caso. */
  static async list(companyId: string): Promise<Record<string, ExecutiveDecisionRecord>> {
    if (!companyId) return {};

    const rows = await db
      .select({
        decisionKey: executiveDecisions.decisionKey,
        resolution: executiveDecisions.resolution,
        resolvedByName: executiveDecisions.resolvedByName,
        resolvedAt: executiveDecisions.resolvedAt,
      })
      .from(executiveDecisions)
      .where(eq(executiveDecisions.companyId, companyId));

    const byKey: Record<string, ExecutiveDecisionRecord> = {};
    for (const row of rows) {
      byKey[row.decisionKey] = {
        decisionKey: row.decisionKey,
        resolution: row.resolution as ExecutiveDecisionResolution,
        resolvedByName: row.resolvedByName,
        resolvedAt: row.resolvedAt,
      };
    }
    return byKey;
  }

  /** Persiste (o actualiza) la resolución de un caso. UPSERT por (companyId, decisionKey). */
  static async resolve(params: {
    companyId: string;
    decisionKey: string;
    resolution: ExecutiveDecisionResolution;
    userId: string;
    userName: string | null;
  }): Promise<void> {
    const { companyId, decisionKey, resolution, userId, userName } = params;
    if (!companyId || !decisionKey) {
      throw new Error("companyId y decisionKey son obligatorios");
    }
    if (resolution !== "authorized" && resolution !== "deferred") {
      throw new Error(`Resolución inválida: ${resolution}`);
    }

    await db
      .insert(executiveDecisions)
      .values({
        companyId,
        decisionKey,
        resolution,
        resolvedBy: userId,
        resolvedByName: userName,
        resolvedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [executiveDecisions.companyId, executiveDecisions.decisionKey],
        set: {
          resolution,
          resolvedBy: userId,
          resolvedByName: userName,
          resolvedAt: new Date(),
        },
      });
  }

  /** Revoca la resolución de un caso (acción "Deshacer" de la cola). */
  static async revoke(params: { companyId: string; decisionKey: string }): Promise<void> {
    const { companyId, decisionKey } = params;
    if (!companyId || !decisionKey) {
      throw new Error("companyId y decisionKey son obligatorios");
    }

    await db
      .delete(executiveDecisions)
      .where(
        and(
          eq(executiveDecisions.companyId, companyId),
          eq(executiveDecisions.decisionKey, decisionKey)
        )
      );
  }
}
