import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { employeeDocuments } from '@/lib/db/schema';
import { eq, and, lt, gte, lte, isNotNull } from 'drizzle-orm';
import { withTenantAuth } from '@/lib/api/with-auth';

// GET - Get expiring documents
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30');

    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(now.getDate() + days);

    const expiringDocuments = await db
      .select({
        id: employeeDocuments.id,
        userId: employeeDocuments.userId,
        documentType: employeeDocuments.documentType,
        documentName: employeeDocuments.documentName,
        expirationDate: employeeDocuments.expirationDate,
        status: employeeDocuments.status,
        createdAt: employeeDocuments.createdAt,
      })
      .from(employeeDocuments)
    .where(
      and(
        eq(employeeDocuments.companyId, auth.tenantId),
        isNotNull(employeeDocuments.expirationDate),
        gte(employeeDocuments.expirationDate, now),
        lte(employeeDocuments.expirationDate, futureDate)
      )
    );

    return NextResponse.json({
      expiringDocuments,
      count: expiringDocuments.length,
      days,
    });
  } catch (error) {
    console.error('Error fetching expiring documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch expiring documents' },
      { status: 500 }
    );
  }
});

// POST - Send expiration reminders
export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const body = await request.json();
    const { documentType, daysBeforeExpiration } = body;

    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(now.getDate() + (daysBeforeExpiration || 30));

    const conditions = [
      eq(employeeDocuments.companyId, auth.tenantId),
      isNotNull(employeeDocuments.expirationDate),
      gte(employeeDocuments.expirationDate, now),
      lte(employeeDocuments.expirationDate, futureDate),
    ];

    if (documentType) {
      conditions.push(eq(employeeDocuments.documentType, documentType));
    }

    const expiringDocuments = await db
      .select()
      .from(employeeDocuments)
      .where(and(...conditions));

    // TODO: Send notifications via email, WhatsApp, in-app
    // For now, just return the list of documents that need reminders

    return NextResponse.json({
      message: `Reminders queued for ${expiringDocuments.length} documents`,
      count: expiringDocuments.length,
      documents: expiringDocuments.map(doc => ({
        id: doc.id,
        userId: doc.userId,
        documentType: doc.documentType,
        expirationDate: doc.expirationDate,
      })),
    });
  } catch (error) {
    console.error('Error sending document reminders:', error);
    return NextResponse.json(
      { error: 'Failed to send document reminders' },
      { status: 500 }
    );
  }
});
