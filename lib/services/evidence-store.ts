/**
 * EvidenceStore — unified evidence facade (Fase 2 / EVI-01).
 *
 * Antes el registro vivía en un `Map` en memoria y sin filtro de empresa. Ahora
 * cada adjunto se persiste en la tabla `evidence` (empresa, sucursal, entidad de
 * origen, autor, tipo y clave de almacenamiento), de modo que la evidencia sigue
 * consultable tras reiniciar el proceso y toda alta/lectura/borrado exige el
 * `companyId` del actor (frontera de tenant).
 *
 * Alcance de este recorrido: la API + persistencia. Los dominios que todavía
 * guardan `evidence_url` (pasos de workflow, gastos, OS, mermas) conservan su
 * columna durante la migración por dominio; su wiring a esta tabla se cierra en
 * la tarea del recorrido correspondiente.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { evidence } from "@/lib/db/schema";
import { uploadToR2, isR2Configured } from "@/lib/storage/r2-client";

export type EvidenceKind = "PHOTO" | "FILE" | "VOICE" | "VIDEO" | "TEXT";
export type EvidenceEntityType =
  | "WORKFLOW_STEP"
  | "INCIDENT"
  | "DOCUMENT"
  | "EXPENSE"
  | "SERVICE_ORDER"
  | "WASTE"
  | "RECEIVING"
  | "GENERAL";

/** AI-derived metadata attached to evidence (Sprint 2 engines populate these). */
export interface EvidenceAiMetadata {
  /** Voice-note transcript (VOICE). */
  transcription?: string;
  /** Auto-classification label, e.g. "cleaning_checklist" | "invoice". */
  classification?: string;
  /** AI verification outcome — confidence 0-1 plus pass/fail. */
  verificationResult?: {
    passed: boolean;
    confidence: number;
    notes?: string;
  };
  /** Free-form labels from engines. */
  labels?: string[];
}

export interface EvidenceRecord {
  id: string;
  entityType: EvidenceEntityType;
  entityId: string;
  branchId?: string;
  companyId: string;
  /** R2 object key (private model) or a legacy/caller-supplied reference. */
  url: string;
  /** R2 object key when uploaded via this store. */
  storageKey?: string;
  mimeType?: string;
  kind: EvidenceKind;
  aiMetadata: EvidenceAiMetadata;
  createdAt: Date;
  createdBy?: string;
}

export interface StoreEvidenceInput {
  entityType: EvidenceEntityType;
  entityId: string;
  companyId: string;
  branchId?: string;
  kind: EvidenceKind;
  mimeType?: string;
  /** Binary to persist in R2. Omit when the media already lives somewhere and `url` is provided. */
  buffer?: Buffer;
  /** Pre-existing reference (e.g. an existing evidence_url) when no buffer is supplied. */
  url?: string;
  createdBy?: string;
  aiMetadata?: EvidenceAiMetadata;
}

type EvidenceRow = typeof evidence.$inferSelect;

function toRecord(row: EvidenceRow): EvidenceRecord {
  return {
    id: row.id,
    entityType: row.entityType as EvidenceEntityType,
    entityId: row.entityId,
    branchId: row.branchId ?? undefined,
    companyId: row.companyId,
    url: row.url,
    storageKey: row.storageKey ?? undefined,
    mimeType: row.mimeType ?? undefined,
    kind: row.kind as EvidenceKind,
    aiMetadata: (row.aiMetadata as EvidenceAiMetadata | null) ?? {},
    createdAt: row.createdAt,
    createdBy: row.createdBy ?? undefined,
  };
}

