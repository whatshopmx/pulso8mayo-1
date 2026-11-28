/**
 * APR-01 — Servicio transversal de aprobaciones de documentos financieros
 * (`OC`, `OS`, `EXPENSE`, `PAYMENT_RUN`, `PAYROLL`).
 *
 * Garantías:
 * 1. Declara versión aprobada monotónica (`approvalVersion`), huella material
 *    (`materialFingerprint`) y autoridad (`requiredRole`, `authoritySource`,
 *    `approvedBy`, `approvedByRole`, `secondaryApprovedBy`).
 * 2. Serializa mutaciones por `(companyId, docType, docId)` con
 *    `pg_advisory_xact_lock` y garantiza a nivel SQL (índice único parcial) que
 *    nunca coexistan dos versiones `APPROVED` activas para el mismo documento.
 * 3. Detecta cambios materiales (`checkAndInvalidateOnMaterialChange`):
 *    - Cambios cosméticos conservan la aprobación vigente.
 *    - Cambios materiales invalidan la versión aprobada (`INVALIDATED` con
 *      `changedFields`) y devuelven el documento especializado a re-aprobación
 *      (en `PAYROLL` conserva la inmutabilidad `NOM-03` y rechaza con `409`).
 * 4. Toda aprobación e invalidación escribe auditoría crítica `AUD-02` en la
 *    misma transacción: si falla la auditoría, todo revierte sin estado parcial.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  approvalRequests,
  documentApprovals,
  invoices,
  operatingExpenses,
  paymentApprovals,
  paymentRuns,
  purchaseOrders,
  serviceOrders,
} from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import type { BranchScope } from "@/lib/branch-scope";
import { AuditService } from "./audit-service";
import type { DbExecutor } from "./fefo-allocator";
import {
  auditEntityTypeForDocument,
  computeDocumentMaterialFingerprint,
  detectMaterialChange,
  extractDocumentBranchId,
  validateDeclaredAuthority,
  type ApprovalDocumentType,
  type DocumentAuthorityDeclaration,
  type DocumentMaterialPayloadMap,
} from "./document-approval-rules";

export type DocumentApprovalRow = typeof documentApprovals.$inferSelect;

export interface RecordDocumentApprovalResult {
  approval: DocumentApprovalRow;
  created: boolean;
  idempotent: boolean;
  previousVersionInvalidated: number | null;
}

export interface MaterialChangeCheckResult {
  hadApproval: boolean;
  invalidated: boolean;
  approvalVersion: number | null;
  changedFields: string[];
  approvedFingerprint: string | null;
  currentFingerprint: string;
  newDocStatus: string | null;
}

/**
 * Registra una aprobación canónica declarando versión aprobada, huella material
 * y autoridad, con auditoría `AUD-02` atómica en la misma transacción.
 */
