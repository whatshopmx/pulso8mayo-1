import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

interface PageContainerProps {
  children: ReactNode
  className?: string
}

export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-6 p-4 lg:gap-8 lg:p-8 max-w-7xl mx-auto w-full", className)}>
      {children}
    </div>
  )
}
