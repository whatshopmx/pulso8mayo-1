/**
 * EVI-02.a — Sujetos de evidencia para Facturas, Pagos y Excepciones.
 *
 * Servicio integral para gestionar evidencias documentales y adjuntos auditables
 * vinculados a los sujetos faltantes de la plataforma:
 * - `INVOICE` (Facturas / CFDI de proveedores en `invoices`)
 * - `PAYMENT` (Corridas de pago en `payment_runs` o partidas en `payment_run_items`)
 * - `EXCEPTION` (Discrepancias, quejas y anomalías en `exceptions`)
 * - Preserva y soporta `SALE_RECOVERY` (recuperación histórica de ventas en `sales_entries`).
 *
 * Garantías de Seguridad y Tenancy:
 * 1. Aislamiento estricto por empresa (`companyId`): deniega transversalidad entre tenants.
 * 2. Acotamiento por sucursal (`branchId`): roles acotados (p. ej. `GERENTE`) solo acceden
 *    a registros de su propia sucursal; roles corporativos (`ADMIN`, `OWNER`) acceden a
 *    nivel grupo y entidades corporativas sin sucursal (`branchId = null`).
 * 3. Permisos basados en roles (`hasPermission`): contabilidad, excepciones e inventario.
 * 4. Almacenamiento privado R2 aislado: claves con prefijo canónico inmutable
 *    `companies/{companyId}/branches/{branchId || 'corporate'}/{subjectType}/{entityId}/{evidenceId}`.
 * 5. Borrado lógico (`deletedAt`) para trazabilidad de auditoría inmutable.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  invoices,
  paymentRuns,
  paymentRunItems,
  exceptions,
  salesEntries,
} from "@/lib/db/schema";
import { hasPermission, type Role } from "@/lib/permissions";
import { resolveBranchScope } from "@/lib/branch-scope";
import { ApiError } from "@/lib/api/error";
import {
  generatePresignedUrl,
  isR2Configured,
  uploadToR2,
} from "@/lib/storage/r2-client";
import { EVIDENCE_URL_TTL_SECONDS } from "@/lib/storage/scoped-evidence";
import type { DbExecutor } from "./fefo-allocator";

export type EvidenceSubjectType =
  | "INVOICE"
  | "PAYMENT"
  | "EXCEPTION"
  | "SALE_RECOVERY";

export const SUPPORTED_EVIDENCE_SUBJECTS: readonly EvidenceSubjectType[] = [
  "INVOICE",
  "PAYMENT",
  "EXCEPTION",
  "SALE_RECOVERY",
] as const;

export type EvidenceKind = "PHOTO" | "FILE" | "VOICE" | "VIDEO" | "TEXT";

export interface UserScope {
  id: string;
  role: Role;
  companyId: string;
  branchId?: string | null;
}

export interface SubjectResolution {
  subjectType: EvidenceSubjectType;
  entityId: string;
  companyId: string;
  branchId: string | null;
  metadata?: Record<string, unknown>;
}

export interface SubjectAccessResult {
  allowed: boolean;
  subject: SubjectResolution;
  user: UserScope;
}

export interface BuildStorageKeyParams {
  companyId: string;
  branchId?: string | null;
  subjectType: EvidenceSubjectType;
  entityId: string;
  evidenceId: string;
}

export interface AttachEvidenceInput {
  user: UserScope;
  subjectType: EvidenceSubjectType;
  entityId: string;
  kind?: EvidenceKind;
  mimeType?: string;
  storageKey?: string;
  url?: string;
  buffer?: Buffer;
  aiMetadata?: Record<string, unknown>;
}

export interface EvidenceRecord {
  id: string;
  companyId: string;
  branchId: string | null;
  entityType: EvidenceSubjectType;
  entityId: string;
  kind: string;
  mimeType: string | null;
  url: string;
  storageKey: string | null;
  aiMetadata: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  [key: string]: unknown;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidSchema = z.string().regex(UUID_REGEX, "UUID inválido").toLowerCase();

const subjectTypeSchema = z.enum([
  "INVOICE",
  "PAYMENT",
  "EXCEPTION",
  "SALE_RECOVERY",
]);

/**
 * Genera la clave de almacenamiento canónica aislada por empresa y sucursal.
 * Previene colisiones y garantiza segregación criptográfica en R2.
 */
