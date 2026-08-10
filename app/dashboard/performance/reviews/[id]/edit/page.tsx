import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { users, performanceReviews, performanceReviewResponses } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { ReviewForm } from '@/components/performance/review-form';

export default async function EditReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  if (!session?.user?.id) {
    redirect('/sign-in');
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id));

  if (!user || !user.companyId) {
    redirect('/onboarding');
  }

  const [review] = await db
    .select()
    .from(performanceReviews)
    .where(and(
      eq(performanceReviews.id, id),
      eq(performanceReviews.companyId, user.companyId)
    ))
    .limit(1);

  if (!review) {
    notFound();
  }

  const [employee] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, review.userId))
    .limit(1);

  const criteriaResponses = await db
    .select({
      criteriaId: performanceReviewResponses.criteriaId,
      rating: performanceReviewResponses.rating,
      comments: performanceReviewResponses.comments,
    })
    .from(performanceReviewResponses)
    .where(eq(performanceReviewResponses.reviewId, id));

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Editar Evaluación de Desempeño</h1>
        <p className="text-muted-foreground">
          Actualiza la evaluación de {employee?.name || 'empleado'} — {review.reviewPeriod}
        </p>
      </div>

      <ReviewForm
        companyId={user.companyId}
        userId={user.id}
        reviewId={review.id}
        initialData={{ ...review, criteriaResponses }}
      />
    </div>
  );
}