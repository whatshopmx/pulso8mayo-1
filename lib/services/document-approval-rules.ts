/**
 * APR-01 — Reglas puras para alinear aprobaciones de documentos financieros
 * (`OC`, `OS`, `EXPENSE`, `PAYMENT_RUN`, `PAYROLL`) preservando sus
 * especializaciones existentes.
 *
 * Responsabilidades (sin acceso a DB):
 * 1. Normalizar únicamente los **campos materiales** de cada tipo de documento
 *    para calcular `materialFingerprint` (SHA-256): los cambios no materiales
 *    (notas, títulos, comentarios) NO invalidan una aprobación vigente; los
 *    cambios materiales (monto, partidas, proveedor/contraparte, centro de
 *    costo, cuenta origen/destino, sucursal o huella NOM-03) SÍ la invalidan.
 * 2. Validar la **autoridad declarada** (`requiredRole`, `actualActorRole`,
 *    segregación de funciones y doble firma cuando aplique).
 * 3. Mapear cada documento a su `entityType` crítico en `CRITICAL_AUDIT_CATALOG`
 *    (`AUD-02`).
 */
import { createHash } from "node:crypto";
import { roleIsAtLeast } from "@/lib/permissions";
import type { BranchScope } from "@/lib/branch-scope";

export type ApprovalDocumentType =
  | "OC"
  | "OS"
  | "INVOICE"
  | "EXPENSE"
  | "PAYMENT_RUN"
  | "PAYROLL";

export type ApprovalAuthoritySource =
  | "APPROVAL_MATRIX"
  | "INVOICE_MATCH_POLICY"
  | "EXPENSE_AUTH_RULES"
  | "TREASURY_DUAL_APPROVAL"
  | "PAYROLL_SNAPSHOT_NOM03";

export interface OcMaterialPayload {
  branchId: string;
  supplierId: string;
  costCenterId: string | null;
  purchaseType?: string | null;
  totalAmountCents: number;
  items: Array<{
    itemId: string;
    orderedQuantity: number;
    unitCost: number;
  }>;
  /** Metadatos no materiales (no entran al fingerprint). */
  notes?: string | null;
  expectedDeliveryDate?: string | null;
}

export interface OsMaterialPayload {
  branchId: string;
  type: string;
  urgency: string;
  supplierId: string | null;
  serviceProviderId: string | null;
  costCenterId: string | null;
  amountCents: number;
  scope: string | null;
  /** No materiales */
  technicalReport?: string | null;
  scheduledDate?: string | null;
}

export interface InvoiceMaterialPayload {
  branchId: string | null;
  uuid: string;
  supplierId: string | null;
  payeeId: string | null;
  purchaseOrderId: string | null;
  serviceOrderId: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  matchStatus: string;
  /** No materiales */
  folio?: string | null;
  serie?: string | null;
  exceptionReason?: string | null;
}

export interface ExpenseMaterialPayload {
  branchId: string;
  category: string;
  amountCents: number;
  taxCents: number | null;
  payeeId: string | null;
  costCenterId: string | null;
  businessDate: string | null;
  /** No materiales */
  description?: string | null;
  dueDate?: string | null;
  approvalNotes?: string | null;
}

export interface PaymentRunMaterialPayload {
  branchId: string | null;
  sourceBankAccountId: string | null;
  currency: string;
  totalAmountCents: number;
  items: Array<{
    itemType: string;
    referenceId: string;
    amountCents: number;
    bankAccountId?: string | null;
  }>;
  /** No materiales */
  title?: string | null;
  notes?: string | null;
}

export interface PayrollMaterialPayload {
  periodStart: string;
  periodEnd: string;
  /** Huella NOM-03 (`payroll_runs.input_fingerprint`). */
  inputFingerprint: string;
  snapshotVersion: number;
  totalNetoCents: number;
  employeeCount: number;
  /** No materiales */
  notes?: string | null;
}

export type DocumentMaterialPayloadMap = {
  OC: OcMaterialPayload;
  OS: OsMaterialPayload;
  INVOICE: InvoiceMaterialPayload;
  EXPENSE: ExpenseMaterialPayload;
  PAYMENT_RUN: PaymentRunMaterialPayload;
  PAYROLL: PayrollMaterialPayload;
};

export type DocumentMaterialPayload =
  DocumentMaterialPayloadMap[ApprovalDocumentType];

export interface DocumentAuthorityDeclaration {
  requiredRole: string;
  actualActorRole: string;
  approverId: string;
  secondaryApproverId?: string | null;
  requiresDualApproval?: boolean;
  authoritySource: ApprovalAuthoritySource;
}

/** Extrae el `branchId` declarado del payload material (`null` para nómina corporativa). */
export function extractDocumentBranchId<T extends ApprovalDocumentType>(
  docType: T,
  payload: DocumentMaterialPayloadMap[T],
): string | null {
  if (docType === "PAYROLL") return null;
  const candidate = (payload as { branchId?: string | null }).branchId;
  return candidate ?? null;
}

/**
 * Extrae exclusivamente los campos materiales ordenados de forma determinista.
 * Campos cosméticos (`notes`, `title`, `description`, `dueDate`) se excluyen.
 */