export function buildEvidenceStorageKey(params: BuildStorageKeyParams): string {
  const company = uuidSchema.parse(params.companyId);
  const branch = params.branchId ? uuidSchema.parse(params.branchId) : "corporate";
  const subject = subjectTypeSchema.parse(params.subjectType).toLowerCase();
  const entityId = params.entityId.trim().toLowerCase();
  const evidenceId = uuidSchema.parse(params.evidenceId);

  return `companies/${company}/branches/${branch}/${subject}/${entityId}/${evidenceId}`;
}

/**
 * Valida que una clave de almacenamiento R2 pertenezca rigurosamente al sujeto,
 * empresa y sucursal autorizados, bloqueando cualquier intento de Directory Traversal (`..`).
 */
export function validateEvidenceStorageKey(
  storageKey: string,
  expected: {
    companyId: string;
    branchId?: string | null;
    subjectType: EvidenceSubjectType;
    entityId: string;
  }
): boolean {
  if (!storageKey || typeof storageKey !== "string") return false;
  if (storageKey.includes("..") || storageKey.includes("//") || storageKey.startsWith("/")) {
    return false;
  }

  const expectedCompany = expected.companyId.toLowerCase();
  const expectedBranch = expected.branchId ? expected.branchId.toLowerCase() : "corporate";
  const expectedSubject = expected.subjectType.toLowerCase();
  const expectedEntity = expected.entityId.toLowerCase();

  const expectedPrefix = `companies/${expectedCompany}/branches/${expectedBranch}/${expectedSubject}/${expectedEntity}/`;
  if (!storageKey.startsWith(expectedPrefix)) {
    return false;
  }

  const suffix = storageKey.slice(expectedPrefix.length);
  return suffix.length > 0 && UUID_REGEX.test(suffix.split(".")[0]);
}

/**
 * Servicio unificado de acceso y persistencia para sujetos de evidencia (EVI-02.a).
 */
