import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { workflowTemplates } from '@/lib/db/schema';
import { isApiError } from '@/lib/api/error';
import {
    cargarPlantillaDeEmpresa,
    plantillaDeEmpresa,
    requireTemplateAccess,
} from '@/lib/workflows/template-access';

/**
 * `GET|PATCH|DELETE /api/workflows/templates/[id]` — compatibilidad de la ruta
 * corta, ahora con la misma política que `/api/templates/[id]`.
 *
 * Antes estas tres sólo comprobaban que hubiera sesión: cualquier cuenta
 * autenticada leía, editaba o borraba la plantilla de otra empresa con el id
 * (H02). El listado de la misma familia sí filtraba por empresa, así que la
 * protección dependía de qué ruta tomara el navegador.
 *
 * La política vive en `lib/workflows/template-access.ts`; aquí sólo se declara
 * el verbo. Las dos rutas siguen existiendo durante la transición: borrarla
 * porque tiene otro nombre dejaría al administrador de plantillas sin destino.
 */

/** Convierte un error de dominio en la respuesta HTTP que corresponde. */
function responder(error: unknown, etiqueta: string) {
    if (isApiError(error)) {
        return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error(etiqueta, error);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
}

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const actor = await requireTemplateAccess('read');
        const { id } = await params;

        const plantilla = await cargarPlantillaDeEmpresa(actor, id);

        return NextResponse.json(plantilla);
    } catch (error) {
        return responder(error, "[WORKFLOW_TEMPLATE_GET]");
    }
}

export async function PATCH(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const actor = await requireTemplateAccess('update');
        const { id } = await params;

        const body = await req.json();
        const { name, description, category, steps, active } = body;

        const [updatedTemplate] = await db.update(workflowTemplates)
            .set({
                ...(name && { name }),
                ...(description && { description }),
                ...(category && { category }),
                ...(steps && { steps }),
                ...(active !== undefined && { active }),
                updatedAt: new Date(),
            })
            .where(plantillaDeEmpresa(id, actor.companyId))
            .returning();

        if (!updatedTemplate) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }

        return NextResponse.json(updatedTemplate);
    } catch (error) {
        return responder(error, "[WORKFLOW_TEMPLATE_PATCH]");
    }
}

export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const actor = await requireTemplateAccess('delete');
        const { id } = await params;

        // Se carga primero para que borrar por id siga el mismo contrato que las
        // otras dos operaciones: o es de esta empresa, o 404.
        await cargarPlantillaDeEmpresa(actor, id);

        await db.delete(workflowTemplates)
            .where(plantillaDeEmpresa(id, actor.companyId));

        return new NextResponse("Deleted", { status: 200 });
    } catch (error) {
        return responder(error, "[WORKFLOW_TEMPLATE_DELETE]");
    }
}