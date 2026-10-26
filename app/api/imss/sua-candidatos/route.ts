import { NextRequest, NextResponse } from 'next/server';
import { imssAccess, imssBranchScope, imssError } from '@/lib/services/compliance/imss-http';
import { ImssMovementService } from '@/lib/services/compliance/imss-movement-service';

export async function GET(req: NextRequest) {
    try {
        const access = await imssAccess();
        return NextResponse.json(await ImssMovementService.getSuaCandidates(access.companyId, imssBranchScope(req, access.branchScope),
            req.nextUrl.searchParams.get('bimestre') || undefined, req.nextUrl.searchParams.get('fechaMovimiento') || undefined), { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return imssError(error); }
}
