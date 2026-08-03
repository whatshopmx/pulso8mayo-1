import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { employeeCommunications, users, employeeProfiles } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

const JWT_SECRET = process.env.JWT_SECRET || "pulso-secret-key-12345";

export const announcementBroadcastFn = inngest.createFunction(
  {
    id: "announcement-broadcast",
    triggers: [{ event: "communication/announcement.broadcast" }],
    retries: 2,
  },
  async ({ event, step }) => {
    const { announcementId } = event.data;

    // 1. Fetch the announcement
    const announcement = await step.run("fetch-announcement", async () => {
      return await db.query.employeeCommunications.findFirst({
        where: eq(employeeCommunications.id, announcementId),
      });
    });

    if (!announcement) {
      console.warn(`[Inngest] Announcement ${announcementId} not found`);
      return { success: false, error: "Announcement not found" };
    }

    // 2. Fetch target users
    const targetUsers = await step.run("fetch-target-users", async () => {
      const userConditions = [
        eq(users.companyId, announcement.companyId),
        eq(users.active, true)
      ];

      // Role filtering
      if (announcement.targetRoles && Array.isArray(announcement.targetRoles) && announcement.targetRoles.length > 0) {
        userConditions.push(inArray(users.role, announcement.targetRoles as any));
      }

      // Branch filtering
      if (announcement.targetType === 'BRANCH' && announcement.targetIds && Array.isArray(announcement.targetIds) && announcement.targetIds.length > 0) {
        userConditions.push(inArray(users.branchId, announcement.targetIds as string[]));
      }

      // Individual targeting
      if (announcement.targetType === 'INDIVIDUAL' && announcement.targetIds && Array.isArray(announcement.targetIds) && announcement.targetIds.length > 0) {
        userConditions.push(inArray(users.id, announcement.targetIds as string[]));
      }

      let query = db.select({
        id: users.id,
        name: users.name,
      }).from(users);

      // Department filtering requires join with employeeProfiles
      if (announcement.targetType === 'DEPARTMENT' && announcement.targetIds && Array.isArray(announcement.targetIds) && announcement.targetIds.length > 0) {
        // @ts-ignore
        query = query.leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId));
        userConditions.push(inArray(employeeProfiles.department, announcement.targetIds as string[]));
      }

      return await query.where(and(...userConditions));
    });

    if (!targetUsers || targetUsers.length === 0) {
      return { success: true, sent: 0, message: "No target users found" };
    }

    // 3. Dispatch notifications
    let successCount = 0;
    for (const targetUser of targetUsers) {
      await step.run(`send-broadcast-${targetUser.id}`, async () => {
        const token = jwt.sign(
          {
            userId: targetUser.id,
            announcementId: announcement.id,
            type: 'ANNOUNCEMENT_READ',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days expiration
          },
          JWT_SECRET,
          { algorithm: 'HS256' }
        );

        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const smartLinkUrl = `${baseUrl}/communication/public/${token}`;

        await NotificationDispatcher.sendNotification({
          userId: targetUser.id,
          title: `Nuevo Anuncio: ${announcement.title}`,
          message: `Hay un nuevo anuncio de lectura obligatoria: ${announcement.title}`,
          type: "info",
          eventType: "announcement_broadcast",
          actionUrl: `/communication/public/${token}`,
          actionLabel: "Ver Anuncio",
          metadata: {
            title: announcement.title,
            bodySnippet: announcement.content.length > 100 
              ? announcement.content.substring(0, 100) + '...'
              : announcement.content,
            body: announcement.content,
            smartLinkUrl,
          }
        });
      });
      successCount++;
    }

    // 4. Update the announcement delivered via list if it is not already updated
    await step.run("update-announcement-status", async () => {
      const deliveredVia = Array.isArray(announcement.deliveredVia) ? [...announcement.deliveredVia] : [];
      if (!deliveredVia.includes("WHATSAPP")) {
        deliveredVia.push("WHATSAPP");
      }
      await db.update(employeeCommunications)
        .set({
          status: 'SENT',
          sentAt: new Date(),
          deliveredVia,
          totalRecipients: targetUsers.length,
          updatedAt: new Date(),
        })
        .where(eq(employeeCommunications.id, announcementId));
    });

    return { success: true, sent: successCount };
  }
);
