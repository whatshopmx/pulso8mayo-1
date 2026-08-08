import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workflowTemplates } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { requirePermissionApi } from '@/lib/rbac/abac';
import { PlaybookService } from '@/lib/services/playbook-service';

/**
 * PATCH /api/templates/[id] — guardado del editor del Builder.
 *
 * Acepta, además de name/steps/description, el alcance del playbook:
 *   - `scope: 'company'` + `branchIds: string[] | null` → delega en
 *     `PlaybookService.publish` (null/[] = todas las sucursales).
 *   - `scope: 'branch'` → `PlaybookService.unpublish` (vuelve a plantilla local).
 *
 * El filtro del UPDATE incluye `companyId`: antes solo filtraba por `id`, así
 * que un id de plantilla de otro tenant era editable desde cualquier cuenta
 * autenticada.
 *
 * Concurrencia optimista (AD-6): con `expectedUpdatedAt` la petición declara
 * sobre qué versión de la fila se editó y recibe 409 si ya no es esa. Es
 * opcional para no romper al resto de llamadores, que siguen comportándose como
 * antes. Sin esto, dos pestañas con la misma plantilla abierta se pisan en
 * silencio y gana la última en escribir.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { user } = await requirePermissionApi('workflows', 'update');
        const companyId = user.companyId;
        if (!companyId) {
            return NextResponse.json({ error: 'Company context required' }, { status: 400 });
        }

        const { id } = await params;
        const body = await request.json();
        const { name, steps, description, scope, branchIds, expectedUpdatedAt } = body;

        if (expectedUpdatedAt) {
            const current = await db.query.workflowTemplates.findFirst({
                where: and(
                    eq(workflowTemplates.id, id),
                    eq(workflowTemplates.companyId, companyId)
                ),
            });

            if (!current) {
                return NextResponse.json({ error: 'Template not found' }, { status: 404 });
            }

            // Se compara en milisegundos: el driver devuelve Date (ms) y el
            // cliente reenvía el ISO que le dimos, mientras que la columna
            // guarda microsegundos. Comparar en SQL daría 409 falsos.
            const expected = new Date(expectedUpdatedAt).getTime();
            const actual = current.updatedAt?.getTime() ?? 0;

            if (expected !== actual) {
                return NextResponse.json(
                    {
                        error: 'La plantilla cambió desde que la abriste. Recarga para ver la versión actual antes de publicar.',
                        updatedAt: current.updatedAt,
                    },
                    { status: 409 }
                );
            }
        }

        const updated = await db
            .update(workflowTemplates)
            .set({
                name: name || undefined,
                steps: steps || undefined,
                description: description || undefined,
                updatedAt: new Date()
            })
            .where(and(
                eq(workflowTemplates.id, id),
                eq(workflowTemplates.companyId, companyId)
            ))
            .returning();

        if (!updated.length) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }

        // Alcance del playbook — opcional: un guardado normal del editor no
        // manda `scope` y no debe alterar la publicación existente.
        let publication: { scope: string; publishedBranchIds: string[] } | null = null;
        if (scope === 'company') {
            publication = await PlaybookService.publish(
                id,
                companyId,
                Array.isArray(branchIds) ? branchIds : null,
                { userId: user.id }
            );
        } else if (scope === 'branch') {
            await PlaybookService.unpublish(id, companyId);
            publication = { scope: 'branch', publishedBranchIds: [] };
        }

        return NextResponse.json({
            success: true,
            template: updated[0],
            // Explícito para que el cliente lo encadene en el siguiente PATCH
            // sin tener que escarbar en el objeto de la plantilla.
            updatedAt: updated[0].updatedAt,
            publication
        });
    } catch (error) {
        console.error('Error updating template:', error);
        const status =
            error && typeof error === 'object' && 'statusCode' in error
                ? (error as { statusCode: number }).statusCode
                : 500;
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to update template' },
            { status }
        );
    }
}
