import { NextRequest, NextResponse } from 'next/server';
import { StockCountService } from '@/lib/services/stock-count-service';
import { requireExecutionAccess, assertBranchDestino } from '@/lib/workflows/execution-access';
import { ApiError, isApiError } from '@/lib/api/error';

/**
 * GET /api/inventory/stock-count/rows?branchId=&category=&highValueOnly=
 *
 * Filas de un conteo por categoría: un renglón por lote disponible de la
 * sucursal (FEFO) más los productos sin lote. Alimenta el formulario que
 * aparece al seleccionar la categoría, sin crear todavía la instancia.
 *
 * La empresa sale de la sesión y la sucursal se valida contra el alcance del
 * actor: el cliente nunca decide de qué empresa son las filas.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireExecutionAccess('read');
    const params = new URL(request.url).searchParams;
    const branchId = params.get('branchId') || actor.branchId || '';
    const category = params.get('category') || '';
    const highValueOnly = params.get('highValueOnly') === 'true';

    if (!branchId) throw ApiError.badRequest('Selecciona una sucursal para cargar los productos.');
    if (!category.trim()) throw ApiError.badRequest('Selecciona una categoría para cargar los productos.');

    await assertBranchDestino(actor, branchId);
    const rows = await StockCountService.getCountRows(actor.companyId, branchId, category, highValueOnly);
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudieron cargar los productos.' },
      { status: isApiError(error) ? error.statusCode : 500 },
    );
  }
}
