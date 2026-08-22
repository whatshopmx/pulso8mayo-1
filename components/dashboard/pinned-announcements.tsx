import { db } from "@/lib/db";
import { employeeCommunications } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { CollapsibleAnnouncements } from "./collapsible-announcements";

interface PinnedAnnouncementsProps {
  companyId: string;
}

/**
 * Server Component under the AD-2 floor: fetches pinned announcements on the
 * server and streams via its own <Suspense> boundary in the page.
 */
export async function PinnedAnnouncements({ companyId }: PinnedAnnouncementsProps) {
  const t = await getTranslations("dashboard.executive");

  const pinnedAnnouncements = await db.select({
    id: employeeCommunications.id,
    title: employeeCommunications.title,
    content: employeeCommunications.content,
    communicationType: employeeCommunications.communicationType,
    createdAt: employeeCommunications.createdAt,
  })
    .from(employeeCommunications)
    .where(and(
      eq(employeeCommunications.companyId, companyId),
      eq(employeeCommunications.isPinned, true)
    ))
    .orderBy(desc(employeeCommunications.createdAt))
    .limit(3);

  return (
    <CollapsibleAnnouncements
      announcements={pinnedAnnouncements}
      titleLabel={t("announcement")}
      announcementLabel={t("announcement")}
      notificationLabel={t("notification")}
      messageLabel={t("message")}
    />
  );
}
