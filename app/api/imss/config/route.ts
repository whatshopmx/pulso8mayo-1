import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError } from '@/lib/api/error';
import { imssBranchScope, imssConfigAccess, imssError } from '@/lib/services/compliance/imss-http';
import { ImssConfigService } from '@/lib/services/compliance/imss-config-service';
import { imssRegistroPatronalSchema } from '@/lib/validations/branch';

/**
 * Configuración IMSS sin salir del módulo (`tasks/plan-imss-operacion.md`, T1–T3).
 *
 * `GET` incluye `READONLY` (pantalla consultable); `PATCH` exige
 * `canConfigure`, que en Phase 0 significa `SUPER_ADMIN`/`ADMIN` y en T20
 * sumará `compliance.imss.configure` para un `GERENTE` sobre su sucursal.
 */

const updateSchema = z.object({
    imssRegistroPatronal: imssRegistroPatronalSchema,
    branchUpdates: z.array(z.object({
        branchId: z.string().uuid('La sucursal debe ser un identificador válido'),
        imssRegistroPatronal: imssRegistroPatronalSchema,
    })).min(1, 'Indica al menos una sucursal').max(500).optional(),
}).refine(
    value => value.branchUpdates?.length || value.imssRegistroPatronal !== undefined,
    { message: 'Indica el registro patronal y la sucursal a la que corresponde' },
);

export async function GET(req: NextRequest) {
    try {
        const access = await imssConfigAccess();
        const config = await ImssConfigService.getConfig(
            access.companyId,
            imssBranchScope(req, access.branchScope),
        );
        return NextResponse.json({
            ...config,
            canConfigure: access.canConfigure,
            permissions: { canConfigure: access.canConfigure },
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return imssError(error); }
}

export async function PATCH(req: NextRequest) {
    try {
        const access = await imssConfigAccess();
        if (!access.canConfigure) throw ApiError.forbidden('No tienes permiso para capturar el registro patronal');

        const raw: unknown = await req.json();
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return NextResponse.json({ error: 'Solicitud IMSS inválida' }, { status: 400 });
        }
        const input = updateSchema.parse(raw);

        await ImssConfigService.updateConfig(
            access.companyId,
            access.actorId,
            input,
            imssBranchScope(req, access.branchScope),
        );

        // Se responde con lo que quedó guardado, no con lo que pidió el
        // formulario: la normalización (mayúsculas, `""` → `NULL`) ocurre en el
        // contrato y la pantalla necesita ver el valor real.
        const config = await ImssConfigService.getConfig(
            access.companyId,
            imssBranchScope(req, access.branchScope),
        );
        return NextResponse.json({
            ...config,
            canConfigure: access.canConfigure,
            permissions: { canConfigure: access.canConfigure },
        }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return imssError(error); }
}
