import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { PerformanceReviewList } from '@/components/performance/review-list';

export default async function ReviewsPage() {
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

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Evaluaciones de Desempeño</h1>
        <p className="text-muted-foreground">
          Gestiona y consulta todas las evaluaciones de desempeño
        </p>
      </div>

      <PerformanceReviewList
        companyId={user.companyId}
      />
    </div>
  );
}
