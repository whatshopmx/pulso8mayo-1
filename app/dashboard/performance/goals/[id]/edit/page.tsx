import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { users, performanceGoals } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { GoalForm } from '@/components/performance/goal-form';

export default async function EditGoalPage({ params }: { params: Promise<{ id: string }> }) {
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

  const [goal] = await db
    .select()
    .from(performanceGoals)
    .where(and(
      eq(performanceGoals.id, id),
      eq(performanceGoals.companyId, user.companyId)
    ))
    .limit(1);

  if (!goal) {
    notFound();
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Editar Objetivo</h1>
        <p className="text-muted-foreground">
          Actualiza los detalles del objetivo
        </p>
      </div>

      <GoalForm
        companyId={user.companyId}
        userId={user.id}
        goalId={goal.id}
        initialData={goal}
      />
    </div>
  );
}