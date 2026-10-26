import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, isApiError } from '@/lib/api/error';
import { requireTenant } from '@/lib/tenant-context';
import { requireRoleApi } from '@/lib/rbac/require-role';
import { ImssMovementService } from './imss-movement-service';
import { todayInMx } from './imss-rules';

const generationSchema = z.object({
    employeeIds: z.array(z.string().min(1).max(128)).min(1).max(500),
    movementType: z.enum(['ALTA', 'BAJA', 'MOD_SALARIO']),
    fechaMovimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    layout: z.enum(['IDSE', 'SUA']).default('IDSE'),
    newSalaries: z.record(z.string(), z.number().finite().positive()).optional(),
    bimestre: z.string().regex(/^\d{4}-(01|03|05|07|09|11)$/).optional(),
});

export async function imssAccess(acknowledge = false) {
    const context = await requireRoleApi(acknowledge ? ['SUPER_ADMIN', 'ADMIN'] : ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR']);
    const tenant = await requireTenant();
    if (!tenant.id) throw ApiError.badRequest('La sesión no tiene empresa');
    const scoped = context.userRole === 'GERENTE' || context.userRole === 'SUPERVISOR';
    if (scoped && !context.user.branchId) throw ApiError.forbidden('La sesión no tiene sucursal asignada');
    return { companyId: tenant.id, actorId: context.user.id, branchScope: scoped ? context.user.branchId! : undefined, canAcknowledge: !scoped };
}

/** Un filtro del cliente solo puede reducir el alcance que ya fijó la sesión. */
export function imssBranchScope(req: Request, branchScope?: string) {
    const requested = new URL(req.url).searchParams.get('branchId');
    if (!requested || ['all', 'ALL'].includes(requested)) return branchScope;
    if (branchScope && branchScope !== requested) throw ApiError.forbidden('La sucursal no pertenece a tu alcance');
    return requested;
}

export function imssError(error: unknown) {
    if (isApiError(error)) return NextResponse.json({ error: error.message, details: error.details }, { status: error.statusCode });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: 'Solicitud IMSS inválida' }, { status: 400 });
    console.error('[IMSS] Error interno de operación');
    return NextResponse.json({ error: 'No se pudo completar la operación IMSS' }, { status: 500 });
}

export async function generateImssResponse(req: NextRequest, legacyLayout?: 'IDSE' | 'SUA') {
    try {
        const access = await imssAccess();
        const raw: unknown = await req.json();
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw ApiError.badRequest('Solicitud IMSS inválida');
        const body = raw as Record<string, unknown>;
        const codes: Record<string, string> = { '08': 'ALTA', '02': 'BAJA', '07': 'MOD_SALARIO' };
        const input = generationSchema.parse({ ...body, layout: legacyLayout || body.layout,
            movementType: legacyLayout === 'SUA' ? 'MOD_SALARIO' : codes[String(body.movementType)] || body.movementType,
            fechaMovimiento: body.fechaMovimiento || (legacyLayout === 'IDSE' ? todayInMx().toISOString().slice(0, 10) : undefined),
        });
        const result = await ImssMovementService.generateFile(access.companyId, { ...input, branchScope: access.branchScope }, access.actorId);
        return new Response(result.content, { headers: {
            'Content-Type': 'text/plain;charset=utf-8', 'Content-Disposition': `attachment; filename="${result.fileName}"`,
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-File-Id': result.fileId, 'X-Content-SHA256': result.sha256,
            'X-Imss-Layout-Version': result.layoutVersion, 'X-Imss-Layout-Notice': 'WORKING_FILE_UNVERIFIED',
            'X-Imss-Download-Available': String(result.downloadAvailable),
            'X-Imss-Included-Count': String(result.lineCount), 'X-Imss-Excluded-Count': String(result.excluded.length),
            'X-Imss-Excluded-Reason': result.excluded.map(row => row.reason).join(','), 'X-Imss-Excluded': encodeURIComponent(JSON.stringify(result.excluded)),
        } });
    } catch (error) { return imssError(error); }
}
