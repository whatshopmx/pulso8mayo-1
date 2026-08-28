import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { companies, inventoryWaste } from "@/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { enforceBranchScope } from "@/lib/branch-scope";
import { BRANCH_COOKIE_NAME } from "@/lib/branch-cookies";
import type { Role } from "@/lib/permissions";
import { roleIsAtLeast } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WasteHistoryClient } from "./waste-history-client";
import { RegistrarMermaDialog } from "./registrar-merma-dialog";

interface Props {
  searchParams: Promise<{ item?: string; registrar?: string }>;
}

export const metadata = {
  title: "Mermas | Pulso",
};

export default async function WastePage({ searchParams }: Props) {
  const session = await getSession();
  const params = await searchParams;
  const preselectedItemId = params.item;

  if (!session?.user) {
    redirect("/sign-in");
  }

  // Misma resolución que el header y tenant-context: GERENTE/SUPERVISOR quedan
  // fijos a su sucursal de sesión; para los demás manda el alcance del header
  // (cookie). Sin alcance elegido ("Todas") la merma exige elegir una.
  const cookieStore = await cookies();
  const requestedBranchId = cookieStore.get(BRANCH_COOKIE_NAME)?.value ?? null;
  const role = (session.user as { role?: Role }).role ?? ("ADMIN" as Role);
  const branchId = enforceBranchScope(role, session.user.branchId, requestedBranchId);

  if (!branchId) {
    return (
      <PageContainer>
        <PageHeader
          title="Mermas"
          description="Historial y registro de mermas de la sucursal"
          icon={AlertTriangle}
        />
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Selecciona una Sucursal</h2>
            <p className="text-muted-foreground">
              Necesitas estar en el contexto de una sucursal para ver y registrar mermas.
            </p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  // Task 3 (§8.1): GERENTE+ resuelve pendientes; ADMIN+ configura el tope en operating-config.
  const canApproveWaste = roleIsAtLeast(role, "GERENTE");
  const canConfigureCap = roleIsAtLeast(role, "ADMIN");

  let capCents: number | null = null;
  let monthApprovedCents = 0;
  if (canApproveWaste) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [companyRow] = await db
      .select({ capCents: companies.courtesyWasteMonthlyCapCents })
      .from(companies)
      .where(eq(companies.id, session.user.companyId ?? ""))
      .limit(1);
    capCents = companyRow?.capCents ?? null;

    const [agg] = await db
      .select({
        approvedCents: sql<string>`coalesce(sum(${inventoryWaste.totalLoss}), 0)`,
      })
      .from(inventoryWaste)
      .where(
        and(
          eq(inventoryWaste.companyId, session.user.companyId ?? ""),
          eq(inventoryWaste.approvalStatus, "APPROVED"),
          sql`${inventoryWaste.reason} IN ('STAFF', 'COURTESY')`,
          gte(inventoryWaste.recordedAt, monthStart)
        )
      );
    monthApprovedCents = Number(agg?.approvedCents ?? 0);
  }

  const formatMXN = (cents: number) =>
    (cents / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

  // Historial como contenido default; el alta vive en el dialog del header.
  return (
    <PageContainer>
      <PageHeader
        title="Mermas"
        description="Historial de mermas con detalle por producto, motivo y origen"
        icon={AlertTriangle}
        actions={
          <RegistrarMermaDialog
            branchId={branchId}
            preselectedItemId={preselectedItemId}
          />
        }
      />
      {canApproveWaste && (
        <Card className="border bg-card">
          <CardContent className="py-3 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="h-2 w-2 rounded-full bg-primary shrink-0" aria-hidden="true" />
              <div className="truncate">
                <span className="font-semibold text-foreground">Tope de Cortesías y Consumo (STAFF):</span>{" "}
                <span className="font-mono text-muted-foreground">
                  {capCents !== null ? `${formatMXN(capCents)} / mes` : "Sin tope (ilimitado)"}
                </span>{" "}
                · Aprobado este mes: <span className="font-semibold font-mono text-foreground">{formatMXN(monthApprovedCents)}</span>
                {capCents !== null && monthApprovedCents >= capCents && (
                  <span className="ml-2 text-destructive font-semibold">
                    (Tope alcanzado: nuevas cortesías exigen aprobación de Admin/Owner)
                  </span>
                )}
              </div>
            </div>
            {canConfigureCap && (
              <Button asChild variant="outline" size="sm" className="h-7 text-xs shrink-0">
                <Link href="/dashboard/company/operating-config">
                  Configurar en Modelo Operativo
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      <WasteHistoryClient branchId={branchId} canApproveWaste={canApproveWaste} />
    </PageContainer>
  );
}
