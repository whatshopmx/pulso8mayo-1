import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ImssMovementService } from '@/lib/services/compliance/imss-movement-service';
import { imssAccess, imssError } from '@/lib/services/compliance/imss-http';

const acuseSchema = z.object({ accepted: z.boolean(), acuseFolio: z.string().trim().min(1).max(200).optional(), reason: z.string().trim().min(1).max(2000).optional() });
type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Context) {
    try {
        const access = await imssAccess(true);
        const id = z.uuid().parse((await params).id);
        const input = acuseSchema.parse(await req.json());
        const file = await ImssMovementService.confirmFile(access.companyId, id, input, access.actorId);
        return NextResponse.json({ file });
    } catch (error) { return imssError(error); }
}

export async function GET(_req: NextRequest, { params }: Context) {
    try {
        const access = await imssAccess();
        const id = z.uuid().parse((await params).id);
        const file = await ImssMovementService.downloadFile(access.companyId, id, access.branchScope);
        return new Response(new Uint8Array(file.content), { headers: { 'Content-Type': 'text/plain;charset=utf-8',
            'Content-Disposition': `attachment; filename="${file.fileName}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch (error) { return imssError(error); }
}