export class EvidenceSubjectService {
  /**
   * Valida la existencia del sujeto en su tabla de origen y los permisos de acceso
   * del usuario respetando tenancy, alcance de sucursal y matriz de roles.
   */
  static async validateSubjectAccess(
    params: {
      user: UserScope;
      subjectType: EvidenceSubjectType;
      entityId: string;
    },
    executor: DbExecutor = db
  ): Promise<SubjectAccessResult> {
    const { user, entityId } = params;
    const subjectType = subjectTypeSchema.parse(params.subjectType);

    if (!user || !user.id || !user.role || !user.companyId) {
      throw ApiError.forbidden("Usuario no autenticado o contexto de usuario incompleto");
    }

    const companyId = uuidSchema.parse(user.companyId);

    // 1. Verificación de capacidad por recurso según sujeto
    switch (subjectType) {
      case "INVOICE":
      case "PAYMENT":
        if (
          !hasPermission(user.role, "accounting", "read") &&
          !hasPermission(user.role, "accounting", "manage")
        ) {
          throw ApiError.forbidden("Permisos insuficientes para consultar evidencias financieras");
        }
        break;
      case "EXCEPTION":
        if (
          !hasPermission(user.role, "exceptions", "read") &&
          !hasPermission(user.role, "exceptions", "manage")
        ) {
          throw ApiError.forbidden("Permisos insuficientes para consultar evidencias de excepciones");
        }
        break;
      case "SALE_RECOVERY":
        if (
          !hasPermission(user.role, "inventory", "read") &&
          !hasPermission(user.role, "inventory", "manage")
        ) {
          throw ApiError.forbidden("Permisos insuficientes para consultar evidencias de recuperación de ventas");
        }
        break;
      default:
        throw ApiError.badRequest("Tipo de sujeto de evidencia no soportado");
    }

    // 2. Búsqueda y resolución de la entidad en su dominio
    let resolvedBranchId: string | null = null;
    let metadata: Record<string, unknown> | undefined = undefined;

    if (subjectType === "INVOICE") {
      const [invoice] = await executor
        .select({
          id: invoices.id,
          companyId: invoices.companyId,
          branchId: invoices.branchId,
          uuid: invoices.uuid,
          total: invoices.total,
        })
        .from(invoices)
        .where(and(eq(invoices.id, entityId), eq(invoices.companyId, companyId)));

      if (!invoice) {
        throw ApiError.notFound("Factura no encontrada");
      }
      resolvedBranchId = invoice.branchId ?? null;
      metadata = { invoiceUuid: invoice.uuid, total: invoice.total };
    } else if (subjectType === "PAYMENT") {
      // Intenta resolver como payment_run primero
      const [run] = await executor
        .select({
          id: paymentRuns.id,
          companyId: paymentRuns.companyId,
          branchId: paymentRuns.branchId,
          title: paymentRuns.title,
        })
        .from(paymentRuns)
        .where(and(eq(paymentRuns.id, entityId), eq(paymentRuns.companyId, companyId)));

      if (run) {
        resolvedBranchId = run.branchId ?? null;
        metadata = { paymentRunTitle: run.title };
      } else {
        // Intenta resolver como partida individual de corrida (payment_run_items)
        const [item] = await executor
          .select({
            id: paymentRunItems.id,
            companyId: paymentRuns.companyId,
            branchId: paymentRuns.branchId,
            itemType: paymentRunItems.itemType,
          })
          .from(paymentRunItems)
          .innerJoin(paymentRuns, eq(paymentRunItems.paymentRunId, paymentRuns.id))
          .where(
            and(eq(paymentRunItems.id, entityId), eq(paymentRuns.companyId, companyId))
          );

        if (!item) {
          throw ApiError.notFound("Registro de pago no encontrado");
        }
        resolvedBranchId = item.branchId ?? null;
        metadata = { itemType: item.itemType };
      }
    } else if (subjectType === "EXCEPTION") {
      const [exc] = await executor
        .select({
          id: exceptions.id,
          companyId: exceptions.companyId,
          branchId: exceptions.branchId,
          domain: exceptions.domain,
          reason: exceptions.reason,
        })
        .from(exceptions)
        .where(and(eq(exceptions.id, entityId), eq(exceptions.companyId, companyId)));

      if (!exc) {
        throw ApiError.notFound("Excepción no encontrada");
      }
      resolvedBranchId = exc.branchId ?? null;
      metadata = { domain: exc.domain, reason: exc.reason };
    } else if (subjectType === "SALE_RECOVERY") {
      const [sale] = await executor
        .select({
          id: salesEntries.id,
          companyId: salesEntries.companyId,
          branchId: salesEntries.branchId,
        })
        .from(salesEntries)
        .where(and(eq(salesEntries.id, entityId), eq(salesEntries.companyId, companyId)));

      if (!sale) {
        throw ApiError.notFound("Venta de recuperación no encontrada");
      }
      resolvedBranchId = sale.branchId;
    }

    // 3. Validación de alcance de sucursal
    const scope = resolveBranchScope(user.role, user.branchId);

    if (scope.kind === "NONE") {
      throw ApiError.forbidden("Usuario sin alcance de sucursal autorizado");
    }

    if (scope.kind === "BRANCH") {
      // Un usuario acotado a sucursal no puede ver registros de otra sucursal
      // ni registros corporativos a nivel holding (branchId = null)
      if (!resolvedBranchId || resolvedBranchId.toLowerCase() !== scope.branchId.toLowerCase()) {
        throw ApiError.notFound("Entidad fuera del alcance de sucursal asignado");
      }
    }

    return {
      allowed: true,
      subject: {
        subjectType,
        entityId,
        companyId,
        branchId: resolvedBranchId,
        metadata,
      },
      user,
    };
  }

