import { NextRequest } from 'next/server';
import { generateImssResponse } from '@/lib/services/compliance/imss-http';

/** Alias compatible: delega en el circuito persistido de /api/imss/files. */
export async function POST(req: NextRequest) {
    return generateImssResponse(req, 'SUA');
}
