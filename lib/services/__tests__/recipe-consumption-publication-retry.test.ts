import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withSalesWriterTransaction } from '@/lib/db/sales-runtime';
import { publishRecipeConsumptionPolicy } from '../recipe-consumption-publication';

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/db/sales-runtime', () => ({ withSalesWriterTransaction: vi.fn() }));
const transaction = vi.mocked(withSalesWriterTransaction);
const actor = { userId: 'synthetic-admin', role: 'ADMIN' as const, companyId: 'aaaaaaaa-0000-4000-8000-000000000001' };
const input = { recipeId: 'aaaaaaaa-0000-4000-8000-000000000002', recipeVersionId: 'aaaaaaaa-0000-4000-8000-000000000003',
  effectiveFrom: '2026-12-01', mode: 'INGREDIENTS_ON_SALE', reason: 'Publicación verificada' };
beforeEach(() => vi.resetAllMocks());

describe('INV-02.publish: frontera runtime y reintentos acotados', () => {
  it('deniega rol e input antes de abrir una conexión', async () => {
    await expect(publishRecipeConsumptionPolicy({ ...actor, role: 'READONLY' }, input)).rejects.toMatchObject({ statusCode: 403 });
    await expect(publishRecipeConsumptionPolicy(actor, { ...input, companyId: actor.companyId })).rejects.toMatchObject({ statusCode: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each(['40001', '40P01', '23505'])('recupera %s reintentando la transacción entera', async code => {
    const recovered = { status: 'UNCHANGED', policy: { id: 'previously-published' } };
    transaction.mockRejectedValueOnce({ cause: { code } }).mockResolvedValueOnce(recovered);
    expect(await publishRecipeConsumptionPolicy(actor, input)).toEqual(recovered);
    expect(transaction).toHaveBeenCalledTimes(2);
  });
  it('tres conflictos consecutivos entregan un 409 recuperable', async () => {
    transaction.mockRejectedValue({ cause: { code: '40001' } });
    await expect(publishRecipeConsumptionPolicy(actor, input)).rejects.toMatchObject({ statusCode: 409 });
    expect(transaction).toHaveBeenCalledTimes(3);
  });
  it('un error de permisos no se oculta ni se repite', async () => {
    const error = new Error('permission denied'); Object.assign(error, { code: '42501' });
    transaction.mockRejectedValue(error);
    await expect(publishRecipeConsumptionPolicy(actor, input)).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
