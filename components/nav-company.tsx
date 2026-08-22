"use client"

import * as React from "react"
import { ChevronsUpDown, Plus, Building2, Check } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useRouter } from "next/navigation"
import { switchBranch } from "@/app/actions/user"
import { useBranch } from "@/lib/branch-context"
import { toast } from "sonner"

export function NavCompany({
  company: propCompany = { name: "", plan: "" },
  branches: propBranches = [],
  currentBranchId: initialBranchId,
  userRole,
  userBranchId,
}: {
  company: {
    name: string
    plan: string
  },
  branches: {
    id: string
    name: string
  }[],
  currentBranchId?: string
  userRole?: string
  userBranchId?: string
}) {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const { selectedBranchId, setSelectedBranchId, setBranches } = useBranch()
  const t = useTranslations("navigation")
  const tSuccess = useTranslations("success")
  const tErrors = useTranslations("errors")

  const isBranchScoped = userRole === "GERENTE" || userRole === "SUPERVISOR"
  const displayBranches = isBranchScoped && userBranchId
    ? propBranches.filter(b => b.id === userBranchId)
    : propBranches

  const company = propCompany.name ? propCompany : { name: t("selectBranch"), plan: "" }

  // Initialize branches in context
  React.useEffect(() => {
    setBranches(displayBranches);
  }, [displayBranches, setBranches]);

  // Use context branch ID or fallback to prop
  const activeBranchId = isBranchScoped && userBranchId
    ? userBranchId
    : (selectedBranchId || initialBranchId);

  const handleBranchSwitch = async (branchId: string) => {
    if (branchId === activeBranchId) return;

    startTransition(async () => {
      try {
        await switchBranch(branchId);
        setSelectedBranchId(branchId);
        toast.success(tSuccess("saved"));
        router.refresh();
      } catch (error) {
        toast.error(tErrors("services.branchSwitch"));
        console.error(error);
      }
    });
  }

  const activeBranch = displayBranches.find(b => b.id === activeBranchId) || displayBranches[0];

  /**
   * Los dos selectores tienen que decir lo mismo.
   *
   * Con el alcance en "Todas" este de la barra lateral caía a
   * `displayBranches[0]` y anunciaba una sucursal concreta mientras el del
   * encabezado decía "Todas". Dos controles del mismo alcance contradiciéndose
   * es peor que uno solo equivocado: el usuario no sabe cuál le está contestando.
   */
  const esAlcanceTodas = !isBranchScoped && selectedBranchId === null;

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={isBranchScoped}>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
                            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                                <Building2 className="size-4" />
                            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{esAlcanceTodas ? "Todas las sucursales" : (activeBranch?.name || t("selectBranch"))}</span>
              <span className="truncate text-xs">{company.name}{company.plan ? ` (${company.plan})` : ""}</span>
            </div>
                            <ChevronsUpDown className="ml-auto" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                        align="start"
                        side={isMobile ? "bottom" : "right"}
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                            Sucursales
                        </DropdownMenuLabel>
                        {displayBranches.map((branch) => (
            <DropdownMenuItem
              key={branch.id}
              onClick={() => handleBranchSwitch(branch.id)}
              className="gap-2 p-2"
            >
              <div className="flex size-6 items-center justify-center rounded-sm border">
                <Building2 className="size-4 shrink-0" />
              </div>
              {branch.name}
              {branch.id === activeBranchId && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2" disabled>
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <Plus className="size-4" />
              </div>
              <div className="font-medium text-muted-foreground">{t("addBranch")}</div>
            </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    )
}
