import { AlertTriangle } from "lucide-react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { companies, inventoryWaste } from "@/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { enforceBranchScope } from "@/lib/branch-scope";
import { BRANCH_COOKIE_NAME } from "@/lib/branch-cookies";
import type { Role } from "@/lib/permissions";
import { roleIsAtLeast } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WasteHistoryClient } from "./waste-history-client";
import { RegistrarMermaDialog } from "./registrar-merma-dialog";

/**
 * Task 3 (plan-loteprod-gaps §8.1): guardar el tope mensual de mermas
 * STAFF/COURTESY (pesos → centavos). Vacío = sin tope. Sólo ADMIN+.
 */
async function saveCourtesyWasteCap(formData: FormData) {
  "use server";
  const session = await getSession();
  const role = (session?.user as { role?: Role } | undefined)?.role;
  if (!session?.user || !roleIsAtLeast(role ?? "", "ADMIN")) return;

  const raw = String(formData.get("capPesos") ?? "").trim();
  // Vacío quita el tope; valor inválido/negativo se ignora en silencio — el
  // form es admin-only y el input es number.
  const capCents = raw === "" ? null : Math.round(Number(raw) * 100);
  if (capCents !== null && (!Number.isFinite(capCents) || capCents < 0)) return;

  await db
    .update(companies)
    .set({ courtesyWasteMonthlyCapCents: capCents, updatedAt: new Date() })
    .where(eq(companies.id, session.user.companyId ?? ""));
  revalidatePath("/dashboard/inventory/waste");
}

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

  // Task 3 (§8.1): GERENTE+ resuelve pendientes; ADMIN+ configura el tope.
  const canApproveWaste = roleIsAtLeast(role, "GERENTE");
  const canConfigureCap = roleIsAtLeast(role, "ADMIN");

  let capCents: number | null = null;
  let monthApprovedCents = 0;
  if (canConfigureCap) {
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

  // Historial como contenido default (plan-mermas-historial Task 3); el alta
  // vive en el dialog del header. El formulario no cambió — mismo WasteForm.
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
      {canConfigureCap && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tope mensual de cortesías y consumo de personal</CardTitle>
            <CardDescription>
              Las mermas STAFF/CORTESÍA requieren aprobación de un gerente. Si el acumulado aprobado del mes
              excede este tope, sólo Admin u Owner puede aprobar (loteprod §8.1).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={saveCourtesyWasteCap} className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label htmlFor="capPesos" className="text-xs">
                  Tope mensual (MXN, empresa completa)
                </Label>
                <Input
                  id="capPesos"
                  name="capPesos"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={capCents !== null ? capCents / 100 : ""}
                  placeholder="Sin tope"
                  className="h-8 w-44"
                />
              </div>
              <Button type="submit" size="sm" className="shadow-none">
                Guardar tope
              </Button>
              <p className="text-xs text-muted-foreground pb-2">
                Aprobado este mes: <span className="font-medium tabular-nums">{formatMXN(monthApprovedCents)}</span>
              </p>
            </form>
          </CardContent>
        </Card>
      )}
      <WasteHistoryClient branchId={branchId} canApproveWaste={canApproveWaste} />
    </PageContainer>
  );
}
