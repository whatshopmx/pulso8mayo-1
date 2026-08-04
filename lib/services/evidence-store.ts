/**
 * EvidenceStore — unified evidence facade (Sprint 1 Task 5 foundation).
 *
 * Source: docs/pulso-executive-os-v2.md §6 (Evidence Store foundation).
 *
 * Today, evidence is scattered: `incidents.evidence_url`,
 * `workflow_instance_steps.evidence_url`, `workflow_templates.evidence_url`,
 * and ad-hoc document uploads to R2. This class provides ONE API to store and
 * retrieve evidence regardless of source, plus AI metadata fields the Sprint 2
 * engines will populate (transcription for voice notes, classification for
 * photos, verificationResult for AI-checked evidence).
 *
 * Sprint 1 scope (foundation): the API + types are canonical; the registry is
 * in-process. Persistence into a dedicated `evidence` table + R2 listing is
 * deferred to the first Sprint 2 engine that needs cross-request durability —
 * adding a table now without a consumer would be speculative (Rule 0). The
 * `store()` method already pushes the binary to R2 when a buffer is supplied,
 * so the file is durable even though the index is not.
 */
import { randomUUID } from "node:crypto";
import { uploadToR2, isR2Configured } from "@/lib/storage/r2-client";

export type EvidenceKind = "PHOTO" | "FILE" | "VOICE" | "VIDEO";
export type EvidenceEntityType =
  | "WORKFLOW_STEP"
  | "INCIDENT"
  | "DOCUMENT"
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
  /** R2 URL when uploaded, or a caller-supplied reference for pre-stored media. */
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

class EvidenceStoreImpl {
  /** In-process registry — see module doc on persistence deferral. */
  private readonly registry = new Map<string, EvidenceRecord>();

  /**
   * Store evidence. When `buffer` is supplied and R2 is configured, the binary
   * is uploaded and `url`/`storageKey` are set from the upload result. When R2
   * is not configured (local dev), the record is registered with the caller's
   * `url` (or a placeholder) so the API still type-checks and tests can run.
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

    const record: EvidenceRecord = {
      id,
      entityType: input.entityType,
      entityId: input.entityId,
      branchId: input.branchId,
      companyId: input.companyId,
      url,
      storageKey,
      mimeType: input.mimeType,
      kind: input.kind,
      aiMetadata: input.aiMetadata ?? {},
      createdAt: new Date(),
      createdBy: input.createdBy,
    };
    this.registry.set(id, record);
    return record;
  }

  /** All evidence attached to a given entity (e.g. a workflow step or incident). */
  getByEntity(entityType: EvidenceEntityType, entityId: string): EvidenceRecord[] {
    return [...this.registry.values()].filter(
      (r) => r.entityType === entityType && r.entityId === entityId,
    );
  }

  /** All evidence captured at a branch. */
  getByBranch(branchId: string): EvidenceRecord[] {
    return [...this.registry.values()].filter((r) => r.branchId === branchId);
  }

  /** Attach or merge AI-derived metadata onto an existing evidence record. */
  attachMetadata(id: string, aiMetadata: EvidenceAiMetadata): EvidenceRecord | null {
    const record = this.registry.get(id);
    if (!record) return null;
    record.aiMetadata = {
      ...record.aiMetadata,
      ...aiMetadata,
      // Deep-merge verificationResult/labels so partial updates don't wipe them.
      verificationResult: aiMetadata.verificationResult ?? record.aiMetadata.verificationResult,
      labels: aiMetadata.labels ?? record.aiMetadata.labels,
      transcription: aiMetadata.transcription ?? record.aiMetadata.transcription,
      classification: aiMetadata.classification ?? record.aiMetadata.classification,
    };
    return record;
  }

  /** Test-only: reset the in-process registry. */
  __resetForTests(): void {
    this.registry.clear();
  }
}

/** Singleton — evidence is app-global state within a process. */
export const EvidenceStore = new EvidenceStoreImpl();