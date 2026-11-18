import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { DemoCaption } from "./section"

/**
 * Viñetas de producto.
 *
 * No son capturas del dashboard ni resultados de clientes: son composiciones
 * hechas con los estilos reales del sistema y datos sintéticos, para mostrar
 * qué se ve y cómo se conecta. Cada panel se identifica como demostrativo.
 */

const tone = {
  light: {
    strong: "text-[var(--l-ink)]",
    soft: "text-[var(--l-ink-soft)]",
    faint: "text-[var(--l-ink-faint)]",
    line: "border-[var(--l-line)]",
    divider: "divide-[var(--l-line)]",
  },
  deep: {
    strong: "text-[var(--l-deep-fg)]",
    soft: "text-[var(--l-deep-fg-soft)]",
    faint: "text-[var(--l-deep-fg-faint)]",
    line: "border-[var(--l-deep-line)]",
    divider: "divide-[var(--l-deep-line)]",
  },
}

type Tone = keyof typeof tone

function Shell({
  title,
  meta,
  variant = "light",
  children,
  footer,
  className,
}: {
  title: ReactNode
  meta: ReactNode
  variant?: Tone
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const t = tone[variant]
  return (
    <div className={cn("l-panel", className)}>
      <div className="l-panel-head">
        <p className={cn("text-[0.8125rem] font-medium", t.strong)}>{title}</p>
        <span className={cn("l-chip", t.faint)}>{meta}</span>
      </div>
      <div className={cn("divide-y", t.divider)}>{children}</div>
      {footer ? <div className={cn("border-t px-4 py-3", t.line)}>{footer}</div> : null}
    </div>
  )
}

function Row({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", className)}>
      {children}
    </div>
  )
}

function Dot({ color }: { color: "ok" | "warn" | "signal" | "idle" }) {
  const value =
    color === "ok"
      ? "var(--l-ok)"
      : color === "warn"
        ? "var(--l-warn)"
        : color === "signal"
          ? "var(--l-signal)"
          : "var(--l-line-strong)"
  return <span aria-hidden className="l-dot" style={{ backgroundColor: value }} />
}

function Bar({
  value,
  color = "ok",
  inverse = false,
}: {
  value: number
  color?: "ok" | "warn" | "signal"
  inverse?: boolean
}) {
  const fill =
    color === "signal" ? "var(--l-signal)" : color === "warn" ? "var(--l-warn)" : "var(--l-ok)"
  return (
    <span
      aria-hidden
      className={cn(
        "block h-1 w-full overflow-hidden rounded-full",
        inverse ? "bg-[var(--l-deep-line)]" : "bg-[var(--l-line)]",
      )}
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: fill }}
      />
    </span>
  )
}

/* -------------------------------------------------------------------------- */

