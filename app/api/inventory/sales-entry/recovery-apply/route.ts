import { withTenantAuth } from '@/lib/api/with-auth';
import { ApiError, isApiError } from '@/lib/api/error';
import { ApiHandler } from '@/lib/api/response';
import { hasPermission, type Role } from '@/lib/permissions';
import { resolveBranchScope } from '@/lib/branch-scope';
import { applySaleRecoveryProposal } from '@/lib/services/sale-recovery-apply';

function assertAdministrative(role: Role) {
  if (!['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(role) || !hasPermission(role, 'inventory', 'manage')) {
    throw ApiError.forbidden('La aplicación requiere una sesión administrativa con permisos de inventario');
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw ApiError.badRequest('Se requiere contenido JSON');
  }
  const declared = req.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    throw ApiError.badRequest('Tamaño de solicitud inválido');
  }
  if (declared !== null && Number(declared) > 16384) {
    throw new ApiError('La solicitud excede 16 KiB', 413);
  }
  const reader = req.body?.getReader();
  if (!reader) throw ApiError.badRequest('La solicitud requiere JSON');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel().catch(() => {});
        throw new ApiError('La solicitud excede 16 KiB', 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    const parsed = JSON.parse(text + decoder.decode());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw ApiError.badRequest('El cuerpo de la solicitud debe ser un objeto JSON');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (isApiError(error)) throw error;
    throw ApiError.badRequest('JSON de solicitud inválido');
  } finally {
    reader.releaseLock();
  }
}

export const POST = withTenantAuth(async (req, { auth }) => {
  assertAdministrative(auth.user.role as Role);

  const body = await parseJsonBody(req);
  const branchId = typeof body.branchId === 'string' ? body.branchId.trim().toLowerCase() : '';
  const proposalId = typeof body.proposalId === 'string' ? body.proposalId.trim().toLowerCase() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!branchId || !proposalId) {
    throw ApiError.badRequest('Se requieren branchId y proposalId');
  }
  if (!reason || reason.length < 4) {
    throw ApiError.badRequest('El motivo de auditoría debe tener al menos 4 caracteres');
  }

  const branchScope = resolveBranchScope(auth.user.role as Role, auth.user.branchId, branchId);
  if (branchScope.kind !== 'BRANCH' || branchScope.branchId !== branchId) {
    throw ApiError.forbidden('Sucursal fuera del alcance autorizado');
  }

  const result = await applySaleRecoveryProposal({
    branchId,
    proposalId,
    reason,
    user: {
      id: auth.user.id,
      role: auth.user.role,
      companyId: auth.tenantId,
      branchId: auth.user.branchId,
    },
  });

  return ApiHandler.success(result, 200);
});
