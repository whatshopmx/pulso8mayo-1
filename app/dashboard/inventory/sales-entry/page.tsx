import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { Upload } from "lucide-react";
import { PageHeader, PageContainer } from "@/components/shared";
import { BRANCH_COOKIE_NAME } from "@/lib/branch-cookies";
import { SalesEntryClient } from "./sales-entry-client";

/**
 * T9 (plan-inventario-desconexion): pantalla corporativa de carga masiva de
 * ventas. El alcance de sucursal viene del header (AD-1): si hay sucursal en
 * foco queda bloqueada; sin foco, el usuario elige destino por archivo.
 */
export default async function SalesEntryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");

  const companyId = session.user.companyId || "";

  const tenantBranches = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.companyId, companyId));

  const cookieStore = await cookies();
  const scopedBranchId = cookieStore.get(BRANCH_COOKIE_NAME)?.value || "";
  const scopedBranch = tenantBranches.find((b) => b.id === scopedBranchId) ?? null;

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        title="Carga de Ventas"
        description="Importa el corte del POS para descontar consumo teórico y alimentar varianza"
        icon={Upload}
        branchName={scopedBranch?.name}
      />
      <SalesEntryClient branches={tenantBranches} scopedBranchId={scopedBranch?.id ?? null} />
    </PageContainer>
  );
}