export function HeroControlPanel({ variant = "light" }: { variant?: Tone }) {
  const t = tone[variant]
  return (
    <div>
      <Shell title="Hoy · 3 sucursales" meta="Demostración" variant={variant}>
        <Row>
          <Dot color="warn" />
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-[0.8125rem] font-medium", t.strong)}>Polanco</p>
            <p className={cn("truncate text-[0.75rem]", t.faint)}>Apertura sin registrar</p>
          </div>
          <span className={cn("l-chip l-num", t.faint)}>12:04</span>
        </Row>
        <Row>
          <Dot color="signal" />
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-[0.8125rem] font-medium", t.strong)}>Condesa</p>
            <p className={cn("truncate text-[0.75rem]", t.faint)}>Cámara 2 · 6.4 °C</p>
          </div>
          <span className={cn("l-chip", t.faint)}>Fuera de rango</span>
        </Row>
        <Row>
          <Dot color="ok" />
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-[0.8125rem] font-medium", t.strong)}>Roma</p>
            <p className={cn("truncate text-[0.75rem]", t.faint)}>Cierre verificado</p>
          </div>
          <span className={cn("l-chip", t.faint)}>Listo</span>
        </Row>
        <Row>
          <Dot color="ok" />
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-[0.8125rem] font-medium", t.strong)}>
              Evidencia · Cámara 2
            </p>
            <p className={cn("truncate text-[0.75rem]", t.faint)}>
              Foto 08:16 · M. García
            </p>
          </div>
          <span className={cn("l-chip l-num", t.faint)}>92 %</span>
        </Row>
        <div className={cn("px-4 py-3.5", variant === "deep" ? "bg-[var(--l-deep-head)]" : "bg-[var(--l-paper)]")}>
          <p className={cn("text-[0.75rem] font-medium uppercase tracking-[0.12em]", t.faint)}>
            Incidencia vinculada a costo
          </p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className={cn("text-[0.8125rem] font-medium", t.strong)}>
                Mantenimiento · Cámara 2
              </p>
              <p className={cn("truncate text-[0.75rem]", t.faint)}>
                Servicios Fríos del Valle · OC-2026-0412
              </p>
            </div>
            <p className={cn("l-num shrink-0 text-[0.9375rem] font-semibold", t.strong)}>
              $1,160.00
            </p>
          </div>
          <div className="mt-3 space-y-1.5">
            <div className={cn("flex items-center justify-between text-[0.75rem]", t.faint)}>
              <span>Presupuesto de mantenimiento</span>
              <span className="l-num">68 %</span>
            </div>
            <Bar value={68} color="warn" inverse={variant === "deep"} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={cn("l-chip", t.faint)}>
              <Dot color="ok" /> Gerente aprobó
            </span>
            <span className={cn("l-chip", t.faint)}>
              <Dot color="warn" /> Dirección pendiente
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <p className={cn("text-[0.75rem]", t.faint)}>
            El mismo registro en la web y en WhatsApp.
          </p>
          <p className={cn("l-num text-[0.75rem]", t.faint)}>08:31</p>
        </div>
      </Shell>
      <DemoCaption inverse={variant === "deep"} />
    </div>
  )
}

export function ExceptionsPanel() {
  return (
    <div>
      <Shell title="Excepciones abiertas · 4" meta="Hoy">
        <Row>
          <Dot color="signal" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8125rem] font-medium text-[var(--l-ink)]">
              Temperatura fuera de rango
            </p>
            <p className="truncate text-[0.75rem] text-[var(--l-ink-faint)]">
              Condesa · Cámara 2 · M. García
            </p>
          </div>
          <span className="l-chip">Atender en 2 h</span>
        </Row>
        <Row>
          <Dot color="warn" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8125rem] font-medium text-[var(--l-ink)]">
              Recepción sin factura
            </p>
            <p className="truncate text-[0.75rem] text-[var(--l-ink-faint)]">
              Polanco · Proveedor · L. Fernández
            </p>
          </div>
          <span className="l-chip">Atender en 1 día</span>
        </Row>
        <Row>
          <Dot color="warn" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8125rem] font-medium text-[var(--l-ink)]">
              Conteo con diferencia
            </p>
            <p className="truncate text-[0.75rem] text-[var(--l-ink-faint)]">
              Roma · Barra · P. Sánchez
            </p>
          </div>
          <span className="l-chip">Atender en 4 h</span>
        </Row>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <p className="text-[0.75rem] text-[var(--l-ink-faint)]">3 con evidencia adjunta</p>
          <p className="text-[0.75rem] font-medium text-[var(--l-ink-soft)]">
            Asignar · Escalar · Cerrar
          </p>
        </div>
      </Shell>
      <DemoCaption />
    </div>
  )
}

