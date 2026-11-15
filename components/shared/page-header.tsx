import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { type LucideIcon, Building2 } from "lucide-react"
import type { ReactNode } from "react"

interface PageHeaderProps {
  title: string
  description?: string
  icon?: LucideIcon
  badge?: string
  branchName?: string
  actions?: ReactNode
  className?: string
  children?: ReactNode
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  badge,
  branchName,
  actions,
  className,
  children,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground break-words text-balance">
                {title}
              </h1>
              {badge && (
                <Badge variant="outline" className="shrink-0">{badge}</Badge>
              )}
            </div>
            {description && (
              <p className="text-muted-foreground text-sm mt-1">{description}</p>
            )}
            {branchName && (
              <Badge variant="outline" className="mt-2 gap-1 font-normal">
                <Building2 className="h-3 w-3" />
                {branchName}
              </Badge>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
        )}
      </div>
      {children}
    </div>
  )
}
