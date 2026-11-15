import { withTenantAuth } from '@/lib/api/with-auth';
import { ApiError, isApiError } from '@/lib/api/error';
import { ApiHandler } from '@/lib/api/response';
import { hasPermission, type Role } from '@/lib/permissions';
import { getRecoveryProposalForReview, recordRecoveryDecision } from '@/lib/services/sale-recovery-decision';

function administrative(role: Role) {
  if (!['ADMIN', 'OWNER', 'SUPER_ADMIN'].includes(role) || !hasPermission(role, 'inventory', 'manage')) {
    throw ApiError.forbidden('La decisión administrativa requiere autoridad de inventario');
  }
}

async function smallJson(req: Request): Promise<unknown> {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
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
  let size = 0, text = '';
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
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    if (isApiError(error)) throw error;
    throw ApiError.badRequest('JSON de decisión inválido');
  } finally {
    reader.releaseLock();
  }
}

export const GET = withTenantAuth(async (req, { auth }) => {
  administrative(auth.user.role as Role);
  const params = new URL(req.url).searchParams;
  for (const key of params.keys()) {
    if (!['branchId', 'proposalId'].includes(key) || params.getAll(key).length !== 1) {
      throw ApiError.badRequest('Consulta de expediente inválida');
    }
  }
  const branchId = params.get('branchId');
  const proposalId = params.get('proposalId');
  if (!branchId || !proposalId) {
    throw ApiError.badRequest('Se requieren branchId y proposalId');
  }
  const response = ApiHandler.success(await getRecoveryProposalForReview({ branchId, proposalId }));
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
});

export const POST = withTenantAuth(async (req, { auth }) => {
  administrative(auth.user.role as Role);
  const result = await recordRecoveryDecision(await smallJson(req));
  return ApiHandler.success(result, result.created ? 201 : 200);
});
