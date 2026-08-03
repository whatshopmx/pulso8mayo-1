"use client"

import * as React from "react"
import {
  SquareTerminal,
  Building2,
  Users,
  Layout,
  ShieldCheck,
  Package,
  TrendingUp,
  Wrench,
  BarChart3,
  FileText,
  Coins,
  Wallet,
  Receipt,
  Calendar,
  Settings2,
  Flame,
  Crown,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"

import { NavUser } from "@/components/nav-user"
import { NavCompany } from "@/components/nav-company"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"

const navMain = [
  {
    title: "Tablero",
    url: "/dashboard",
    icon: SquareTerminal,
    isActive: true,
    items: [
      {
        title: "Vista General",
        url: "/dashboard",
      },
      {
        title: "Dashboard Ejecutivo",
        url: "/dashboard/executive",
        icon: Crown,
      },
      {
        title: "Analítica",
        url: "/dashboard/analytics",
      },
      {
        title: "Constructor KPIs",
        url: "/dashboard/analytics/kpi-builder",
      },
      {
        title: "Performance por Sucursal",
        url: "/dashboard/analytics/branches",
        icon: BarChart3,
      },
      {
        title: "Tendencias",
        url: "/dashboard/analytics/trends",
        icon: TrendingUp,
      },
    ],
  },
  {
    title: "Flujos de Trabajo",
    url: "/dashboard/workflows",
    icon: Layout,
    items: [
      {
        title: "Dashboard",
        url: "/dashboard/workflows",
      },
      {
        title: "Ejecución Rápida",
        url: "/dashboard/execute",
      },
      {
        title: "Constructor",
        url: "/dashboard/builder",
      },
      {
        title: "Plantillas",
        url: "/dashboard/builder/templates",
      },
      {
        title: "Historial",
        url: "/dashboard/workflows/history",
      },
      {
        title: "Incidentes",
        url: "/dashboard/incidents",
      },
      {
        title: "Evidencias",
        url: "/dashboard/evidence",
      },
    ],
  },
  {
    title: "Inventario",
    url: "/dashboard/inventory",
    icon: Package,
    items: [
      {
        title: "Panel de Inventario",
        url: "/dashboard/inventory",
      },
      {
        title: "Catálogo de Productos",
        url: "/dashboard/inventory/products",
      },
      { groupLabel: "Operar" },
      {
        title: "Recepción",
        url: "/dashboard/inventory/receiving",
      },
      {
        title: "Conteo de Inventario",
        url: "/dashboard/inventory/stock-count",
      },
      {
        title: "Mermas",
        url: "/dashboard/inventory/waste",
      },
      {
        title: "Transferencias",
        url: "/dashboard/inventory/transfers",
      },
      {
        title: "Producción",
        url: "/dashboard/inventory/production",
      },
      { groupLabel: "Comprar" },
      {
        title: "Órdenes de Compra",
        url: "/dashboard/inventory/purchase-orders",
      },
      {
        title: "Órdenes Sugeridas",
        url: "/dashboard/inventory/suggested-orders",
      },
      {
        title: "Proveedores",
        url: "/dashboard/inventory/suppliers",
      },
      {
        title: "Facturas (XML)",
        url: "/dashboard/inventory/invoices",
      },
      {
        title: "Reclamos",
        url: "/dashboard/inventory/claims",
      },
      { groupLabel: "Analizar" },
      {
        title: "Alertas de Stock",
        url: "/dashboard/inventory/alerts",
      },
      {
        title: "Vencimientos",
        url: "/dashboard/inventory/expirations",
      },
      {
        title: "Movimientos",
        url: "/dashboard/inventory/movements",
      },
      {
        title: "Auditoría",
        url: "/dashboard/inventory/audit",
      },
      {
        title: "Reportes",
        url: "/dashboard/inventory/reports",
      },
      {
        title: "Dashboard Ejecutivo",
        url: "/dashboard/inventory/reports/executive",
      },
      {
        title: "Ingeniería de Menú",
        url: "/dashboard/inventory/menu-engineering",
      },
      {
        title: "Costeo",
        url: "/dashboard/inventory/costing",
      },
      {
        title: "Pulso Intelligence",
        url: "/dashboard/inventory/intelligence",
      },
      { groupLabel: "Configurar" },
      {
        title: "Recetas y Costeo",
        url: "/dashboard/inventory/recipes",
      },
      {
        title: "Ubicaciones",
        url: "/dashboard/inventory/locations",
      },
    ],
  },
  {
    title: "Equipos",
    url: "/dashboard/equipment",
    icon: Wrench,
    items: [
      {
        title: "Dashboard",
        url: "/dashboard/equipment",
      },
      {
        title: "Catálogo",
        url: "/dashboard/equipment/catalog",
      },
      {
        title: "Mantenimientos",
        url: "/dashboard/equipment/maintenance",
      },
      {
        title: "Servicios Normativos",
        url: "/dashboard/equipment/compliance",
      },
      {
        title: "Proveedores",
        url: "/dashboard/equipment/providers",
      },
    ],
  },
  {
    title: "Cumplimiento",
    url: "/dashboard/compliance",
    icon: ShieldCheck,
    items: [
      {
        title: "Dashboard",
        url: "/dashboard/compliance",
      },
      {
        title: "Auditoría",
        url: "/dashboard/audit",
      },
      {
        title: "Protección Civil",
        url: "/dashboard/civil-protection",
        icon: Flame,
      },
      {
        title: "Reportes",
        url: "/dashboard/reports",
      },
      {
        title: "Constructor de Reportes",
        url: "/dashboard/reports/custom",
        icon: FileText,
      },
      {
        title: "Verificaciones AI",
        url: "/dashboard/ai-verifications",
      },
    ],
  },
  {
    title: "Personal",
    url: "/dashboard/labor",
    icon: Users,
    items: [
      {
        title: "Dashboard",
        url: "/dashboard/labor",
      },
      {
        title: "Directorio",
        url: "/dashboard/employees",
      },
      {
        title: "Asistencia",
        url: "/dashboard/labor/attendance",
      },
      {
        title: "Turnos",
        url: "/dashboard/labor/shifts",
      },
      {
        title: "Cambios de Turno",
        url: "/dashboard/labor/shift-changes",
      },
      {
        title: "Distribución de Propinas",
        url: "/dashboard/labor/propinas",
        icon: Coins,
      },
      {
        title: "Constructor de Horarios",
        url: "/dashboard/labor/schedule-builder",
      },
      {
        title: "Horas Extras",
        url: "/dashboard/labor/overtime",
      },
      {
        title: "Aprobaciones",
        url: "/dashboard/labor/approvals",
      },
      {
        title: "Breaks",
        url: "/dashboard/labor/breaks",
      },
      {
        title: "Vacaciones",
        url: "/dashboard/labor/vacations",
      },
      {
        title: "Días Festivos",
        url: "/dashboard/labor/holidays",
      },
    ],
  },
  {
    title: "Desempeño",
    url: "/dashboard/performance",
    icon: TrendingUp,
    items: [
      {
        title: "Dashboard",
        url: "/dashboard/performance",
      },
      {
        title: "Evaluaciones",
        url: "/dashboard/performance/reviews",
      },
      {
        title: "Metas",
        url: "/dashboard/performance/goals",
      },
    ],
  },
  {
    title: "Finanzas",
    url: "/dashboard/sales",
    icon: Coins,
    items: [
      {
        title: "Cortes de Ventas",
        url: "/dashboard/sales",
      },
      {
        title: "Mapeo POS",
        url: "/dashboard/sales/mapping",
      },
      {
        title: "Caja Chica",
        url: "/dashboard/finance/petty-cash",
        icon: Wallet,
      },
      {
        title: "Gastos Operativos",
        url: "/dashboard/finance/expenses",
        icon: Receipt,
      },
      {
        title: "Flujo de Efectivo",
        url: "/dashboard/finance/cash-flow",
        icon: Calendar,
      },
    ],
  },
  {
    title: "Organización",
    url: "/dashboard/company",
    icon: Building2,
    items: [
      {
        title: "Sucursales",
        url: "/dashboard/company/branches",
      },
      {
        title: "Modelo Operativo",
        url: "/dashboard/company/operating-config",
        icon: Settings2,
      },
      {
        title: "Equipo",
        url: "/dashboard/team",
      },
      {
        title: "WhatsApp Bot",
        url: "/dashboard/company/whatsapp",
      },
      {
        title: "Comunicaciones",
        url: "/dashboard/company/communications",
      },
    ],
  },
]

export interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user: {
    name: string;
    email: string;
    avatar: string;
    role?: 'SUPER_ADMIN' | 'ADMIN' | 'GERENTE' | 'SUPERVISOR' | 'EMPLEADO' | 'READONLY';
    branchId?: string;
  },
  company: {
    name: string;
    plan: string;
  },
  branches: {
    id: string;
    name: string;
  }[],
  currentBranchId?: string;
}

