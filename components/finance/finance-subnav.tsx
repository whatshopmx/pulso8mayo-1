"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Clock,
  Receipt,
  CreditCard,
  TrendingUp,
  BarChart3,
  ShieldCheck,
  Inbox,
  Settings,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { hasAccess, type UserRole } from "@/lib/rbac/permissions";

interface NavTab {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  aliases?: string[];
}

const FINANCE_CONFIG_ITEMS = [
  { href: "/dashboard/finance/payees", label: "Beneficiarios de gastos", group: "primary" },
  { href: "/dashboard/finance/payee-bank-accounts", label: "Cuentas de contrapartes", group: "primary" },
  { href: "/dashboard/finance/supplier-bank-accounts", label: "Cuentas de proveedores", group: "primary" },
  { href: "/dashboard/finance/settings/bank-accounts", label: "Cuentas de origen (propias)", group: "primary" },
  { href: "/dashboard/finance/settings/accounting", label: "Preparar contabilidad", group: "primary" },
  { href: "/dashboard/budgets", label: "Presupuestos operativos", group: "secondary" },
  { href: "/dashboard/company/operating-config", label: "Objetivos y semáforos de costo", group: "secondary" },
] as const;

const FINANCE_TABS: NavTab[] = [
  {
    name: "Hoy",
    href: "/dashboard/finance",
    icon: Clock,
    exact: true,
  },
  {
    name: "Gastos",
    href: "/dashboard/finance/expenses",
    icon: Receipt,
    aliases: ["/dashboard/finance/petty-cash"],
  },
  {
    name: "Pagos",
    href: "/dashboard/finance/payables",
    icon: CreditCard,
    aliases: ["/dashboard/finance/treasury", "/dashboard/finance/bank-reconciliation"],
  },
  {
    name: "Caja y cobros",
    href: "/dashboard/finance/cash-flow",
    icon: TrendingUp,
  },
  {
    name: "Resultados",
    href: "/dashboard/finance/results",
    icon: BarChart3,
    aliases: ["/dashboard/finance/labor-cost", "/dashboard/finance/commissions"],
  },
  {
    name: "Aprobaciones",
    href: "/dashboard/finance/approvals",
    icon: Inbox,
    exact: true,
  },
  {
    name: "Cierre y control",
    href: "/dashboard/finance/control-interno",
    icon: ShieldCheck,
    aliases: ["/dashboard/finance/fiscal"],
  },
];

export function FinanceSubnav() {
  const pathname = usePathname();
  const { session } = useSession();
  const userRole = (session?.user?.role ?? "EMPLEADO") as UserRole;

  const visibleTabs = FINANCE_TABS.filter((tab) => hasAccess(userRole, tab.href));
  const primaryConfigItems = FINANCE_CONFIG_ITEMS.filter(
    (item) => item.group === "primary" && hasAccess(userRole, item.href),
  );
  const secondaryConfigItems = FINANCE_CONFIG_ITEMS.filter(
    (item) => item.group === "secondary" && hasAccess(userRole, item.href),
  );
  const hasAnyConfig = primaryConfigItems.length > 0 || secondaryConfigItems.length > 0;

  const isConfigActive =
    pathname.startsWith("/dashboard/finance/payees") ||
    pathname.startsWith("/dashboard/finance/payee-bank-accounts") ||
    pathname.startsWith("/dashboard/finance/supplier-bank-accounts") ||
    pathname.startsWith("/dashboard/finance/settings") ||
    pathname.startsWith("/dashboard/budgets") ||
    pathname.startsWith("/dashboard/company/operating-config");

  if (visibleTabs.length === 0 && !hasAnyConfig) {
    return null;
  }

  return (
    <div className="border-b border-border bg-card sticky top-0 z-20">
      <div className="container mx-auto px-4 sm:px-6 flex items-center justify-between overflow-x-auto no-scrollbar">
        <nav className="flex items-center gap-1 sm:gap-2 py-2" aria-label="Espacios de Finanzas">
          {visibleTabs.map((tab) => {
            const isActive = tab.exact
              ? pathname === tab.href
              : pathname === tab.href ||
                pathname.startsWith(`${tab.href}/`) ||
                tab.aliases?.some((a) => pathname === a || pathname.startsWith(`${a}/`));

            const Icon = tab.icon;

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex items-center gap-2 min-h-9 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap",
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <Icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                <span>{tab.name}</span>
              </Link>
            );
          })}
        </nav>

        {hasAnyConfig && (
          <div className="py-2 pl-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={isConfigActive ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-8 text-xs font-medium gap-1.5 text-muted-foreground hover:text-foreground",
                    isConfigActive && "bg-secondary text-secondary-foreground font-semibold"
                  )}
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Configuración</span>
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Configuración del dinero
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {primaryConfigItems.map((item) => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link href={item.href} className="cursor-pointer">
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
                {primaryConfigItems.length > 0 && secondaryConfigItems.length > 0 && (
                  <DropdownMenuSeparator />
                )}
                {secondaryConfigItems.map((item) => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link href={item.href} className="cursor-pointer">
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
}