class EvidenceStoreImpl {
  /**
   * Store evidence. When `buffer` is supplied and R2 is configured, the binary
   * is uploaded and `url`/`storageKey` are set from the upload result. When R2
   * is not configured (local dev), the record is persisted with the caller's
   * `url` (or a placeholder) so the API still works and tests can run.
   */
  async store(input: StoreEvidenceInput): Promise<EvidenceRecord> {
    const id = randomUUID();
    let url = input.url ?? "";
    let storageKey: string | undefined;

    if (input.buffer) {
      if (isR2Configured()) {
        const timestamp = Date.now();
        storageKey = `companies/${input.companyId}/evidence/${input.entityType.toLowerCase()}/${timestamp}_${id}`;
        url = await uploadToR2(
          input.buffer,
          storageKey,
          input.mimeType ?? "application/octet-stream",
          {
            "x-evidence-entity": `${input.entityType}:${input.entityId}`,
            "x-evidence-kind": input.kind,
            "x-evidence-company": input.companyId,
          },
        );
      } else {
        // Dev fallback — no R2 credentials; keep the API working for tests.
        url = url || `local://evidence/${id}`;
      }
    }

    const [row] = await db
      .insert(evidence)
      .values({
        id,
        companyId: input.companyId,
        branchId: input.branchId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        kind: input.kind,
        mimeType: input.mimeType ?? null,
        url,
        storageKey: storageKey ?? null,
        aiMetadata: input.aiMetadata ?? {},
        createdBy: input.createdBy ?? null,
      })
      .returning();

    return toRecord(row);
  }

  /** All live evidence attached to a given entity, scoped to the company. */
  async getByEntity(
    companyId: string,
    entityType: EvidenceEntityType,
    entityId: string,
  ): Promise<EvidenceRecord[]> {
    const rows = await db
      .select()
      .from(evidence)
      .where(
        and(
          eq(evidence.companyId, companyId),
          eq(evidence.entityType, entityType),
          eq(evidence.entityId, entityId),
          isNull(evidence.deletedAt),
        ),
      )
      .orderBy(desc(evidence.createdAt));
    return rows.map(toRecord);
  }

  /** All live evidence captured at a branch, scoped to the company. */
  async getByBranch(companyId: string, branchId: string): Promise<EvidenceRecord[]> {
    const rows = await db
      .select()
      .from(evidence)
      .where(
        and(
          eq(evidence.companyId, companyId),
          eq(evidence.branchId, branchId),
          isNull(evidence.deletedAt),
        ),
      )
      .orderBy(desc(evidence.createdAt));
    return rows.map(toRecord);
  }

  /** One record by id, only if it belongs to the company. */
  async getById(companyId: string, id: string): Promise<EvidenceRecord | null> {
    const [row] = await db
      .select()
      .from(evidence)
      .where(
        and(
          eq(evidence.companyId, companyId),
          eq(evidence.id, id),
          isNull(evidence.deletedAt),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }

  /** Attach or merge AI-derived metadata onto an existing evidence record. */
  async attachMetadata(
    companyId: string,
    id: string,
    aiMetadata: EvidenceAiMetadata,
  ): Promise<EvidenceRecord | null> {
    const current = await this.getById(companyId, id);
    if (!current) return null;

    const merged: EvidenceAiMetadata = {
      ...current.aiMetadata,
      ...aiMetadata,
      // Deep-merge verificationResult/labels so partial updates don't wipe them.
      verificationResult: aiMetadata.verificationResult ?? current.aiMetadata.verificationResult,
      labels: aiMetadata.labels ?? current.aiMetadata.labels,
      transcription: aiMetadata.transcription ?? current.aiMetadata.transcription,
      classification: aiMetadata.classification ?? current.aiMetadata.classification,
    };

    const [row] = await db
      .update(evidence)
      .set({ aiMetadata: merged, updatedAt: new Date() })
      .where(and(eq(evidence.companyId, companyId), eq(evidence.id, id)))
      .returning();
    return row ? toRecord(row) : null;
  }

  /**
   * Soft-delete a record. Only the owning company can delete; a foreign
   * companyId matches no row and returns false.
   */
  async softDelete(companyId: string, id: string): Promise<boolean> {
    const rows = await db
      .update(evidence)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(evidence.companyId, companyId),
          eq(evidence.id, id),
          isNull(evidence.deletedAt),
        ),
      )
      .returning({ id: evidence.id });
    return rows.length > 0;
  }
}

/** Singleton — the registry is the `evidence` table, not process memory. */
export const EvidenceStore = new EvidenceStoreImpl();