export function extractCanonicalMaterialSnapshot<T extends ApprovalDocumentType>(
  docType: T,
  payload: DocumentMaterialPayloadMap[T],
): Record<string, unknown> {
  switch (docType) {
    case "OC": {
      const p = payload as OcMaterialPayload;
      return {
        branchId: p.branchId,
        supplierId: p.supplierId,
        costCenterId: p.costCenterId ?? null,
        purchaseType: p.purchaseType ?? "STOCK",
        totalAmountCents: p.totalAmountCents,
        items: [...p.items]
          .map((i) => ({
            itemId: i.itemId,
            orderedQuantity: Number(i.orderedQuantity),
            unitCost: Number(i.unitCost),
          }))
          .sort((a, b) => a.itemId.localeCompare(b.itemId) || a.unitCost - b.unitCost),
      };
    }
    case "OS": {
      const p = payload as OsMaterialPayload;
      return {
        branchId: p.branchId,
        type: p.type,
        urgency: p.urgency,
        supplierId: p.supplierId ?? null,
        serviceProviderId: p.serviceProviderId ?? null,
        costCenterId: p.costCenterId ?? null,
        amountCents: p.amountCents,
        scope: p.scope?.trim() || null,
      };
    }
    case "INVOICE": {
      const p = payload as InvoiceMaterialPayload;
      return {
        branchId: p.branchId ?? null,
        uuid: p.uuid.trim().toUpperCase(),
        supplierId: p.supplierId ?? null,
        payeeId: p.payeeId ?? null,
        purchaseOrderId: p.purchaseOrderId ?? null,
        serviceOrderId: p.serviceOrderId ?? null,
        subtotalCents: p.subtotalCents,
        taxCents: p.taxCents,
        totalCents: p.totalCents,
        currency: p.currency,
        matchStatus: p.matchStatus,
      };
    }
    case "EXPENSE": {
      const p = payload as ExpenseMaterialPayload;
      return {
        branchId: p.branchId,
        category: p.category,
        amountCents: p.amountCents,
        taxCents: p.taxCents ?? null,
        payeeId: p.payeeId ?? null,
        costCenterId: p.costCenterId ?? null,
        businessDate: p.businessDate ?? null,
      };
    }
    case "PAYMENT_RUN": {
      const p = payload as PaymentRunMaterialPayload;
      return {
        branchId: p.branchId ?? null,
        sourceBankAccountId: p.sourceBankAccountId ?? null,
        currency: p.currency,
        totalAmountCents: p.totalAmountCents,
        items: [...p.items]
          .map((i) => ({
            itemType: i.itemType,
            referenceId: i.referenceId,
            amountCents: i.amountCents,
            bankAccountId: i.bankAccountId ?? null,
          }))
          .sort(
            (a, b) =>
              a.itemType.localeCompare(b.itemType) ||
              a.referenceId.localeCompare(b.referenceId),
          ),
      };
    }
    case "PAYROLL": {
      const p = payload as PayrollMaterialPayload;
      return {
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        inputFingerprint: p.inputFingerprint,
        snapshotVersion: p.snapshotVersion,
        totalNetoCents: p.totalNetoCents,
        employeeCount: p.employeeCount,
      };
    }
  }
}

/**
 * Serialización JSON canónica con llaves ordenadas recursivamente.
 * Indispensable para que la huella SHA-256 y la comparación de campos sean
 * invariantes al reordenamiento de llaves que realiza PostgreSQL `jsonb`.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`)
    .join(",")}}`;
}

/** Calcula huella determinista SHA-256 del contenido material del documento. */
export function computeDocumentMaterialFingerprint<T extends ApprovalDocumentType>(
  docType: T,
  payload: DocumentMaterialPayloadMap[T],
): { fingerprint: string; snapshot: Record<string, unknown> } {
  const snapshot = extractCanonicalMaterialSnapshot(docType, payload);
  const fingerprint = createHash("sha256")
    .update(canonicalStringify({ docType, snapshot }))
    .digest("hex");
  return { fingerprint, snapshot };
}

/**
 * Compara la instantánea material aprobada contra la actual y devuelve
 * exactamente qué campos materiales cambiaron (vacío si solo cambiaron notas).
 */
export function detectMaterialChange(
  docType: ApprovalDocumentType,
  approvedSnapshot: Record<string, unknown>,
  currentSnapshot: Record<string, unknown>,
): {
  isMaterialChange: boolean;
  changedFields: string[];
  approvedFingerprint: string;
  currentFingerprint: string;
} {
  const approvedFingerprint = createHash("sha256")
    .update(canonicalStringify({ docType, snapshot: approvedSnapshot }))
    .digest("hex");
  const currentFingerprint = createHash("sha256")
    .update(canonicalStringify({ docType, snapshot: currentSnapshot }))
    .digest("hex");

  if (approvedFingerprint === currentFingerprint) {
    return {
      isMaterialChange: false,
      changedFields: [],
      approvedFingerprint,
      currentFingerprint,
    };
  }

  const keys = new Set([
    ...Object.keys(approvedSnapshot),
    ...Object.keys(currentSnapshot),
  ]);
  const changedFields: string[] = [];
  for (const key of keys) {
    if (
      canonicalStringify(approvedSnapshot[key] ?? null) !==
      canonicalStringify(currentSnapshot[key] ?? null)
    ) {
      changedFields.push(key);
    }
  }
  changedFields.sort();

  return {
    isMaterialChange: changedFields.length > 0,
    changedFields,
    approvedFingerprint,
    currentFingerprint,
  };
}

