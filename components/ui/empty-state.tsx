import * as React from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** Render compact without a Card wrapper (for in-table empty rows). */
  bare?: boolean;
}

/**
 * Standardized empty-state: icon + title + description + action.
 * Aligns every "no data" surface in the module to one vocabulary
 * (see DESIGN.md — compliance as a byproduct, no bureaucratic emptiness).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  bare = false,
}: EmptyStateProps) {
  const content = (
    <div className={cn("space-y-3", bare ? "py-8" : "py-12", className)}>
      {Icon && (
        <div className="flex justify-center">
          <Icon className="w-10 h-10 text-muted-foreground/50" />
        </div>
      )}
      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">{description}</p>
        )}
      </div>
      {action && <div className="flex justify-center">{action}</div>}
    </div>
  );

  if (bare) return content;

  return (
    <div className="rounded-lg border border-dashed bg-card">{content}</div>
  );
}