import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { withTenantAuth } from '@/lib/api/with-auth';
import { isApiError } from '@/lib/api/error';
import { accrueLeaveEntitlements, accrualSchema, balanceQuerySchema, entitlementSchema,
  getLeaveBalances, setLeaveEntitlement } from '@/lib/services/leave-balance-service';

function failure(error: unknown) {
  if (isApiError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Entrada inválida.' }, { status: 400 });
  // No publicar objetos del driver, SQL ni datos personales en logs/respuestas.
  console.error('[leave-balances] No se pudo completar la operación.');
  return NextResponse.json({ error: 'No se pudo completar la operación de saldos.' }, { status: 500 });
}

export const GET = withTenantAuth(async (request, { auth }) => {
  try {
    const params = new URL(request.url).searchParams;
    if (params.has('companyId') && params.get('companyId') !== auth.tenantId) return NextResponse.json({ error: 'Empresa fuera de alcance.' }, { status: 403 });
    const query = balanceQuerySchema.parse({ userId: params.get('userId') ?? undefined, year: params.get('year') ?? undefined });
    const balances = await getLeaveBalances({ userId: auth.user.id, companyId: auth.tenantId }, query);
    return NextResponse.json({ balances });
  } catch (error) { return failure(error); }
});

export const POST = withTenantAuth(async (request, { auth }) => {
  try {
    const input = entitlementSchema.parse(await request.json());
    const result = await setLeaveEntitlement({ userId: auth.user.id, companyId: auth.tenantId }, input);
    return NextResponse.json({ balance: result.balance, changed: result.changed, message: result.changed ? 'Asignación guardada.' : 'La asignación ya estaba registrada.' }, { status: result.created ? 201 : 200 });
  } catch (error) { return failure(error); }
});

export const PATCH = withTenantAuth(async (request, { auth }) => {
  try {
    const input = accrualSchema.parse(await request.json());
    const result = await accrueLeaveEntitlements({ userId: auth.user.id, companyId: auth.tenantId }, input);
    return NextResponse.json({ ...result, message: 'Asignaciones procesadas.' });
  } catch (error) { return failure(error); }
});