/**
 * Valida la autoridad declarada respetando las especializaciones vigentes:
 * - Rol efectivo debe alcanzar `requiredRole` (`roleIsAtLeast`, fail-closed).
 * - Segregación de funciones: quien solicitó/preparó no puede auto-aprobar
 *   (se conserva únicamente la excepción ejecutiva OWNER/SUPER_ADMIN en EXPENSE
 *   que ya define `lib/expenses/approval-policy.ts`).
 * - Cuando `requiresDualApproval` es true (corridas sobre umbral), exige un
 *   segundo firmante distinto del primero y del preparador.
 */
export function validateDeclaredAuthority(params: {
  docType: ApprovalDocumentType;
  authority: DocumentAuthorityDeclaration;
  requesterId?: string | null;
  actorScope?: BranchScope;
  docBranchId?: string | null;
  requireReason?: boolean;
  reason?: string | null;
}):
  | { ok: true }
  | {
      ok: false;
      code: "ROLE" | "SELF" | "DUAL_APPROVAL" | "BRANCH_SCOPE" | "REASON";
      reason: string;
    } {
  const { docType, authority, requesterId, actorScope, docBranchId, requireReason, reason } = params;

  if (!authority.actualActorRole || !roleIsAtLeast(authority.actualActorRole, authority.requiredRole)) {
    return {
      ok: false,
      code: "ROLE",
      reason: `Autoridad insuficiente para ${docType}: se requiere ${authority.requiredRole} (rol actual: ${authority.actualActorRole || "NINGUNO"}).`,
    };
  }

  if (actorScope) {
    if (actorScope.kind === "NONE") {
      return {
        ok: false,
        code: "BRANCH_SCOPE",
        reason: `Alcance de sucursal insuficiente para aprobar ${docType}: usuario sin sucursal asignada.`,
      };
    }
    if (actorScope.kind === "BRANCH" && (!docBranchId || actorScope.branchId !== docBranchId)) {
      return {
        ok: false,
        code: "BRANCH_SCOPE",
        reason: `Alcance de sucursal excedido para ${docType}: tu usuario solo puede aprobar documentos de su sucursal asignada.`,
      };
    }
  }

  if (requireReason && (!reason || reason.trim().length < 4)) {
    return {
      ok: false,
      code: "REASON",
      reason: `El motivo de aprobación para ${docType} es obligatorio (mínimo 4 caracteres).`,
    };
  }

  const executiveExpenseException =
    docType === "EXPENSE" &&
    (authority.actualActorRole === "OWNER" || authority.actualActorRole === "SUPER_ADMIN");

  if (requesterId && authority.approverId === requesterId && !executiveExpenseException) {
    return {
      ok: false,
      code: "SELF",
      reason: `Segregación de funciones en ${docType}: quien solicita/prepara el documento no puede aprobarlo.`,
    };
  }

  if (authority.requiresDualApproval) {
    if (!authority.secondaryApproverId) {
      return {
        ok: false,
        code: "DUAL_APPROVAL",
        reason: `El documento ${docType} requiere doble firma de un segundo usuario autorizado.`,
      };
    }
    if (
      authority.secondaryApproverId === authority.approverId ||
      (requesterId && authority.secondaryApproverId === requesterId)
    ) {
      return {
        ok: false,
        code: "DUAL_APPROVAL",
        reason: `La segunda firma en ${docType} debe corresponder a un usuario distinto del preparador y del primer firmante.`,
      };
    }
  }

  return { ok: true };
}

/** Mapea el tipo de documento al `entityType` del catálogo crítico `AUD-02`. */
export function auditEntityTypeForDocument(docType: ApprovalDocumentType): string {
  switch (docType) {
    case "OC":
    case "OS":
      return "APPROVAL_PURCHASE";
    case "INVOICE":
      return "APPROVAL_INVOICE";
    case "EXPENSE":
      return "APPROVAL_EXPENSE";
    case "PAYMENT_RUN":
      return "APPROVAL_PAYMENT";
    case "PAYROLL":
      return "APPROVAL_PAYROLL";
  }
}

export function defaultAuthoritySourceForDocument(
  docType: ApprovalDocumentType,
): ApprovalAuthoritySource {
  switch (docType) {
    case "OC":
    case "OS":
      return "APPROVAL_MATRIX";
    case "INVOICE":
      return "INVOICE_MATCH_POLICY";
    case "EXPENSE":
      return "EXPENSE_AUTH_RULES";
    case "PAYMENT_RUN":
      return "TREASURY_DUAL_APPROVAL";
    case "PAYROLL":
      return "PAYROLL_SNAPSHOT_NOM03";
  }
}
