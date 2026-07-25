import { AppSidebarClient } from "@/components/app-sidebar-client"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { ModeToggle } from "@/components/mode-toggle"
import { DashboardSessionProvider } from "@/components/dashboard-session-provider"
import { BranchProvider } from "@/lib/branch-context"
import { BreadcrumbDynamic } from "@/components/shared/breadcrumb-dynamic"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { CompanyService } from "@/lib/services/company-service"
import { BranchService } from "@/lib/services/branch-service"
import { BRANCH_COOKIE_NAME } from "@/lib/tenant-context"

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
  const selectedBranchId = cookieStore.get(BRANCH_COOKIE_NAME)?.value || session.user.branchId;

  return (
    <DashboardSessionProvider initialSession={session}>
      <BranchProvider 
        initialBranchId={selectedBranchId}
        initialBranches={branches}
      >
        <SidebarProvider>
        <AppSidebarClient
          user={{
            name: session.user.name,
            email: session.user.email,
            avatar: session.user.image || "",
            role: (session.user as any).role as 'SUPER_ADMIN' | 'ADMIN' | 'GERENTE' | 'SUPERVISOR' | 'EMPLEADO' | 'READONLY',
            branchId: (session.user as any).branchId as string | undefined,
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
                            <ModeToggle />
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
