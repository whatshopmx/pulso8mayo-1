/**
 * Performance Reminder Service
 *
 * Daily cron that nudges reviewers whose performance reviews have been
 * sitting in DRAFT/IN_PROGRESS for more than 7 days.
 */

import { db } from '@/lib/db';
import {
  performanceReviews,
  users,
} from '@/lib/db/schema';
import { eq, and, lt, or } from 'drizzle-orm';
import { NotificationService } from '@/lib/services/notification-service';

const STALE_DAYS = 7;

export interface PerformanceReminderResult {
  success: boolean;
  reviewsReminded: number;
  reviewersNotified: number;
  errors?: string[];
}

export class PerformanceReminderService {
  /**
   * Find stale reviews and notify their reviewers.
   */
  static async checkAndSendReminders(): Promise<PerformanceReminderResult> {
    try {
      console.log('[Performance Reminder] Checking for stale reviews...');

      const errors: string[] = [];
      const reviewsReminded: string[] = [];
      const reviewersNotified = new Set<string>();

      const staleReviews = await this.getStaleReviews();

      console.log(`[Performance Reminder] Found ${staleReviews.length} stale reviews`);

      for (const review of staleReviews) {
        try {
          reviewsReminded.push(review.id);

          const employee = review.userName || 'empleado';
          const period = review.reviewPeriod || 'sin período';
          const message =
            `Recordatorio de Pulso: tu evaluación de ${employee} (${period}) lleva ` +
            `${STALE_DAYS}+ días sin completarse. ` +
            `Entra a Pulso para terminarla antes de que se acumule.`;

          await NotificationService.sendWhatsAppNotification(review.reviewerId, message);
          reviewersNotified.add(review.reviewerId);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Failed to remind reviewer for review ${review.id}: ${errorMsg}`);
          console.error(`[Performance Reminder] Error for review ${review.id}:`, error);
        }
      }

      console.log(
        `[Performance Reminder] Reviews reminded: ${reviewsReminded.length}, Reviewers notified: ${reviewersNotified.size}`
      );

      return {
        success: true,
        reviewsReminded: reviewsReminded.length,
        reviewersNotified: reviewersNotified.size,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      console.error('[Performance Reminder] Error in checkAndSendReminders:', error);

      return {
        success: false,
        reviewsReminded: 0,
        reviewersNotified: 0,
        errors: error instanceof Error ? [error.message] : ['Unknown error'],
      };
    }
  }

  /**
   * Reviews in DRAFT/IN_PROGRESS created more than STALE_DAYS ago.
   */
  static async getStaleReviews() {
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

    return db
      .select({
        id: performanceReviews.id,
        reviewerId: performanceReviews.reviewerId,
        reviewPeriod: performanceReviews.reviewPeriod,
        userName: users.name,
      })
      .from(performanceReviews)
      .leftJoin(users, eq(performanceReviews.userId, users.id))
      .where(and(
        or(
          eq(performanceReviews.status, 'DRAFT'),
          eq(performanceReviews.status, 'IN_PROGRESS')
        ),
        lt(performanceReviews.createdAt, cutoff)
      ));
  }
}