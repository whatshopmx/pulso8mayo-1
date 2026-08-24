import { AlertTriangle } from "lucide-react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { enforceBranchScope } from "@/lib/branch-scope";
import { BRANCH_COOKIE_NAME } from "@/lib/branch-cookies";
import type { Role } from "@/lib/permissions";
import { PageContainer, PageHeader } from "@/components/shared";
import { Card, CardContent } from "@/components/ui/card";
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
      <WasteHistoryClient branchId={branchId} />
    </PageContainer>
  );
}
