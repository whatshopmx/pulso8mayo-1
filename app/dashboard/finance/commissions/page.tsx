import { Suspense } from "react";
import { Loader2, Percent } from "lucide-react";
import { requireRole } from "@/lib/rbac/require-role";
import { CommissionsByChannelTable } from "@/components/finance/commissions-by-channel-table";
import { CommissionRatesPanel } from "@/components/finance/commission-rates-panel";
import { CommissionsReconciliationPanel } from "@/components/finance/commissions-reconciliation-panel";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const metadata = {
  title: "Comisiones por Canal | Pulso",
  description:
    "Lo que se queda cada agregador y la terminal, con la tarifa vigente en la fecha de cada corte.",
};

export default async function CommissionsPage() {
  const { userRole, companyId } = await requireRole(["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"]);
  const canEdit = userRole === "SUPER_ADMIN" || userRole === "ADMIN";

  const branchList = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.companyId, companyId));

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Percent className="h-7 w-7 text-primary" /> Comisiones por Canal
        </h1>
        <p className="text-sm text-muted-foreground max-w-[75ch]">
          Cuánto se queda cada agregador y cuánto la terminal, contra la venta que entra por cada
          canal. Es un cálculo con tu tarifa negociada y conciliable contra liquidaciones reales.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="py-12 flex justify-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando comisiones...
          </div>
        }
      >
        <CommissionsByChannelTable />
      </Suspense>

      <CommissionsReconciliationPanel branches={branchList} />

      <CommissionRatesPanel canEdit={canEdit} />
    </div>
  );
}
