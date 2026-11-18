import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Primitivas de composición del landing. No sustituyen a las del dashboard:
 * viven en la capa de marketing y solo resuelven ritmo vertical, contenedor y
 * jerarquía tipográfica.
 */

export function Section({
  id,
  children,
  className,
  tone = "paper",
}: {
  id?: string
  children: ReactNode
  className?: string
  tone?: "paper" | "deep" | "soft"
}) {
  return (
    <section
      id={id}
      className={cn(
        "l-section scroll-mt-24",
        tone === "deep" && "l-band-deep",
        tone === "soft" && "bg-[var(--l-paper-deep)]",
        className,
      )}
    >
      <div className="l-container">{children}</div>
    </section>
  )
}

export function SectionIntro({
  label,
  title,
  lead,
  inverse = false,
  className,
}: {
  label?: string
  title: ReactNode
  lead?: ReactNode
  inverse?: boolean
  className?: string
}) {
  return (
    <div className={cn("max-w-3xl", className)}>
      {label ? (
        <p
          className={cn(
            "mb-4 text-[0.75rem] font-medium uppercase tracking-[0.16em]",
            inverse ? "text-[var(--l-deep-fg-muted)]" : "text-[var(--l-ink-faint)]",
          )}
        >
          {label}
        </p>
      ) : null}
      <h2 className="l-h2">{title}</h2>
      {lead ? <p className="l-lead mt-5">{lead}</p> : null}
    </div>
  )
}

export function BulletList({
  items,
  inverse = false,
  columns = 1,
}: {
  items: ReactNode[]
  inverse?: boolean
  columns?: 1 | 2
}) {
  return (
    <ul
      className={cn(
        "mt-8 space-y-4",
        columns === 2 && "grid gap-x-10 gap-y-4 space-y-0 md:grid-cols-2",
      )}
    >
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span
            aria-hidden
            className={cn(
              "mt-[0.55rem] h-px w-5 shrink-0",
              inverse ? "bg-[var(--l-deep-marker)]" : "bg-[var(--l-line-strong)]",
            )}
          />
          <span
            className={cn(
              "text-[0.9375rem] leading-relaxed",
              inverse ? "text-[var(--l-deep-fg-body)]" : "text-[var(--l-ink-soft)]",
            )}
          >
            {item}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function DemoCaption({ inverse = false }: { inverse?: boolean }) {
  return (
    <p
      className={cn(
        "mt-3 text-[0.75rem]",
        inverse ? "text-[var(--l-deep-fg-muted)]" : "text-[var(--l-ink-soft)]",
      )}
    >
      Datos demostrativos. No corresponden a un cliente real.
    </p>
  )
}
