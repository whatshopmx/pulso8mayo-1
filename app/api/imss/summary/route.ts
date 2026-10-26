import { NextRequest, NextResponse } from 'next/server';
import { imssAccess, imssBranchScope, imssError } from '@/lib/services/compliance/imss-http';
import { ImssMovementService } from '@/lib/services/compliance/imss-movement-service';

export async function GET(req: NextRequest) {
    try {
        const access = await imssAccess();
        const stats = await ImssMovementService.getDashboardSummary(access.companyId, imssBranchScope(req, access.branchScope));
        return NextResponse.json({ stats, permissions: { canAdopt: access.canAcknowledge, canAcknowledge: access.canAcknowledge } }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { return imssError(error); }
}
