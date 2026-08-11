"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const IMSS_SECTIONS = [
  { href: "/dashboard/compliance/imss", label: "Resumen" },
  { href: "/dashboard/compliance/imss/altas", label: "Altas" },
  { href: "/dashboard/compliance/imss/bajas", label: "Bajas" },
  { href: "/dashboard/compliance/imss/sua", label: "SUA" },
  { href: "/dashboard/compliance/imss/reports", label: "Reportes" },
]

export function ImssSubNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Secciones IMSS" className="overflow-x-auto">
      <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
        {IMSS_SECTIONS.map(section => {
          const isActive = pathname === section.href

          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex items-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {section.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
