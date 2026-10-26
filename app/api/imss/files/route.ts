import { NextRequest, NextResponse } from 'next/server';
import { ImssMovementService } from '@/lib/services/compliance/imss-movement-service';
import { generateImssResponse, imssAccess, imssBranchScope, imssError } from '@/lib/services/compliance/imss-http';

export async function POST(req: NextRequest) { return generateImssResponse(req); }

export async function GET(req: NextRequest) {
    try {
        const access = await imssAccess();
        const page = Number(req.nextUrl.searchParams.get('page') || 1);
        const pageSize = Number(req.nextUrl.searchParams.get('pageSize') || 25);
        const data = await ImssMovementService.listFiles(access.companyId, page, pageSize, imssBranchScope(req, access.branchScope));
        return NextResponse.json({ ...data, permissions: { canAcknowledge: access.canAcknowledge } }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return imssError(error); }
}
