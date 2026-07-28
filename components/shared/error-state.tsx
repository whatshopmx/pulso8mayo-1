import { cn } from "@/lib/utils"
import { type LucideIcon, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RotateCw } from "lucide-react"

interface ErrorStateProps {
  message?: string
  onRetry?: () => void
  retryLabel?: string
  icon?: LucideIcon
  className?: string
}

/**
 * Reusable inline error state for failed queries.
 * Renders compact (not full-height) so it can drop into KPI blocks, chart
 * cards, alert cards, and tables. Uses role="alert" so the message is
 * announced to assistive tech, and the retry button is keyboard-focusable
 * with a visible focus ring from the Button primitive.
 */
export function ErrorState({
  message = "No se pudo cargar la información",
  onRetry,
  retryLabel = "Reintentar",
  icon: Icon = AlertCircle,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-10 px-4 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <Icon className="h-6 w-6 text-destructive" aria-hidden="true" />
      </div>
      <p className="text-sm text-muted-foreground max-w-xs">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RotateCw className="h-4 w-4 mr-2" aria-hidden="true" />
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
