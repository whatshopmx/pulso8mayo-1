import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { GoalsList } from '@/components/performance/goals-list';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus } from 'lucide-react';

export default async function GoalsPage() {
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Objetivos de Desempeño</h1>
          <p className="text-muted-foreground">
            Gestiona y da seguimiento a los objetivos de tu equipo
          </p>
        </div>
        <Link href="/dashboard/performance/goals/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Objetivo
          </Button>
        </Link>
      </div>

      <GoalsList
        companyId={user.companyId}
      />
    </div>
  );
}