export async function recordDocumentApproval<T extends ApprovalDocumentType>(
  params: {
    companyId: string;
    docType: T;
    docId: string;
    branchId?: string | null;
    materialPayload: DocumentMaterialPayloadMap[T];
    authority: DocumentAuthorityDeclaration;
    actorScope?: BranchScope;
    requesterId?: string | null;
    evidenceId?: string | null;
    expectedVersion?: number;
    requireReason?: boolean;
    reason?: string | null;
    now?: Date;
  },
  executor?: DbExecutor,
): Promise<RecordDocumentApprovalResult> {
  const effectiveBranchId =
    params.branchId ?? extractDocumentBranchId(params.docType, params.materialPayload);

  if (
    params.reason !== undefined &&
    params.reason !== null &&
    params.reason.trim().length > 0 &&
    params.reason.trim().length < 4
  ) {
    throw ApiError.badRequest("El motivo de aprobación debe tener al menos 4 caracteres.");
  }

  const verdict = validateDeclaredAuthority({
    docType: params.docType,
    authority: params.authority,
    requesterId: params.requesterId,
    actorScope: params.actorScope,
    docBranchId: effectiveBranchId,
    requireReason: params.requireReason,
    reason: params.reason,
  });
  if ("code" in verdict) {
    if (verdict.code === "DUAL_APPROVAL") {
      throw ApiError.conflict(verdict.reason);
    }
    if (verdict.code === "REASON") {
      throw ApiError.badRequest(verdict.reason);
    }
    throw ApiError.forbidden(verdict.reason);
  }

  const { fingerprint, snapshot } = computeDocumentMaterialFingerprint(
    params.docType,
    params.materialPayload,
  );
  const now = params.now ?? new Date();
  const auditReason =
    params.reason && params.reason.trim().length >= 4
      ? params.reason.trim()
      : `Aprobación de ${params.docType} ${params.docId} por ${params.authority.actualActorRole} (${params.authority.authoritySource})`;

  const run = async (tx: DbExecutor): Promise<RecordDocumentApprovalResult> => {
    if (typeof (tx as { execute?: unknown }).execute === "function") {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${params.companyId}:${params.docType}:${params.docId}`}, 604))`,
      );
    }

    const history = await tx
      .select()
      .from(documentApprovals)
      .where(
        and(
          eq(documentApprovals.companyId, params.companyId),
          eq(documentApprovals.docType, params.docType),
          eq(documentApprovals.docId, params.docId),
        ),
      )
      .orderBy(desc(documentApprovals.approvalVersion));

    const latestVersion = history[0]?.approvalVersion ?? 0;
    if (params.expectedVersion !== undefined && latestVersion !== params.expectedVersion) {
      throw ApiError.conflict(
        `Conflicto de concurrencia en aprobación de ${params.docType} ${params.docId}: se esperaba versión ${params.expectedVersion}, pero la versión vigente es ${latestVersion}.`,
      );
    }

    const active = history.find((h) => h.status === "APPROVED") ?? null;
    if (active && active.materialFingerprint === fingerprint) {
      return {
        approval: active,
        created: false,
        idempotent: true,
        previousVersionInvalidated: null,
      };
    }

    let previousVersionInvalidated: number | null = null;
    if (active) {
      const diff = detectMaterialChange(
        params.docType,
        active.materialSnapshot as Record<string, unknown>,
        snapshot,
      );
      await tx
        .update(documentApprovals)
        .set({
          status: "INVALIDATED",
          invalidatedAt: now,
          invalidatedBy: params.authority.approverId,
          invalidationReason: "Sustituida por una nueva versión aprobada tras cambio material.",
          changedFields: diff.changedFields,
        })
        .where(
          and(
            eq(documentApprovals.id, active.id),
            eq(documentApprovals.companyId, params.companyId),
          ),
        );
      previousVersionInvalidated = active.approvalVersion;
    }

    const nextVersion = latestVersion + 1;

    const [created] = await tx
      .insert(documentApprovals)
      .values({
        companyId: params.companyId,
        branchId: effectiveBranchId,
        docType: params.docType,
        docId: params.docId,
        approvalVersion: nextVersion,
        status: "APPROVED",
        materialFingerprint: fingerprint,
        materialSnapshot: snapshot,
        requiredRole: params.authority.requiredRole,
        authoritySource: params.authority.authoritySource,
        approvedBy: params.authority.approverId,
        approvedByRole: params.authority.actualActorRole,
        secondaryApprovedBy: params.authority.secondaryApproverId ?? null,
        approvalReason: auditReason,
        evidenceId: params.evidenceId ?? null,
        approvedAt: now,
      })
      .returning();

    await AuditService.logCriticalEmployeeAction(
      {
        userId: params.authority.approverId,
        performedBy: params.authority.approverId,
        action: "CREATE",
        entityType: auditEntityTypeForDocument(params.docType),
        entityId: params.docId,
        oldValue: active
          ? {
              approvalVersion: active.approvalVersion,
              materialFingerprint: active.materialFingerprint,
              status: active.status,
            }
          : null,
        newValue: {
          docType: params.docType,
          docId: params.docId,
          branchId: created.branchId,
          approvalVersion: created.approvalVersion,
          materialFingerprint: created.materialFingerprint,
          requiredRole: created.requiredRole,
          authoritySource: created.authoritySource,
          approvedBy: created.approvedBy,
          approvedByRole: created.approvedByRole,
          secondaryApprovedBy: created.secondaryApprovedBy,
          approvalReason: created.approvalReason,
          evidenceId: created.evidenceId,
        },
        reason: auditReason,
        isCritical: true,
      },
      tx,
    );

    return {
      approval: created,
      created: true,
      idempotent: false,
      previousVersionInvalidated,
    };
  };

  if (executor && executor !== db) return run(executor);
  return db.transaction(async (tx) => run(tx));
}

