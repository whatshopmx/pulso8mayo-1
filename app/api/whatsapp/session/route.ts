/**
 * WhatsApp Session API
 * 
 * Endpoints for managing WhatsApp sessions
 */

import { NextRequest, NextResponse } from 'next/server';
import { sessionManager } from '@/lib/whatsapp/session-manager';
import { auth } from '@/lib/auth';

/**
 * GET /api/whatsapp/session
 * Get current company's WhatsApp session
 */
export async function GET(req: NextRequest) {
    try {
        const authSession = await auth.api.getSession({ headers: req.headers });
        if (!authSession?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const companyId = authSession.user.companyId as string;
        if (!companyId) {
            return NextResponse.json({ error: 'Company not found' }, { status: 400 });
        }

        const whatsappSession = await sessionManager.getActiveSession(companyId);

        if (!whatsappSession) {
            return NextResponse.json({ session: null });
        }

        return NextResponse.json({ session: whatsappSession });
    } catch (error) {
        console.error('[WhatsApp Session API] GET error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/whatsapp/session
 * Create a new WhatsApp session
 */
export async function POST(req: NextRequest) {
    try {
        const authSession = await auth.api.getSession({ headers: req.headers });
        if (!authSession?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const companyId = authSession.user.companyId as string;
        if (!companyId) {
            return NextResponse.json({ error: 'Company not found' }, { status: 400 });
        }

        // Check if user has permission (only OWNER or GERENTE can create sessions)
        const userRole = authSession.user.role as string;
        if (!['OWNER', 'GERENTE'].includes(userRole)) {
            return NextResponse.json(
                { error: 'Insufficient permissions' },
                { status: 403 }
            );
        }

        const whatsappSession = await sessionManager.createSession(companyId, authSession.user.id);

        return NextResponse.json({ session: whatsappSession }, { status: 201 });
    } catch (error) {
        console.error('[WhatsApp Session API] POST error:', error);

        if (error instanceof Error && error.message.includes('already has an active')) {
            return NextResponse.json(
                { error: error.message },
                { status: 409 }
            );
        }

        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/whatsapp/session
 * Delete current company's WhatsApp session
 */
export async function DELETE(req: NextRequest) {
    try {
        const authSession = await auth.api.getSession({ headers: req.headers });
        if (!authSession?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const companyId = authSession.user.companyId as string;
        if (!companyId) {
            return NextResponse.json({ error: 'Company not found' }, { status: 400 });
        }

        // Check if user has permission
        const userRole = authSession.user.role as string;
        if (!['OWNER', 'GERENTE'].includes(userRole)) {
            return NextResponse.json(
                { error: 'Insufficient permissions' },
                { status: 403 }
            );
        }

        const whatsappSession = await sessionManager.getActiveSession(companyId);
        if (!whatsappSession) {
            return NextResponse.json({ error: 'No active session found' }, { status: 404 });
        }

        await sessionManager.deleteSession(whatsappSession.sessionId);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[WhatsApp Session API] DELETE error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
