/**
 * Playbooks del grupo — listado y administración.
 *
 * Ruta: /dashboard/company/playbooks
 *
 * Esta pantalla NO es un editor: la única superficie de edición sigue siendo el
 * Builder (`/dashboard/builder/editor/[id]`). Aquí se ve qué está publicado, en
 * qué sucursales y en qué versión.
 */
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PlaybookList } from "@/components/company/playbooks/playbook-list";

export default async function PlaybooksPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) redirect("/sign-in");
  if (!session.user.companyId) redirect("/onboarding");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Playbooks del grupo</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Lo que el grupo define una vez y las sucursales ejecutan
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard/builder">Ir al Builder</Link>
        </Button>
      </div>

      <PlaybookList />
    </div>
  );
}
