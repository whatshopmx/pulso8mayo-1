import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { employeeDocuments, users } from '@/lib/db/schema';
import { eq, and, gte, lte, isNotNull } from 'drizzle-orm';
import { withTenantAuth } from '@/lib/api/with-auth';
import { NotificationDispatcher } from '@/lib/services/notification-dispatcher';

// WhatsApp/email fan-out happens one recipient at a time inside the dispatcher, so
// send in small batches: a company with hundreds of expiring documents would
// otherwise open that many provider calls at once.
const REMINDER_BATCH_SIZE = 10;

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
    const { documentType } = body;

    // Guard the window: a non-numeric value would produce an Invalid Date and a
    // query that silently matches nothing.
    const parsedDays = Number(body.daysBeforeExpiration);
    const daysBeforeExpiration =
      Number.isFinite(parsedDays) && parsedDays > 0 ? Math.floor(parsedDays) : 30;

    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(now.getDate() + daysBeforeExpiration);

    const conditions = [
      eq(employeeDocuments.companyId, auth.tenantId),
      isNotNull(employeeDocuments.expirationDate),
      gte(employeeDocuments.expirationDate, now),
      lte(employeeDocuments.expirationDate, futureDate),
    ];

    if (documentType) {
      conditions.push(eq(employeeDocuments.documentType, documentType));
    }

    // Join the owner: the reminder goes to them, and the dispatcher needs a name.
    // Documents whose userId no longer resolves cannot be notified and are reported
    // separately rather than silently inflating the sent count.
    const expiringDocuments = await db
      .select({
        id: employeeDocuments.id,
        userId: employeeDocuments.userId,
        documentType: employeeDocuments.documentType,
        documentName: employeeDocuments.documentName,
        expirationDate: employeeDocuments.expirationDate,
        userName: users.name,
        ownerId: users.id,
      })
      .from(employeeDocuments)
      .leftJoin(users, eq(employeeDocuments.userId, users.id))
      .where(and(...conditions));

    // Key off the joined id, not the name: a real user may simply have no name set.
    const notifiable = expiringDocuments.filter(doc => doc.ownerId !== null);
    const skipped = expiringDocuments.length - notifiable.length;

    // The dispatcher resolves per-user channel preferences and swallows its own
    // per-channel errors, so a rejection here means the call itself failed.
    let dispatched = 0;
    let failed = 0;

    for (let i = 0; i < notifiable.length; i += REMINDER_BATCH_SIZE) {
      const batch = notifiable.slice(i, i + REMINDER_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(doc => {
          const daysUntilExpiration = Math.ceil(
            (doc.expirationDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );

          return NotificationDispatcher.sendDocumentExpirationAlert({
            userId: doc.userId,
            userName: doc.userName || 'Usuario',
            documentName: doc.documentName,
            documentType: doc.documentType,
            expirationDate: doc.expirationDate!,
            daysUntilExpiration,
          });
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          dispatched++;
        } else {
          failed++;
          console.error('Error dispatching document expiration reminder:', result.reason);
        }
      }
    }

    return NextResponse.json({
      message: `Recordatorios enviados para ${dispatched} de ${expiringDocuments.length} documentos`,
      count: expiringDocuments.length,
      dispatched,
      failed,
      skipped,
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
