import { AppSidebarClient } from "@/components/app-sidebar-client"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { ModeToggle } from "@/components/mode-toggle"
import { BranchScopeControl } from "@/components/shared/branch-scope-control"
import { DashboardSessionProvider } from "@/components/dashboard-session-provider"
import { BranchProvider } from "@/lib/branch-context"
import { BreadcrumbDynamic } from "@/components/shared/breadcrumb-dynamic"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { CompanyService } from "@/lib/services/company-service"
import { BranchService } from "@/lib/services/branch-service"
import { BRANCH_COOKIE_NAME, BRANCH_SCOPE_ALL, BRANCH_SCOPE_COOKIE_NAME } from "@/lib/branch-cookies"

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth.api.getSession({
    headers: await headers()
  });

  if (!session) {
    redirect("/sign-in");
  }

  if (!session.user.companyId) {
    redirect("/onboarding");
  }

  const company = await CompanyService.getCompany(session.user.companyId);
  const branches = await BranchService.listBranches(session.user.companyId);

  // Get selected branch from cookie (user's active selection)
  const cookieStore = await cookies();
  /**
   * "Todas" es una elección, y hasta ahora no se podía decir.
   *
   * Elegir la cadena entera borra `pulso_selected_branch`, así que este `||`
   * caía a `session.user.branchId` y devolvía al usuario a una sucursal sola en
   * cada recarga. `pulso_branch_scope=all` es lo que distingue "elegí todas" de
   * "todavía no elijo"; cuando está, no hay sucursal inicial que pasar y el
   * proveedor arranca con la elección ya hecha.
   */
  const alcanceEsTodas = cookieStore.get(BRANCH_SCOPE_COOKIE_NAME)?.value === BRANCH_SCOPE_ALL;
  const cookieDeSucursal = cookieStore.get(BRANCH_COOKIE_NAME)?.value;

  /**
   * `role` y `branchId` no están en el tipo de `session.user` de better-auth.
   * Una aserción a la forma concreta, una sola vez, en lugar de cuatro `as any`
   * repartidos: el `any` apaga la comprobación entera del objeto, y aquí lo
   * único que falta es saber que estos dos campos existen.
   */
  const { role: userRole, branchId: userBranchId } = session.user as {
    role?: 'SUPER_ADMIN' | 'ADMIN' | 'GERENTE' | 'SUPERVISOR' | 'EMPLEADO' | 'READONLY';
    branchId?: string;
  };

  /**
   * La sucursal de la sesión sólo fija el alcance de quien el servidor fija.
   *
   * `lib/branch-scope.ts:82` **ni siquiera consulta** `userBranchId` para un rol
   * no fijado: sin sucursal pedida devuelve `kind: "ALL"`. Este `||` hacía lo
   * contrario y ataba al ADMIN a la sucursal que tuviera colgada en la sesión,
   * así que el encabezado decía una sucursal mientras el servidor respondía por
   * la cadena entera. Para GERENTE y SUPERVISOR la sesión sí manda (AD-B7).
   */
  const esFijadoASucursal = userRole === "GERENTE" || userRole === "SUPERVISOR";
  const selectedBranchId = alcanceEsTodas
    ? null
    : cookieDeSucursal || (esFijadoASucursal ? userBranchId : null) || null;

  return (
    <DashboardSessionProvider initialSession={session}>
      <BranchProvider 
        initialBranchId={selectedBranchId}
        initialBranches={branches}
        initialScopeChosen={alcanceEsTodas}
        userRole={userRole}
        userBranchId={userBranchId ?? null}
      >
        <SidebarProvider>
        <AppSidebarClient
          user={{
            name: session.user.name,
            email: session.user.email,
            avatar: session.user.image || "",
            role: userRole as 'SUPER_ADMIN' | 'ADMIN' | 'GERENTE' | 'SUPERVISOR' | 'EMPLEADO' | 'READONLY',
            branchId: userBranchId,
          }}
            company={{
              name: company?.name || "Mi Empresa",
              plan: company?.plan || "FREE"
            }}
            branches={branches}
            currentBranchId={selectedBranchId}
          />
          <SidebarInset>
                    <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b">
                        <div className="flex items-center gap-2 px-4 w-full justify-between">
                            <div className="flex items-center gap-2">
                            <SidebarTrigger className="-ml-1" />
                            <Separator orientation="vertical" className="mr-2 h-4" />
                            <BreadcrumbDynamic companyName={company?.name || "Pulso"} />
                        </div>
                            <div className="flex items-center gap-2">
                                <BranchScopeControl />
                                <ModeToggle />
                            </div>
                        </div>
                    </header>
                    <div className="flex flex-1 flex-col gap-4 p-4 pt-0 bg-muted/20">
                        {children}
                    </div>
      </SidebarInset>
        </SidebarProvider>
      </BranchProvider>
    </DashboardSessionProvider>
  )
}