export function AppSidebar({ user, company, branches, currentBranchId, ...props }: AppSidebarProps) {
  // Filter navigation items based on user role
  const userRole = user.role || 'EMPLEADO';

  const filteredNavMain = navMain.filter(section => {
    if (userRole === 'EMPLEADO') {
      return section.title === 'Flujos de Trabajo';
    }
    if (userRole === 'READONLY') {
      return section.title === 'Tablero' || section.title === 'Cumplimiento' || section.title === 'Desempeño';
    }
    if (userRole === 'SUPERVISOR') {
      return section.title !== 'Organización';
    }
    if (userRole === 'GERENTE') {
      return section.title !== 'Organización';
    }
    return true;
  }).map(section => {
    const filteredItems = section.items?.filter(item => {
      const anyItem = item as any;
      if (anyItem.groupLabel || !anyItem.url) return true;
      if (userRole === 'EMPLEADO') {
        return !anyItem.url.includes('/builder') &&
        !anyItem.url.includes('/history');
      }
      if (userRole === 'READONLY') {
        return !anyItem.url.includes('/builder');
      }
      return true;
    });

    return {
      ...section,
      items: filteredItems
    };
  });

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <NavCompany
          company={company}
          branches={branches}
          currentBranchId={currentBranchId}
          userRole={user.role}
          userBranchId={user.branchId}
        />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={filteredNavMain as any} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
