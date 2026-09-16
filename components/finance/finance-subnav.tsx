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

interface NavTab {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  aliases?: string[];
}

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
    aliases: ["/dashboard/finance/treasury"],
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
    name: "Cierre y control",
    href: "/dashboard/finance/control-interno",
    icon: ShieldCheck,
    aliases: ["/dashboard/finance/fiscal"],
  },
];

export function FinanceSubnav() {
  const pathname = usePathname();

  const isConfigActive =
    pathname.startsWith("/dashboard/finance/payees") ||
    pathname.startsWith("/dashboard/finance/payee-bank-accounts") ||
    pathname.startsWith("/dashboard/finance/supplier-bank-accounts") ||
    pathname.startsWith("/dashboard/budgets") ||
    pathname.startsWith("/dashboard/company/operating-config");

  return (
    <div className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-20">
      <div className="container mx-auto px-4 sm:px-6 flex items-center justify-between overflow-x-auto no-scrollbar">
        <nav className="flex items-center gap-1 sm:gap-2 py-2" aria-label="Espacios de Finanzas">
          {FINANCE_TABS.map((tab) => {
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
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap",
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
              <DropdownMenuItem asChild>
                <Link href="/dashboard/finance/payees" className="cursor-pointer">
                  Beneficiarios de gastos
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/finance/payee-bank-accounts" className="cursor-pointer">
                  Cuentas de contrapartes
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/finance/supplier-bank-accounts" className="cursor-pointer">
                  Cuentas de proveedores
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard/budgets" className="cursor-pointer">
                  Presupuestos operativos
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/company/operating-config" className="cursor-pointer">
                  Objetivos y semáforos de costo
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