/**
 * Evalúa si los campos materiales actuales difieren de la versión aprobada.
 * - Si NO hay cambio material → mantiene la aprobación vigente intacta.
 * - Si HAY cambio material → marca `INVALIDATED`, audita en `AUD-02` y
 *   devuelve el documento especializado al estado que exige re-aprobación
 *   (en `PAYROLL` conserva la inmutabilidad NOM-03 rechazando con `409` si
 *   se intenta mutar un snapshot ya aprobado).
 */
export async function checkAndInvalidateOnMaterialChange<T extends ApprovalDocumentType>(
  params: {
    companyId: string;
    docType: T;
    docId: string;
    currentMaterialPayload: DocumentMaterialPayloadMap[T];
    actorId: string;
    reason?: string | null;
    now?: Date;
  },
  executor?: DbExecutor,
): Promise<MaterialChangeCheckResult> {
  const { fingerprint: currentFingerprint, snapshot: currentSnapshot } =
    computeDocumentMaterialFingerprint(params.docType, params.currentMaterialPayload);
  const now = params.now ?? new Date();

  const run = async (tx: DbExecutor): Promise<MaterialChangeCheckResult> => {
    if (typeof (tx as { execute?: unknown }).execute === "function") {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${params.companyId}:${params.docType}:${params.docId}`}, 604))`,
      );
    }

    const [active] = await tx
      .select()
      .from(documentApprovals)
      .where(
        and(
          eq(documentApprovals.companyId, params.companyId),
          eq(documentApprovals.docType, params.docType),
          eq(documentApprovals.docId, params.docId),
          eq(documentApprovals.status, "APPROVED"),
        ),
      )
      .orderBy(desc(documentApprovals.approvalVersion))
      .limit(1);

    if (!active) {
      return {
        hadApproval: false,
        invalidated: false,
        approvalVersion: null,
        changedFields: [],
        approvedFingerprint: null,
        currentFingerprint,
        newDocStatus: null,
      };
    }

    const diff = detectMaterialChange(
      params.docType,
      active.materialSnapshot as Record<string, unknown>,
      currentSnapshot,
    );

    if (!diff.isMaterialChange) {
      return {
        hadApproval: true,
        invalidated: false,
        approvalVersion: active.approvalVersion,
        changedFields: [],
        approvedFingerprint: active.materialFingerprint,
        currentFingerprint,
        newDocStatus: null,
      };
    }

    const invalidationReason =
      params.reason && params.reason.trim().length >= 4
        ? params.reason.trim()
        : `Invalidación por cambio material en ${params.docType} (campos: ${diff.changedFields.join(", ")})`;

    await tx
      .update(documentApprovals)
      .set({
        status: "INVALIDATED",
        invalidatedAt: now,
        invalidatedBy: params.actorId,
        invalidationReason,
        changedFields: diff.changedFields,
      })
      .where(
        and(
          eq(documentApprovals.id, active.id),
          eq(documentApprovals.companyId, params.companyId),
        ),
      );

    // Sincronizar el documento especializado para exigir re-aprobación
    let newDocStatus: string | null = null;
    if (params.docType === "OC") {
      const [po] = await tx
        .update(purchaseOrders)
        .set({
          status: "PENDING_APPROVAL",
          approvedBy: null,
          approvedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(purchaseOrders.id, params.docId),
            eq(purchaseOrders.companyId, params.companyId),
            eq(purchaseOrders.status, "APPROVED"),
          ),
        )
        .returning({ status: purchaseOrders.status });
      if (po) {
        await tx
          .update(approvalRequests)
          .set({
            status: "REJECTED",
            resolvedBy: params.actorId,
            resolvedAt: now,
            reason: invalidationReason,
          })
          .where(
            and(
              eq(approvalRequests.companyId, params.companyId),
              eq(approvalRequests.docType, "OC"),
              eq(approvalRequests.docId, params.docId),
              eq(approvalRequests.status, "APPROVED"),
            ),
          );
        newDocStatus = po.status;
      }
    } else if (params.docType === "OS") {
      const [so] = await tx
        .update(serviceOrders)
        .set({
          status: "DRAFT",
          updatedAt: now,
        })
        .where(
          and(
            eq(serviceOrders.id, params.docId),
            eq(serviceOrders.companyId, params.companyId),
            eq(serviceOrders.status, "APPROVED"),
          ),
        )
        .returning({ status: serviceOrders.status });
      if (so) {
        await tx
          .update(approvalRequests)
          .set({
            status: "REJECTED",
            resolvedBy: params.actorId,
            resolvedAt: now,
            reason: invalidationReason,
          })
          .where(
            and(
              eq(approvalRequests.companyId, params.companyId),
              eq(approvalRequests.docType, "OS"),
              eq(approvalRequests.docId, params.docId),
              eq(approvalRequests.status, "APPROVED"),
            ),
          );
        newDocStatus = so.status;
      }
    } else if (params.docType === "INVOICE") {
      const [inv] = await tx
        .update(invoices)
        .set({
          matchStatus: "DISCREPANCY",
          exceptionApprovedBy: null,
          exceptionApprovedAt: null,
          exceptionReason: `Re-aprobación requerida: ${invalidationReason}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(invoices.id, params.docId),
            eq(invoices.companyId, params.companyId),
            inArray(invoices.matchStatus, ["MATCHED", "EXCEPTION_APPROVED"]),
          ),
        )
        .returning({ matchStatus: invoices.matchStatus });
      newDocStatus = inv?.matchStatus ?? null;
    } else if (params.docType === "EXPENSE") {
      const [exp] = await tx
        .update(operatingExpenses)
        .set({
          status: "PENDING_APPROVAL",
          approvedBy: null,
          overbudgetApprovedBy: null,
          overbudgetApprovedAt: null,
          approvalNotes: `Re-aprobación requerida: ${invalidationReason}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(operatingExpenses.id, params.docId),
            eq(operatingExpenses.companyId, params.companyId),
            eq(operatingExpenses.status, "APPROVED"),
          ),
        )
        .returning({ status: operatingExpenses.status });
      newDocStatus = exp?.status ?? null;
    } else if (params.docType === "PAYMENT_RUN") {
      const [runRow] = await tx
        .update(paymentRuns)
        .set({
          status: "PENDING_APPROVAL",
          approvedBy: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(paymentRuns.id, params.docId),
            eq(paymentRuns.companyId, params.companyId),
            eq(paymentRuns.status, "APPROVED"),
          ),
        )
        .returning({ status: paymentRuns.status });
      if (runRow) {
        await tx
          .update(paymentApprovals)
          .set({
            status: "REJECTED",
            notes: invalidationReason,
          })
          .where(
            and(
              eq(paymentApprovals.companyId, params.companyId),
              eq(paymentApprovals.paymentRef, params.docId),
              eq(paymentApprovals.paymentRefType, "PAYMENT_RUN"),
            ),
          );
        newDocStatus = runRow.status;
      }
    } else if (params.docType === "PAYROLL") {
      // NOM-03 preserva inmutabilidad: la versión aprobada se marca INVALIDATED
      // en el registro transversal y exige emitir un nuevo snapshot/versión.
      newDocStatus = "STALE_REQUIRES_NEW_SNAPSHOT";
    }

    await AuditService.logCriticalEmployeeAction(
      {
        userId: params.actorId,
        performedBy: params.actorId,
        action: "UPDATE",
        entityType: auditEntityTypeForDocument(params.docType),
        entityId: params.docId,
        oldValue: {
          approvalVersion: active.approvalVersion,
          status: "APPROVED",
          materialFingerprint: active.materialFingerprint,
          materialSnapshot: active.materialSnapshot,
        },
        newValue: {
          approvalVersion: active.approvalVersion,
          status: "INVALIDATED",
          currentFingerprint,
          changedFields: diff.changedFields,
          newDocStatus,
        },
        reason: invalidationReason,
        isCritical: true,
      },
      tx,
    );

    return {
      hadApproval: true,
      invalidated: true,
      approvalVersion: active.approvalVersion,
      changedFields: diff.changedFields,
      approvedFingerprint: active.materialFingerprint,
      currentFingerprint,
      newDocStatus,
    };
  };

  if (executor && executor !== db) return run(executor);
  return db.transaction(async (tx) => run(tx));
}