  /**
   * Adjunta una evidencia a un sujeto verificado, persistiendo la fila en `evidence`
   * y almacenando el objeto con clave canónica privada en R2.
   */
  static async attachEvidence(
    input: AttachEvidenceInput,
    executor: DbExecutor = db
  ): Promise<EvidenceRecord> {
    const access = await this.validateSubjectAccess(
      {
        user: input.user,
        subjectType: input.subjectType,
        entityId: input.entityId,
      },
      executor
    );

    const evidenceId = randomUUID();
    const storageKey =
      input.storageKey ||
      buildEvidenceStorageKey({
        companyId: access.subject.companyId,
        branchId: access.subject.branchId,
        subjectType: access.subject.subjectType,
        entityId: access.subject.entityId,
        evidenceId,
      });

    // Verificación de seguridad de la clave
    if (
      !validateEvidenceStorageKey(storageKey, {
        companyId: access.subject.companyId,
        branchId: access.subject.branchId,
        subjectType: access.subject.subjectType,
        entityId: access.subject.entityId,
      })
    ) {
      throw ApiError.badRequest("Clave de almacenamiento R2 no cumple la política de aislamiento");
    }

    // Subida opcional a R2 si se suministra buffer de bytes
    if (input.buffer) {
      if (!isR2Configured()) {
        throw new ApiError("Almacenamiento privado R2 no disponible", 503);
      }
      try {
        await uploadToR2(
          Buffer.from(input.buffer),
          storageKey,
          input.mimeType || "application/octet-stream"
        );
      } catch (err) {
        console.error("[EvidenceSubjectService] Error subiendo a R2:", err);
        throw new ApiError("No fue posible guardar la evidencia en almacenamiento", 502);
      }
    }

    const kind: EvidenceKind =
      input.kind ||
      (input.mimeType?.startsWith("image/")
        ? "PHOTO"
        : input.mimeType?.startsWith("audio/")
        ? "VOICE"
        : input.mimeType?.startsWith("video/")
        ? "VIDEO"
        : "FILE");

    const url = input.url || storageKey;

    // Inserción vía SQL para garantizar soporte del enum 'evidence_entity_type'
    // sin requerir modificación del archivo schema en el repositorio
    const insertResult = await executor.execute<EvidenceRecord>(sql`
      INSERT INTO evidence (
        id, company_id, branch_id, entity_type, entity_id,
        kind, mime_type, url, storage_key, ai_metadata, created_by,
        created_at, updated_at
      ) VALUES (
        ${evidenceId},
        ${access.subject.companyId},
        ${access.subject.branchId},
        ${access.subject.subjectType}::evidence_entity_type,
        ${access.subject.entityId},
        ${kind}::evidence_kind,
        ${input.mimeType || null},
        ${url},
        ${storageKey},
        ${input.aiMetadata ? sql`${JSON.stringify(input.aiMetadata)}::jsonb` : null},
        ${input.user.id},
        NOW(),
        NOW()
      )
      RETURNING
        id,
        company_id as "companyId",
        branch_id as "branchId",
        entity_type as "entityType",
        entity_id as "entityId",
        kind,
        mime_type as "mimeType",
        url,
        storage_key as "storageKey",
        ai_metadata as "aiMetadata",
        created_by as "createdBy",
        created_at as "createdAt",
        updated_at as "updatedAt",
        deleted_at as "deletedAt"
    `);

    const record = (insertResult.rows[0] as unknown) as EvidenceRecord;
    return record;
  }

  /**
   * Lista las evidencias asociadas a un sujeto verificado, excluyendo borrados lógicos por defecto.
   */
  static async getEvidenceForSubject(
    params: {
      user: UserScope;
      subjectType: EvidenceSubjectType;
      entityId: string;
      includeDeleted?: boolean;
    },
    executor: DbExecutor = db
  ): Promise<EvidenceRecord[]> {
    const access = await this.validateSubjectAccess(
      {
        user: params.user,
        subjectType: params.subjectType,
        entityId: params.entityId,
      },
      executor
    );

    const query = params.includeDeleted
      ? sql`
          SELECT
            id, company_id as "companyId", branch_id as "branchId",
            entity_type as "entityType", entity_id as "entityId",
            kind, mime_type as "mimeType", url, storage_key as "storageKey",
            ai_metadata as "aiMetadata", created_by as "createdBy",
            created_at as "createdAt", updated_at as "updatedAt",
            deleted_at as "deletedAt"
          FROM evidence
          WHERE company_id = ${access.subject.companyId}
            AND entity_type = ${access.subject.subjectType}::evidence_entity_type
            AND entity_id = ${access.subject.entityId}
          ORDER BY created_at DESC
        `
      : sql`
          SELECT
            id, company_id as "companyId", branch_id as "branchId",
            entity_type as "entityType", entity_id as "entityId",
            kind, mime_type as "mimeType", url, storage_key as "storageKey",
            ai_metadata as "aiMetadata", created_by as "createdBy",
            created_at as "createdAt", updated_at as "updatedAt",
            deleted_at as "deletedAt"
          FROM evidence
          WHERE company_id = ${access.subject.companyId}
            AND entity_type = ${access.subject.subjectType}::evidence_entity_type
            AND entity_id = ${access.subject.entityId}
            AND deleted_at IS NULL
          ORDER BY created_at DESC
        `;

    const result = await executor.execute<EvidenceRecord>(query);
    return (result.rows as unknown) as EvidenceRecord[];
  }

