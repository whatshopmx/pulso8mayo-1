import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { employeeCommunications, communicationReadReceipts, users, employeeProfiles } from '@/lib/db/schema';
import { eq, and, desc, or, sql, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { WhatsAppService } from '@/lib/services/whatsapp-service';
import { withTenantAuth } from '@/lib/api/with-auth';
import { inngest } from '@/lib/inngest/client';

const createAnnouncementSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  communicationType: z.enum(['MESSAGE', 'ANNOUNCEMENT', 'NOTIFICATION', 'POLICY']).default('ANNOUNCEMENT'),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  targetType: z.enum(['INDIVIDUAL', 'DEPARTMENT', 'BRANCH', 'COMPANY']).default('COMPANY'),
  targetIds: z.array(z.string()).optional(),
  targetRoles: z.array(z.string()).optional(),
  isPinned: z.boolean().default(false),
  deliveredVia: z.array(z.string()).optional(),
});

// GET - List announcements
export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const type = searchParams.get('type');
    const pinnedOnly = searchParams.get('pinnedOnly');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const conditions = [eq(employeeCommunications.companyId, auth.tenantId)];

    if (branchId) conditions.push(eq(employeeCommunications.branchId, branchId));
    if (type) conditions.push(eq(employeeCommunications.communicationType, type));
    if (pinnedOnly === 'true') conditions.push(eq(employeeCommunications.isPinned, true));

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(employeeCommunications)
      .where(and(...conditions));

    const announcements = await db
      .select({
        id: employeeCommunications.id,
        companyId: employeeCommunications.companyId,
        branchId: employeeCommunications.branchId,
        communicationType: employeeCommunications.communicationType,
        title: employeeCommunications.title,
        content: employeeCommunications.content,
        targetType: employeeCommunications.targetType,
        targetIds: employeeCommunications.targetIds,
        targetRoles: employeeCommunications.targetRoles,
        status: employeeCommunications.status,
        isPinned: employeeCommunications.isPinned,
        sentAt: employeeCommunications.sentAt,
        deliveredVia: employeeCommunications.deliveredVia,
        readCount: employeeCommunications.readCount,
        totalRecipients: employeeCommunications.totalRecipients,
        createdBy: employeeCommunications.createdBy,
        createdAt: employeeCommunications.createdAt,
        authorName: users.name,
      })
      .from(employeeCommunications)
      .leftJoin(users, eq(employeeCommunications.createdBy, users.id))
      .where(and(...conditions))
      .orderBy(desc(employeeCommunications.isPinned), desc(employeeCommunications.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    return NextResponse.json({
      announcements,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    });
  } catch (error) {
    console.error('Error fetching announcements:', error);
    return NextResponse.json({ error: 'Failed to fetch announcements' }, { status: 500 });
  }
});

// POST - Create announcement
export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const body = await request.json();
    const validated = createAnnouncementSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validated.error.issues },
        { status: 400 }
      );
    }

    const data = validated.data;

    // 1. Resolve Target Users to calculate totalRecipients — scoped to authenticated tenant
    const userConditions = [eq(users.companyId, auth.tenantId), isNull(users.deletedAt)];
    
    // Role filtering
    if (data.targetRoles && data.targetRoles.length > 0) {
      userConditions.push(inArray(users.role, data.targetRoles as any));
    }

    // Branch filtering
    if (data.targetType === 'BRANCH' && data.targetIds && data.targetIds.length > 0) {
      userConditions.push(inArray(users.branchId, data.targetIds));
    }

    // Individual targeting
    if (data.targetType === 'INDIVIDUAL' && data.targetIds && data.targetIds.length > 0) {
      userConditions.push(inArray(users.id, data.targetIds));
    }

    let query = db.select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      whatsappPhone: users.whatsappPhone,
    }).from(users);

    // Department filtering requires join with employeeProfiles
    if (data.targetType === 'DEPARTMENT' && data.targetIds && data.targetIds.length > 0) {
      // @ts-ignore - leftJoin might type weird in some versions but works
      query = query.leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId));
      userConditions.push(inArray(employeeProfiles.department, data.targetIds));
    }

    const targetUsers = await query.where(and(...userConditions));

    // 2. Insert Announcement with calculated recipient count
    const [newAnnouncement] = await db
      .insert(employeeCommunications)
      .values({
        ...data,
        companyId: auth.tenantId,
        createdBy: auth.user.id,
        status: 'SENT',
        sentAt: new Date(),
        totalRecipients: targetUsers.length,
      })
      .returning();

    // 3. Trigger Inngest broadcast if WhatsApp delivery requested
    if (data.deliveredVia?.includes('WHATSAPP') && targetUsers.length > 0) {
      try {
        await inngest.send({
          name: "communication/announcement.broadcast",
          data: {
            announcementId: newAnnouncement.id,
            companyId: auth.tenantId,
          },
        });
      } catch (inngestErr) {
        console.error("Error sending Inngest broadcast event:", inngestErr);
      }
    }

    return NextResponse.json(
      { announcement: newAnnouncement, message: 'Announcement created successfully' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating announcement:', error);
    return NextResponse.json({ error: 'Failed to create announcement' }, { status: 500 });
  }
});

// PATCH - Update announcement (pin/unpin, edit, archive)
export const PATCH = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const announcementId = searchParams.get('id');

    if (!announcementId) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    const body = await request.json();

    const updateData: any = {
      ...body,
      updatedAt: new Date(),
    };

    const [updated] = await db
      .update(employeeCommunications)
      .set(updateData)
      .where(eq(employeeCommunications.id, announcementId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });
    }

    return NextResponse.json({ announcement: updated, message: 'Updated successfully' });
  } catch (error) {
    console.error('Error updating announcement:', error);
    return NextResponse.json({ error: 'Failed to update announcement' }, { status: 500 });
  }
});

// DELETE - Delete announcement
export const DELETE = withTenantAuth(async (request: NextRequest, { auth }) => {
  try {
    const { searchParams } = new URL(request.url);
    const announcementId = searchParams.get('id');

    if (!announcementId) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    const deleted = await db
      .delete(employeeCommunications)
      .where(eq(employeeCommunications.id, announcementId))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Announcement deleted successfully' });
  } catch (error) {
    console.error('Error deleting announcement:', error);
    return NextResponse.json({ error: 'Failed to delete announcement' }, { status: 500 });
  }
});
