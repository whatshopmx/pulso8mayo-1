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
        title: "Dashboard",
        url: "/dashboard/inventory",
      },
      {
        title: "Órdenes de Compra",
        url: "/dashboard/inventory/purchase-orders",
      },
      {
        title: "Recepción",
        url: "/dashboard/inventory/receiving",
      },
      {
        title: "Transferencias",
        url: "/dashboard/inventory/transfers",
      },
      {
        title: "Ubicaciones",
        url: "/dashboard/inventory/locations",
      },
      {
        title: "Proveedores",
        url: "/dashboard/inventory/suppliers",
      },
      {
        title: "Alertas de Stock",
        url: "/dashboard/inventory/alerts",
      },
      {
        title: "Recetas & BOM",
        url: "/dashboard/inventory/recipes",
      },
      {
        title: "Carga Facturas XML",
        url: "/dashboard/inventory/invoices",
      },
      {
        title: "Reporte Mermas",
        url: "/dashboard/inventory/reports",
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
    title: "Organización",
    url: "/dashboard/company",
    icon: Building2,
    items: [
      {
        title: "Sucursales",
        url: "/dashboard/company/branches",
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
      if (userRole === 'EMPLEADO') {
        return !item.url.includes('/builder') &&
        !item.url.includes('/history');
      }
      if (userRole === 'READONLY') {
        return !item.url.includes('/builder');
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
        <NavMain items={filteredNavMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
