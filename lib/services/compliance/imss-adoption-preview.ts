import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '@/lib/api/error';

export interface AdoptionSelection { userIds: string[]; effectiveDate: string; nota: string; branchId: string }
interface Actor { companyId: string; actorId: string }

function secret() {
    if (!process.env.BETTER_AUTH_SECRET) throw ApiError.internal('No se pudo preparar la vista previa');
    return process.env.BETTER_AUTH_SECRET;
}
function fingerprint(input: AdoptionSelection, actor: Actor) {
    return createHash('sha256').update(JSON.stringify({ companyId: actor.companyId, actorId: actor.actorId,
        userIds: [...new Set(input.userIds)].sort(), effectiveDate: input.effectiveDate, nota: input.nota.trim(), branchId: input.branchId })).digest('hex');
}
export function signAdoptionPreview(input: AdoptionSelection, actor: Actor, eligibleIds: string[]) {
    const payload = Buffer.from(JSON.stringify({ fingerprint: fingerprint(input, actor), eligibleIds, expiresAt: Date.now() + 15 * 60_000 })).toString('base64url');
    return `${payload}.${createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}
export function verifyAdoptionPreview(token: string | undefined, input: AdoptionSelection, actor: Actor): string[] {
    if (!token) throw ApiError.badRequest('Primero previsualiza la adopción');
    if (token.length > 200000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw ApiError.conflict('Vista previa inválida; vuelve a previsualizar');
    const [payload, signature] = token.split('.');
    const expected = createHmac('sha256', secret()).update(payload).digest();
    const received = Buffer.from(signature, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw ApiError.conflict('Vista previa inválida; vuelve a previsualizar');
    let data;
    try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { fingerprint: string; eligibleIds: string[]; expiresAt: number }; }
    catch { throw ApiError.conflict('Vista previa inválida; vuelve a previsualizar'); }
    if (data.fingerprint !== fingerprint(input, actor) || data.expiresAt <= Date.now() || !Array.isArray(data.eligibleIds)) throw ApiError.conflict('La vista previa cambió o caducó; vuelve a previsualizar');
    return data.eligibleIds;
}
