import { type NextRequest, NextResponse } from "next/server";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { ApiError, isApiError } from "@/lib/api/error";
import { ApiHandler } from "@/lib/api/response";
import { hasPermission, type Role } from "@/lib/permissions";
import {
  EvidenceSubjectService,
  type EvidenceKind,
  type UserScope,
} from "@/lib/services/evidence-subject-service";
import {
  generatePresignedUrl,
  isR2Configured,
} from "@/lib/storage/r2-client";
import { EVIDENCE_URL_TTL_SECONDS } from "@/lib/storage/scoped-evidence";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const DISALLOWED_EXTENSIONS = [
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".php",
  ".js",
  ".mjs",
  ".ts",
  ".py",
  ".vbs",
  ".ps1",
  ".msi",
  ".com",
  ".scr",
];

function requireModificationPermission(role: Role) {
  if (
    !hasPermission(role, "exceptions", "update") &&
    !hasPermission(role, "exceptions", "manage")
  ) {
    throw ApiError.forbidden(
      "Permisos insuficientes para modificar evidencias de la excepción"
    );
  }
}

function buildUserScope(auth: {
  user: { id: string; role: string; branchId: string | null };
  tenantId: string;
}): UserScope {
  return {
    id: auth.user.id,
    role: auth.user.role as Role,
    companyId: auth.tenantId,
    branchId: auth.user.branchId,
  };
}

/**
 * GET /api/exceptions/[id]/evidence
 * Lista las evidencias activas asociadas a la excepción, resolviendo URLs prefirmadas.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const auth = await requireTenantAuth();
    const user = buildUserScope(auth);
    const { id } = await params;

    const items = await EvidenceSubjectService.getEvidenceForSubject({
      user,
      subjectType: "EXCEPTION",
      entityId: id,
    });

    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        let resolvedUrl = item.url;
        if (item.storageKey && isR2Configured()) {
          try {
            resolvedUrl = await generatePresignedUrl(
              item.storageKey,
              EVIDENCE_URL_TTL_SECONDS
            );
          } catch {
            resolvedUrl = item.url;
          }
        }
        return {
          ...item,
          resolvedUrl,
        };
      })
    );

    return NextResponse.json(
      {
        success: true,
        items: enrichedItems,
        total: enrichedItems.length,
        data: { items: enrichedItems, total: enrichedItems.length },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    );
  } catch (error) {
    if (isApiError(error)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: error.message,
            details: error.details,
          },
        },
        { status: error.statusCode }
      );
    }
    return ApiHandler.error(error);
  }
}

/**
 * POST /api/exceptions/[id]/evidence
 * Adjunta una nueva evidencia (multipart/form-data o application/json) a la excepción.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const auth = await requireTenantAuth();
    const user = buildUserScope(auth);
    requireModificationPermission(user.role);

    const { id } = await params;

    const contentLength = req.headers.get("content-length");
    if (
      contentLength !== null &&
      Number(contentLength) > MAX_FILE_SIZE + 1024 * 512
    ) {
      throw new ApiError("El archivo excede el límite de 10MB", 413);
    }

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        throw ApiError.badRequest("Solicitud multipart inválida");
      }

      const file = form.get("file");
      if (!(file instanceof File) || !file.size) {
        throw ApiError.badRequest("El archivo de evidencia es requerido");
      }

      if (file.size > MAX_FILE_SIZE) {
        throw new ApiError("El archivo excede el límite de 10MB", 413);
      }

      const fileName = file.name || "evidence";
      const fileNameLower = fileName.toLowerCase();

      if (
        !ALLOWED_MIME_TYPES.has(file.type) ||
        DISALLOWED_EXTENSIONS.some((ext) => fileNameLower.endsWith(ext))
      ) {
        throw ApiError.badRequest(
          "Tipo de archivo no permitido. Solo se permiten imágenes y documentos (PDF, Word, texto plano)."
        );
      }

      let record;
      if (isR2Configured()) {
        const buffer = Buffer.from(await file.arrayBuffer());
        record = await EvidenceSubjectService.attachEvidence({
          user,
          subjectType: "EXCEPTION",
          entityId: id,
          mimeType: file.type,
          buffer,
        });
      } else {
        record = await EvidenceSubjectService.attachEvidence({
          user,
          subjectType: "EXCEPTION",
          entityId: id,
          mimeType: file.type,
          url: `local://exceptions/${id}/${fileName}`,
        });
      }

      return NextResponse.json(
        {
          success: true,
          evidence: record,
          data: { evidence: record },
        },
        { status: 201 }
      );
    }

    if (contentType.includes("application/json")) {
      let body: {
        url?: string;
        mimeType?: string;
        kind?: EvidenceKind;
        aiMetadata?: Record<string, unknown>;
      };
      try {
        body = await req.json();
      } catch {
        throw ApiError.badRequest("JSON de solicitud inválido");
      }

      if (body.mimeType && !ALLOWED_MIME_TYPES.has(body.mimeType)) {
        throw ApiError.badRequest("Tipo MIME no permitido");
      }

      const record = await EvidenceSubjectService.attachEvidence({
        user,
        subjectType: "EXCEPTION",
        entityId: id,
        url: body.url || `local://exceptions/${id}/evidence.json`,
        mimeType: body.mimeType,
        kind: body.kind,
        aiMetadata: body.aiMetadata,
      });

      return NextResponse.json(
        {
          success: true,
          evidence: record,
          data: { evidence: record },
        },
        { status: 201 }
      );
    }

    throw ApiError.badRequest(
      "Content-Type no soportado. Use multipart/form-data o application/json"
    );
  } catch (error) {
    if (isApiError(error)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: error.message,
            details: error.details,
          },
        },
        { status: error.statusCode }
      );
    }
    return ApiHandler.error(error);
  }
}

/**
 * DELETE /api/exceptions/[id]/evidence
 * Retira (borrado lógico) una evidencia de la excepción.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const auth = await requireTenantAuth();
    const user = buildUserScope(auth);
    requireModificationPermission(user.role);

    // Valida que la excepción exista y pertenezca al alcance
    const { id } = await params;
    await EvidenceSubjectService.validateSubjectAccess({
      user,
      subjectType: "EXCEPTION",
      entityId: id,
    });

    const url = new URL(req.url);
    let evidenceId =
      url.searchParams.get("evidenceId") || url.searchParams.get("id");

    if (
      !evidenceId &&
      req.headers.get("content-type")?.includes("application/json")
    ) {
      try {
        const body = await req.json();
        evidenceId = body?.evidenceId || body?.id;
      } catch {
        // ignore parse error if not JSON
      }
    }

    if (!evidenceId) {
      throw ApiError.badRequest("El ID de la evidencia es requerido");
    }

    await EvidenceSubjectService.removeEvidence({
      user,
      evidenceId,
    });

    return NextResponse.json(
      {
        success: true,
        removedId: evidenceId,
        data: { removedId: evidenceId },
      },
      { status: 200 }
    );
  } catch (error) {
    if (isApiError(error)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: error.message,
            details: error.details,
          },
        },
        { status: error.statusCode }
      );
    }
    return ApiHandler.error(error);
  }
}
