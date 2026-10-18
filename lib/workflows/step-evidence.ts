/**
 * EVI-01 (Fase 2) — sincronización de evidencia de un paso de workflow hacia el
 * registro canónico `evidence`.
 *
 * Durante la migración por dominio el paso conserva su columna
 * `workflow_instance_steps.evidence_url` (fuente de lectura actual, ya acotada
 * por empresa/sucursal/actor en la ruta de evidencias). Aquí se refleja el mismo
 * valor en `evidence` para que exista una entidad durable y uniforme.
 *
 * Regla anti-duplicado: el paso *reemplaza* su evidencia al reenviarse. Por eso
 * se borran las filas canónicas previas de ese paso y se insertan las actuales
 * en una transacción, en vez de acumular una fila por cada guardado.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { evidence } from "@/lib/db/schema";
import { EvidenceStore } from "@/lib/services/evidence-store";

/**
 * Normaliza el valor de evidencia de un paso a una lista de URLs/keys.
 * Acepta un string simple (URL o key) o un arreglo serializado en JSON; ignora
 * entradas vacías o no-string.
 */
export function parseStepEvidenceUrls(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      // No es JSON válido: se trata como un string simple.
    }
  }
  return [trimmed];
}

export interface SyncStepEvidenceParams {
  companyId: string;
  branchId?: string | null;
  /** Id de la fila `workflow_instance_steps` (entidad del adjunto). */
  stepRowId: string;
  /** Valor crudo de `evidence_url` (string o arreglo JSON serializado). */
  evidenceUrl: unknown;
  createdBy?: string;
}

/**
 * Refleja la evidencia del paso en la tabla canónica. Devuelve cuántas filas
 * quedaron registradas. No lanza por URLs vacías (no-op).
 */
export async function syncStepEvidence(params: SyncStepEvidenceParams): Promise<number> {
  const urls = parseStepEvidenceUrls(params.evidenceUrl);

  await db.transaction(async (tx) => {
    await tx
      .delete(evidence)
      .where(
        and(
          eq(evidence.companyId, params.companyId),
          eq(evidence.entityType, "WORKFLOW_STEP"),
          eq(evidence.entityId, params.stepRowId),
        ),
      );

    for (const url of urls) {
      await EvidenceStore.store(
        {
          companyId: params.companyId,
          branchId: params.branchId ?? undefined,
          entityType: "WORKFLOW_STEP",
          entityId: params.stepRowId,
          kind: "PHOTO",
          url,
          createdBy: params.createdBy,
        },
        tx,
      );
    }
  });

  return urls.length;
}