  /**
   * Genera una URL prefirmada temporal para visualizar o descargar un archivo de evidencia privado.
   */
  static async getEvidencePresignedUrl(
    params: {
      user: UserScope;
      evidenceId: string;
      expiresIn?: number;
    },
    executor: DbExecutor = db
  ): Promise<{ id: string; url: string }> {
    const { user, evidenceId } = params;
    const companyId = uuidSchema.parse(user.companyId);

    const result = await executor.execute<EvidenceRecord>(sql`
      SELECT
        id, company_id as "companyId", branch_id as "branchId",
        entity_type as "entityType", entity_id as "entityId",
        kind, mime_type as "mimeType", url, storage_key as "storageKey",
        ai_metadata as "aiMetadata", created_by as "createdBy",
        created_at as "createdAt", updated_at as "updatedAt",
        deleted_at as "deletedAt"
      FROM evidence
      WHERE id = ${evidenceId}
        AND company_id = ${companyId}
        AND deleted_at IS NULL
    `);

    const row = (result.rows[0] as unknown) as EvidenceRecord | undefined;
    if (!row) {
      throw ApiError.notFound("Evidencia no encontrada");
    }

    // Validar acceso del usuario al sujeto subyacente
    await this.validateSubjectAccess(
      {
        user,
        subjectType: row.entityType,
        entityId: row.entityId,
      },
      executor
    );

    if (!row.storageKey) {
      // Si no tiene storageKey pero tiene url legacy (http/local), se retorna directamente
      return { id: row.id, url: row.url };
    }

    if (
      !validateEvidenceStorageKey(row.storageKey, {
        companyId: row.companyId,
        branchId: row.branchId,
        subjectType: row.entityType,
        entityId: row.entityId,
      })
    ) {
      throw ApiError.notFound("Evidencia privada no cumple la política de aislamiento");
    }

    if (!isR2Configured()) {
      throw new ApiError("Almacenamiento privado R2 no disponible", 503);
    }

    const presigned = await generatePresignedUrl(
      row.storageKey,
      params.expiresIn ?? EVIDENCE_URL_TTL_SECONDS
    );

    return { id: row.id, url: presigned };
  }

  /**
   * Borrado lógico de evidencia (`deletedAt`), preservando el registro inmutable para auditoría.
   */
  static async removeEvidence(
    params: {
      user: UserScope;
      evidenceId: string;
    },
    executor: DbExecutor = db
  ): Promise<{ id: string; deleted: boolean }> {
    const { user, evidenceId } = params;
    const companyId = uuidSchema.parse(user.companyId);

    const result = await executor.execute<EvidenceRecord>(sql`
      SELECT
        id, company_id as "companyId", branch_id as "branchId",
        entity_type as "entityType", entity_id as "entityId",
        deleted_at as "deletedAt"
      FROM evidence
      WHERE id = ${evidenceId}
        AND company_id = ${companyId}
        AND deleted_at IS NULL
    `);

    const row = (result.rows[0] as unknown) as EvidenceRecord | undefined;
    if (!row) {
      throw ApiError.notFound("Evidencia no encontrada");
    }

    // Valida acceso
    await this.validateSubjectAccess(
      {
        user,
        subjectType: row.entityType,
        entityId: row.entityId,
      },
      executor
    );

    await executor.execute(sql`
      UPDATE evidence
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = ${evidenceId}
        AND company_id = ${companyId}
    `);

    return { id: evidenceId, deleted: true };
  }
}