/**
 * Consulta el estado de aprobación canónica y el historial de versiones de un
 * documento dentro de `companyId`.
 */
export async function getDocumentApprovalStatus<T extends ApprovalDocumentType>(
  params: {
    companyId: string;
    docType: T;
    docId: string;
    currentMaterialPayload?: DocumentMaterialPayloadMap[T];
  },
  executor: DbExecutor = db,
) {
  const history = await executor
    .select()
    .from(documentApprovals)
    .where(
      and(
        eq(documentApprovals.companyId, params.companyId),
        eq(documentApprovals.docType, params.docType),
        eq(documentApprovals.docId, params.docId),
      ),
    )
    .orderBy(desc(documentApprovals.approvalVersion));

  const latest = history[0] ?? null;
  const active = history.find((h) => h.status === "APPROVED") ?? null;

  let currentFingerprint: string | null = null;
  let changedFields: string[] = [];
  let isCurrentValid = Boolean(active);

  if (params.currentMaterialPayload) {
    const computed = computeDocumentMaterialFingerprint(
      params.docType,
      params.currentMaterialPayload,
    );
    currentFingerprint = computed.fingerprint;
    if (active) {
      const diff = detectMaterialChange(
        params.docType,
        active.materialSnapshot as Record<string, unknown>,
        computed.snapshot,
      );
      changedFields = diff.changedFields;
      isCurrentValid = !diff.isMaterialChange;
    } else {
      isCurrentValid = false;
    }
  }

  return {
    docType: params.docType,
    docId: params.docId,
    branchId: active?.branchId ?? latest?.branchId ?? null,
    approvedVersion: active?.approvalVersion ?? null,
    latestVersion: latest?.approvalVersion ?? 0,
    status: active ? "APPROVED" : latest ? "INVALIDATED" : "UNAPPROVED",
    isCurrentValid,
    materialFingerprint: active?.materialFingerprint ?? latest?.materialFingerprint ?? null,
    currentFingerprint,
    changedFields,
    authority: active
      ? {
          requiredRole: active.requiredRole,
          authoritySource: active.authoritySource,
          approvedBy: active.approvedBy,
          approvedByRole: active.approvedByRole,
          secondaryApprovedBy: active.secondaryApprovedBy,
          approvalReason: active.approvalReason,
          evidenceId: active.evidenceId,
          approvedAt: active.approvedAt,
        }
      : null,
    history: history.map((h) => ({
      id: h.id,
      branchId: h.branchId,
      approvalVersion: h.approvalVersion,
      status: h.status,
      materialFingerprint: h.materialFingerprint,
      requiredRole: h.requiredRole,
      authoritySource: h.authoritySource,
      approvedBy: h.approvedBy,
      approvedByRole: h.approvedByRole,
      secondaryApprovedBy: h.secondaryApprovedBy,
      approvalReason: h.approvalReason,
      evidenceId: h.evidenceId,
      approvedAt: h.approvedAt,
      invalidatedAt: h.invalidatedAt,
      invalidatedBy: h.invalidatedBy,
      invalidationReason: h.invalidationReason,
      changedFields: h.changedFields ?? [],
    })),
  };
}