export function FinancePanel() {
  const t = tone.deep
  return (
    <div>
      <Shell title="Presupuesto · Octubre" meta="Demostración" variant="deep">
        <div className="space-y-4 px-4 py-4">
          {[
            { label: "Mantenimiento", used: "$18,400", total: "$27,000", pct: 68, color: "warn" as const },
            { label: "Insumos", used: "$412,900", total: "$480,000", pct: 86, color: "warn" as const },
            { label: "Nómina", used: "$298,000", total: "$310,000", pct: 96, color: "signal" as const },
          ].map((item) => (
            <div key={item.label} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className={cn("text-[0.8125rem] font-medium", t.strong)}>{item.label}</p>
                <p className={cn("l-num text-[0.75rem]", t.faint)}>
                  {item.used} de {item.total}
                </p>
              </div>
              <Bar value={item.pct} color={item.color} inverse />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 px-4 py-4">
          {[
            { label: "Venta neta", value: "$1.28 M", note: "Grupo" },
            { label: "Alimentos + personal", value: "61.4 %", note: "Objetivo 60 %" },
            { label: "Resultado", value: "8.2 %", note: "Operativo" },
          ].map((metric) => (
            <div key={metric.label}>
              <p className={cn("text-[0.75rem]", t.faint)}>{metric.label}</p>
              <p className={cn("l-num mt-1 text-[0.9375rem] font-semibold", t.strong)}>
                {metric.value}
              </p>
              <p className={cn("text-[0.75rem]", t.faint)}>{metric.note}</p>
            </div>
          ))}
        </div>
      </Shell>
      <DemoCaption inverse />
    </div>
  )
}

const WORKFLOW_STEPS = [
  {
    time: "08:12",
    title: "Se detecta la desviación",
    detail: "Cámara 2 a 6.4 °C en Condesa. El control de temperatura no se puede cerrar.",
    chip: "Bloqueado",
    color: "signal" as const,
  },
  {
    time: "08:16",
    title: "Se documenta",
    detail: "Foto, lectura y responsable. La verificación automática decide si hace falta revisión humana.",
    chip: "Evidencia 92 %",
    color: "warn" as const,
  },
  {
    time: "08:31",
    title: "Se asigna y escala",
    detail: "Mantenimiento recibe la tarea. Si no responde, el escalamiento sube de nivel solo.",
    chip: "Asignado",
    color: "warn" as const,
  },
  {
    time: "09:05",
    title: "Se corrige y verifica",
    detail: "La evidencia de la corrección queda en el historial. La excepción se cierra con trazabilidad.",
    chip: "Verificado",
    color: "ok" as const,
  },
  {
    time: "09:20",
    title: "Se registra el costo",
    detail: "Gasto de mantenimiento con proveedor, presupuesto y autorización por monto.",
    chip: "$1,160.00",
    color: "ok" as const,
  },
]

export function WorkflowTimeline({ layout = "column" }: { layout?: "column" | "row" }) {
  if (layout === "row") {
    return (
      <div>
        <ol className="relative grid gap-x-6 gap-y-8 md:grid-cols-5">
          {WORKFLOW_STEPS.map((step, index) => (
            <li key={step.time} className="relative flex flex-col pl-6 md:pl-0">
              {/* Hilo del registro: vertical en columna, horizontal en fila. */}
              {index < WORKFLOW_STEPS.length - 1 ? (
                <>
                  <span
                    aria-hidden
                    className="absolute left-[5px] top-[10px] bottom-0 w-px bg-[var(--l-line-strong)] md:hidden"
                  />
                  <span
                    aria-hidden
                    className="absolute left-[5px] top-[5px] hidden h-px w-[calc(100%+24px)] bg-[var(--l-line-strong)] md:block"
                  />
                </>
              ) : null}
              <span
                aria-hidden
                className="absolute left-0 top-0 z-10 size-2.5 rounded-full md:relative md:left-auto md:top-auto md:mb-4"
                style={{
                  backgroundColor:
                    step.color === "signal"
                      ? "var(--l-signal)"
                      : step.color === "warn"
                        ? "var(--l-warn)"
                        : "var(--l-ok)",
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <p className="l-num text-[0.75rem] text-[var(--l-ink-faint)]">{step.time}</p>
                <span className="l-chip l-num">{step.chip}</span>
              </div>
              <p className="mt-2 text-[1.0625rem] font-medium leading-snug tracking-[-0.01em] text-[var(--l-ink)]">
                {step.title}
              </p>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--l-ink-soft)]">
                {step.detail}
              </p>
              {index === WORKFLOW_STEPS.length - 1 ? (
                <p className="mt-3 border-t border-[var(--l-line)] pt-3 text-[0.75rem] text-[var(--l-ink-faint)]">
                  El costo entra al presupuesto de la sucursal.
                </p>
              ) : null}
            </li>
          ))}
        </ol>
        <DemoCaption />
      </div>
    )
  }

  return (
    <div>
      <ol className="relative border-l border-[var(--l-line)] pl-6">
        {WORKFLOW_STEPS.map((step, index) => (
          <li key={step.time} className={index === WORKFLOW_STEPS.length - 1 ? "" : "pb-7"}>
            <span
              aria-hidden
              className="absolute -left-[0.3125rem] mt-1.5 flex size-2.5 items-center justify-center rounded-full border-2 border-[var(--l-paper)]"
              style={{
                backgroundColor:
                  step.color === "signal"
                    ? "var(--l-signal)"
                    : step.color === "warn"
                      ? "var(--l-warn)"
                      : "var(--l-ok)",
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <p className="l-num text-[0.75rem] text-[var(--l-ink-faint)]">{step.time}</p>
              <span className="l-chip l-num">{step.chip}</span>
            </div>
            <p className="mt-1 text-[0.9375rem] font-medium text-[var(--l-ink)]">{step.title}</p>
            <p className="mt-1 max-w-[42ch] text-[0.8125rem] leading-relaxed text-[var(--l-ink-soft)]">
              {step.detail}
            </p>
          </li>
        ))}
      </ol>
      <DemoCaption />
    </div>
  )
}

export function PurchasePanel({ variant = "light" }: { variant?: Tone }) {
  const t = tone[variant]
  return (
    <div>
      <Shell title="OC-2026-0412" meta="Pendiente de autorización" variant={variant}>
        <div className="space-y-2.5 px-4 py-4">
          {[
            { product: "Mantenimiento · Cámara 2", qty: "Condesa · Servicios Fríos del Valle", amount: "$1,000.00" },
            { product: "IVA", qty: "16 %", amount: "$160.00" },
          ].map((item) => (
            <div key={item.product} className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className={cn("text-[0.8125rem]", t.strong)}>{item.product}</p>
                <p className={cn("text-[0.75rem]", t.faint)}>{item.qty}</p>
              </div>
              <p className={cn("l-num shrink-0 text-[0.8125rem]", t.soft)}>{item.amount}</p>
            </div>
          ))}
        </div>
        <div className={cn("flex items-center justify-between gap-3 px-4 py-3", variant === "deep" ? "bg-[var(--l-deep-head)]" : "bg-[var(--l-paper)]")}>
          <p className={cn("text-[0.75rem]", t.faint)}>Total con IVA</p>
          <p className={cn("l-num text-[0.9375rem] font-semibold", t.strong)}>$1,160.00</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="l-chip">
            <Dot color="ok" /> Gerente aprobó
          </span>
          <span className="l-chip">
            <Dot color="warn" /> Dirección pendiente
          </span>
          <span className="l-chip">Evidencia de mantenimiento</span>
        </div>
      </Shell>
      <DemoCaption inverse={variant === "deep"} />
    </div>
  )
}

export function WorkforcePanel() {
  return (
    <div>
      <Shell title="Turno · Condesa" meta="Hoy">
        {[
          { area: "Cocina", coverage: "6 de 7", pct: 86, color: "warn" as const },
          { area: "Piso", coverage: "4 de 4", pct: 100, color: "ok" as const },
          { area: "Barra", coverage: "2 de 3", pct: 67, color: "signal" as const },
        ].map((row) => (
          <Row key={row.area}>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[0.8125rem] font-medium text-[var(--l-ink)]">{row.area}</p>
                <p className="l-num text-[0.75rem] text-[var(--l-ink-faint)]">{row.coverage}</p>
              </div>
              <span className="mt-2 block">
                <Bar value={row.pct} color={row.color} />
              </span>
            </div>
          </Row>
        ))}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="l-chip">Asistencia con geolocalización</span>
          <span className="l-chip">1 hora extra por autorizar</span>
          <span className="l-chip">Cambio de turno pendiente</span>
        </div>
      </Shell>
      <DemoCaption />
    </div>
  )
}

export function IntelligencePanel() {
  return (
    <div>
      <Shell title="Grupo · Octubre" meta="Demostración">
        <div className="grid grid-cols-3 gap-3 px-4 py-4">
          {[
            { label: "Prime cost", value: "61.4 %" },
            { label: "Food cost", value: "31.8 %" },
            { label: "Costo laboral", value: "29.6 %" },
          ].map((metric) => (
            <div key={metric.label}>
              <p className="text-[0.75rem] text-[var(--l-ink-faint)]">{metric.label}</p>
              <p className="l-num mt-1 text-[0.9375rem] font-semibold text-[var(--l-ink)]">
                {metric.value}
              </p>
            </div>
          ))}
        </div>
        <div className="space-y-3 px-4 py-4">
          {[
            { branch: "Condesa", value: 59.8 },
            { branch: "Polanco", value: 62.1 },
            { branch: "Roma", value: 63.4 },
          ].map((row, index) => (
            <div key={row.branch} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[0.75rem] text-[var(--l-ink-soft)]">{row.branch}</p>
                <p className="l-num text-[0.75rem] text-[var(--l-ink-faint)]">{row.value} %</p>
              </div>
              <Bar value={row.value} color={index === 2 ? "warn" : "ok"} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 bg-[var(--l-paper)] px-4 py-3">
          <p className="text-[0.75rem] text-[var(--l-ink-faint)]">Benchmarking entre sucursales</p>
          <p className="text-[0.75rem] font-medium text-[var(--l-ink-soft)]">Roma requiere revisión</p>
        </div>
      </Shell>
      <DemoCaption />
    </div>
  )
}

export function WhatsAppPanel({ variant = "deep" }: { variant?: Tone }) {
  const t = tone[variant]
  return (
    <div>
      <div className="l-panel mx-auto max-w-md">
        <div className="l-panel-head">
          <p className={cn("text-[0.8125rem] font-medium", t.strong)}>WhatsApp · Pedro Sánchez</p>
          <span className={cn("l-chip", t.faint)}>Demostración</span>
        </div>
        <div className="space-y-3 px-4 py-5">
          <div className={cn("max-w-[85%] rounded-lg rounded-tl-sm px-3 py-2", variant === "deep" ? "bg-[var(--l-deep-hover)]" : "bg-[var(--l-paper-deep)]")}>
            <p className={cn("text-[0.8125rem] leading-relaxed", t.soft)}>
              Tarea asignada: control de temperatura · Cámara 2 · Condesa
            </p>
            <p className={cn("mt-1 text-[0.75rem]", t.faint)}>08:14</p>
          </div>
          <div className={cn("ml-auto max-w-[85%] rounded-lg rounded-tr-sm px-3 py-2", variant === "deep" ? "bg-[var(--l-deep-bubble)]" : "bg-[var(--l-signal-soft)]")}>
            <p className={cn("text-[0.8125rem] leading-relaxed", t.strong)}>
              Lectura 6.4 °C. Adjunto foto del termómetro.
            </p>
            <div className={cn("mt-2 flex items-center gap-2 rounded border px-2 py-1.5", t.line)}>
              <span aria-hidden className={cn("size-6 rounded", variant === "deep" ? "bg-[var(--l-deep-attachment)]" : "bg-[var(--l-line)]")} />
              <span className={cn("text-[0.75rem]", t.faint)}>evidencia-01.jpg</span>
            </div>
            <p className={cn("mt-1 text-right text-[0.75rem]", t.faint)}>08:16</p>
          </div>
          <div className={cn("max-w-[85%] rounded-lg rounded-tl-sm px-3 py-2", variant === "deep" ? "bg-[var(--l-deep-hover)]" : "bg-[var(--l-paper-deep)]")}>
            <p className={cn("text-[0.8125rem] leading-relaxed", t.soft)}>
              Evidencia recibida. Se abre excepción y se avisa a mantenimiento.
            </p>
            <p className={cn("mt-1 text-[0.75rem]", t.faint)}>08:17</p>
          </div>
        </div>
      </div>
      <DemoCaption inverse={variant === "deep"} />
    </div>
  )
}
