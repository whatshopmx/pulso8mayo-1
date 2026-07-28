"use client"

import { usePathname } from "next/navigation"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Fragment } from "react"

const PATH_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  analytics: "Analítica",
  branches: "Sucursales",
  workflows: "Flujos de Trabajo",
  builder: "Constructor",
  inventory: "Inventario",
  equipment: "Equipos",
  compliance: "Cumplimiento",
  labor: "Personal",
  employees: "Directorio",
  performance: "Desempeño",
  profile: "Perfil",
  audit: "Auditoría",
  reports: "Reportes",
  evidence: "Evidencias",
  incidents: "Incidentes",
  operations: "Operación",
  execute: "Ejecución Rápida",
  history: "Historial",
  receiving: "Recepción",
  transfers: "Transferencias",
  suppliers: "Proveedores",
  alerts: "Alertas",
  catalog: "Catálogo",
  maintenance: "Mantenimientos",
  providers: "Proveedores",
  templates: "Plantillas",
  "ai-verifications": "Verificaciones AI",
  attendance: "Asistencia",
  shifts: "Turnos",
  "shift-changes": "Cambios de Turno",
  "schedule-builder": "Constructor de Horarios",
  overtime: "Horas Extras",
  approvals: "Aprobaciones",
  breaks: "Descansos",
  vacations: "Vacaciones",
  holidays: "Días Festivos",
  geolocation: "Geolocalización",
  documents: "Expediente Laboral",
  reviews: "Evaluaciones",
  goals: "Metas",
  onboarding: "Onboarding",
  offboarding: "Offboarding",
  notifications: "Notificaciones",
  communications: "Comunicaciones",
  whatsapp: "WhatsApp",
  company: "Organización",
  team: "Equipo",
  "kpi-builder": "Constructor KPIs",
  "stock-count": "Conteo de Stock",
  waste: "Merma",
  expirations: "Caducidades",
  "purchase-orders": "Órdenes de Compra",
  "suggested-orders": "Órdenes Sugeridas",
  sat: "SAT",
  imss: "IMSS",
  edit: "Editar",
  new: "Nuevo",
  review: "Revisar",
  search: "Buscar",
  preview: "Vista Previa",
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function getLabel(segment: string): string {
  if (UUID_RE.test(segment)) return "Detalle"
  return PATH_LABELS[segment] || segment.charAt(0).toUpperCase() + segment.slice(1)
}

export function BreadcrumbDynamic({ companyName }: { companyName: string }) {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="hidden md:block">
          <BreadcrumbLink href="/dashboard">{companyName}</BreadcrumbLink>
        </BreadcrumbItem>
        {segments.slice(1).map((segment, index) => {
          const isLast = index === segments.slice(1).length - 1
          const href = "/" + segments.slice(0, index + 2).join("/")

          return (
            <Fragment key={segment}>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{getLabel(segment)}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={href}>{getLabel(segment)}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
