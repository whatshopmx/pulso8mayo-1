/**
 * Plan y capacidades del grupo.
 *
 * Ruta: /dashboard/company/subscription
 *
 * NOTA: `/dashboard/company` es solo un grupo del sidebar — no existe una
 * `page.tsx` en esa carpeta. El banner de tier vive en su propia ruta en vez de
 * inventar una landing de "Organización" que nadie pidió.
 */
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TierBanner } from "@/components/company/tier-banner";

export default async function SubscriptionPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) redirect("/sign-in");
  if (!session.user.companyId) redirect("/onboarding");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Plan del grupo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Capacidades incluidas según el tamaño y el plan contratado
        </p>
      </div>

      <TierBanner />
    </div>
  );
}
