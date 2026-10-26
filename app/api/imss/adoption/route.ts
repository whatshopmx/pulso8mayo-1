import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { imssAccess, imssError } from '@/lib/services/compliance/imss-http';
import { ImssMovementService } from '@/lib/services/compliance/imss-movement-service';
import { signAdoptionPreview, verifyAdoptionPreview } from '@/lib/services/compliance/imss-adoption-preview';

const selection = z.object({ userIds: z.array(z.string().min(1).max(128)).min(1).max(500), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    branchId: z.uuid(), nota: z.string().trim().min(1).max(2000), dryRun: z.boolean(), previewToken: z.string().max(200000).optional() });

export async function POST(req: NextRequest) {
    try {
        const access = await imssAccess(true);
        const input = selection.parse(await req.json());
        const expectedUserIds = input.dryRun ? undefined : verifyAdoptionPreview(input.previewToken, input, access);
        const result = await ImssMovementService.adoptAsRegistered(access.companyId, { ...input, actorId: access.actorId, expectedUserIds });
        return NextResponse.json({ ...result, previewToken: input.dryRun ? signAdoptionPreview(input, access, result.userIds) : undefined }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return imssError(error); }
}
