'use server';

import { db } from "@/lib/db";
import { communicationReadReceipts, employeeCommunications } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export async function markAsReadAction(userId: string, announcementId: string) {
  try {
    // Check if already read
    const [existing] = await db
      .select()
      .from(communicationReadReceipts)
      .where(
        and(
          eq(communicationReadReceipts.communicationId, announcementId),
          eq(communicationReadReceipts.userId, userId)
        )
      )
      .limit(1);

    if (existing) {
      return { success: true, alreadyRead: true, readAt: existing.readAt };
    }

    // Insert read receipt
    await db.insert(communicationReadReceipts).values({
      communicationId: announcementId,
      userId: userId,
      readAt: new Date(),
    });

    // Increment read count
    await db.update(employeeCommunications)
      .set({
        readCount: sql`${employeeCommunications.readCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(employeeCommunications.id, announcementId));

    return { success: true, alreadyRead: false, readAt: new Date() };
  } catch (error) {
    console.error("Error in markAsReadAction:", error);
    return { success: false, error: error instanceof Error ? error.message : "Error al registrar lectura" };
  }
}
