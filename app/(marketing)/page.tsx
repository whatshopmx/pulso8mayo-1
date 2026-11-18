import type { ReactNode } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { ArrowRight, Check } from "lucide-react"
import { auth } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { Section, SectionIntro, BulletList } from "@/components/marketing/section"
import {
  ExceptionsPanel,
  FinancePanel,
  HeroControlPanel,
  PurchasePanel,
  WhatsAppPanel,
  WorkflowTimeline,
} from "@/components/marketing/panels"
import { Faq } from "@/components/marketing/faq"
import { diagnosisHref } from "@/components/marketing/diagnosis"

const PRICING = [
  {
    slug: "foundation",
    name: "Foundation",
    limit: 5,
    description: "Para grupos que están ordenando la operación diaria.",
    features: [
      "Tareas, plantillas y evidencia",
      "Excepciones, alertas y resumen diario",
      "Inventario, compras y proveedores",
      "Gastos con presupuesto y autorización",
    ],
    featured: false,
  },
  {
    slug: "growth",
    name: "Growth",
    limit: 15,
    description: "Para cadenas que ya comparan sucursales y necesitan margen.",
    features: [
      "Todo lo de Foundation",
      "Comparación entre sucursales",
      "Flujo de efectivo y conciliación",
      "Análisis de compras y guías operativas",
    ],
    featured: true,
  },
  {
    slug: "executive",
    name: "Executive",
    limit: 50,
    description: "Para grupos con red propia, franquicias o expansión activa.",
    features: [
      "Todo lo de Growth",
      "Consolidado multi-red",
      "Planeación financiera",
      "Seguimiento de decisiones",
    ],
    featured: false,
  },
]

/**
 * Precio de lista: pesos por sucursal al mes, `null` = todavía no publicado.
 *
 * Es el único lugar donde vive la cifra comercial del landing. Mientras siga en
 * `null` la sección se presenta como "Cómo se cobra" y no promete un precio que
 * no existe; al llenar los tres valores cambian el título, la línea de precio de
 * cada tarjeta y el texto de la nota, sin tocar el resto de la página.
 */
const PRICE_FROM_PER_BRANCH_MXN: Record<string, number | null> = {
  foundation: null,
  growth: null,
  executive: null,
}

const HAS_PUBLISHED_PRICES = Object.values(PRICE_FROM_PER_BRANCH_MXN).some(
  (value) => typeof value === "number",
)

const MONTHLY_PRICE = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
})

function CallToAction({
  href,
  children,
  variant = "primary",
  className,
}: {
  href: string
  children: ReactNode
  variant?: "primary" | "outline" | "light"
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-5 py-2 text-sm font-medium transition-colors",
        variant === "primary" &&
          "bg-[var(--l-signal)] text-white hover:bg-[var(--l-signal-hover)]",
        variant === "outline" &&
          "border border-[var(--l-line-strong)] text-[var(--l-ink)] hover:bg-[var(--l-paper-deep)]",
        variant === "light" &&
          "border border-[var(--l-deep-outline)] text-[var(--l-deep-fg)] hover:bg-[var(--l-deep-hover)]",
        className,
      )}
    >
      {children}
      <ArrowRight className="size-4" aria-hidden />
    </Link>
  )
}

function PricingCard({ plan }: { plan: (typeof PRICING)[number] }) {
  const priceFrom = PRICE_FROM_PER_BRANCH_MXN[plan.slug]

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border p-6",
        plan.featured
          ? "border-[var(--l-ink)] bg-white"
          : "border-[var(--l-line)] bg-transparent",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="l-h3">{plan.name}</h3>
        {plan.featured ? (
          <span className="l-chip border-[var(--l-ink)] text-[var(--l-ink)]">Más común</span>
        ) : null}
      </div>
      <p className="mt-1 text-[0.8125rem] text-[var(--l-ink-faint)]">
        Hasta {plan.limit} sucursales
      </p>

      {typeof priceFrom === "number" ? (
        <p className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[0.75rem] text-[var(--l-ink-faint)]">Desde</span>
          <span className="l-num text-[1.75rem] font-semibold tracking-[-0.02em] text-[var(--l-ink)]">
            {MONTHLY_PRICE.format(priceFrom)}
          </span>
          <span className="text-[0.75rem] text-[var(--l-ink-faint)]">por sucursal / mes</span>
        </p>
      ) : (
        <p className="mt-5 border-t border-[var(--l-line)] pt-4 text-[0.8125rem] leading-relaxed text-[var(--l-ink-faint)]">
          Se cotiza por sucursal, según el alcance que configures.
        </p>
      )}

      <p className="l-body mt-4">{plan.description}</p>
      <ul className="mt-6 flex-1 space-y-2.5 border-t border-[var(--l-line)] pt-6">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-2.5 text-[0.875rem] text-[var(--l-ink-soft)]">
            <Check className="mt-0.5 size-4 shrink-0 text-[var(--l-ink-faint)]" aria-hidden />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <CallToAction
        href={diagnosisHref(plan.name)}
        variant={plan.featured ? "primary" : "outline"}
        className="mt-8 w-full"
      >
        Consultar {plan.name}
      </CallToAction>
    </div>
  )
}

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (session?.user) {
    redirect("/dashboard")
  }

  return (
    <>
      <section className="pb-16 pt-12 md:pb-24 md:pt-20">
        <div className="l-container grid gap-12 lg:grid-cols-[minmax(0,1.04fr)_minmax(0,0.96fr)] lg:items-start lg:gap-16">
          <div className="max-w-2xl">
            <h1 className="l-display">
              Tu operación ya cuenta qué pasó. Ahora también cuenta{" "}
              <span className="text-[var(--l-signal)]">cuánto costó</span>.
            </h1>
            <p className="l-lead mt-6">
              Pulso conecta las tareas de tus sucursales con la evidencia, el gasto y el
              presupuesto. Para que sepas qué requiere atención y cuánto cuesta resolverlo.
            </p>
            <p className="l-body mt-4">
              Para grupos de restaurantes, hoteles, cafeterías y franquicias en México.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <CallToAction href={diagnosisHref()}>Solicitar diagnóstico</CallToAction>
              <CallToAction href="#workflows" variant="outline">Ver cómo funciona</CallToAction>
            </div>
            <p className="mt-4 max-w-[48ch] text-[0.8125rem] leading-relaxed text-[var(--l-ink-soft)]">
              Escríbenos por WhatsApp. Revisamos tus sucursales, controles y prioridades
              antes de definir la configuración y la propuesta.
            </p>
          </div>
          <div className="lg:pt-3"><HeroControlPanel /></div>
        </div>
      </section>

      <Section id="workflows" tone="soft" className="border-t border-[var(--l-line)]">
        <span id="problema" className="scroll-mt-24" />
        <SectionIntro
          title="De una cámara fuera de rango a un gasto explicado."
          lead="Si la tarea se cierra en un lugar y el gasto aparece en otro, pierdes el origen del costo. En Pulso, la incidencia conserva su responsable, evidencia y presupuesto durante todo el recorrido."
        />
        <div className="mt-12"><WorkflowTimeline layout="row" /></div>
        <p className="mt-6 max-w-[62ch] text-[0.8125rem] leading-relaxed text-[var(--l-ink-soft)]">
          El ejemplo sigue la cámara 2 de Condesa: mantenimiento por $1,160 con IVA,
          vinculado a la orden OC-2026-0412. Son datos demostrativos, no resultados de un cliente.
        </p>
      </Section>

      <Section id="operaciones" className="border-t border-[var(--l-line)]">
        <span id="producto" className="scroll-mt-24" />
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:items-start lg:gap-16">
          <div>
            <SectionIntro
              title="Atiende lo que necesita cada sucursal."
              lead="Revisa las incidencias, asigna responsables y verifica la corrección con evidencia. El cumplimiento se documenta en la operación diaria."
            />
            <BulletList items={[
              "Incidencias con responsable, plazo de atención y seguimiento hasta el cierre.",
              "Fotos con verificación automática y revisión humana cuando hace falta.",
              "Comparación de sucursales para decidir dónde intervenir primero.",
            ]} />
            <details className="mt-8 border-y border-[var(--l-line)] py-5">
              <summary className="cursor-pointer text-[0.9375rem] font-medium text-[var(--l-ink)]">Controles diarios y cumplimiento</summary>
              <p className="l-body mt-4">
                31 plantillas adaptables para apertura, cierre, temperatura, recepción y conteo,
                entre otras tareas. Cada paso conserva quién lo hizo, cuándo y con qué evidencia.
                Los controles NOM-251 y NOM-035 quedan documentados en el mismo historial.
                Los enlaces de tarea permiten ejecutar sin crear una cuenta.
              </p>
            </details>
          </div>
          <ExceptionsPanel />
        </div>
      </Section>

      <Section id="finanzas" tone="deep" className="border-t border-[var(--l-line)]">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:items-center lg:gap-16">
          <div>
            <SectionIntro inverse
              title="Conoce el costo antes del cierre de mes."
              lead="Cada gasto conserva su origen, autorización y comprobante. El presupuesto muestra lo comprometido para que puedas corregir a tiempo."
            />
            <BulletList inverse items={[
              "Gastos y compras con presupuesto y aprobación por monto.",
              "Cuentas por pagar, tesorería, caja chica y conciliación bancaria.",
              "Ingresos, gastos y resultado por sucursal, con el origen de cada cifra.",
            ]} />
          </div>
          <FinancePanel />
        </div>
        <div className="mt-10 divide-y divide-[var(--l-deep-line)] border-y border-[var(--l-deep-line)]">
          <details id="compras" className="scroll-mt-24 py-5">
            <summary className="cursor-pointer text-[0.9375rem] font-medium">Compras, inventario y proveedores</summary>
            <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:items-center">
              <p className="l-body">
                La orden pasa por autorización, recepción y factura hasta la cuenta por pagar.
                Registra temperaturas y costos al recibir, compara lo facturado con lo que llegó
                y conserva las condiciones de pago del proveedor. Inventario, insumos, mermas
                y costo de receta comparten el seguimiento de la sucursal.
              </p>
              <PurchasePanel variant="deep" />
            </div>
          </details>
          <details id="inteligencia" className="scroll-mt-24 py-5">
            <summary className="cursor-pointer text-[0.9375rem] font-medium">Comparación de sucursales y próximos pagos</summary>
            <p className="l-body mt-4 max-w-[62ch]">
              Compara costo de alimentos y personal, revisa la liquidez y los compromisos
              de los próximos 14 días. El resumen matutino muestra qué cambió y qué requiere
              una decisión. También puedes validar CFDI contra el SAT, timbrar nómina
              y generar pólizas y exportaciones contables.
            </p>
          </details>
        </div>
      </Section>

      <Section id="whatsapp" className="border-t border-[var(--l-line)]">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-start lg:gap-16">
          <div>
            <SectionIntro
              title="Tu equipo trabaja desde WhatsApp."
              lead="Envía tareas y recibe evidencia en el mismo hilo. El equipo registra asistencia y descansos sin abrir una computadora."
            />
            <BulletList items={[
              "Tareas, recordatorios y alertas directo al teléfono.",
              "Fotos que quedan en el historial de la tarea y la sucursal.",
              "Entradas, salidas y descansos con seguimiento desde la web.",
            ]} />
            <details className="mt-8 border-y border-[var(--l-line)] py-5">
              <summary className="cursor-pointer text-[0.9375rem] font-medium text-[var(--l-ink)]">Turnos, personal y costo laboral</summary>
              <p className="l-body mt-4">
                Asistencia con geolocalización; turnos, cambios, vacaciones y horas extra
                con aprobación. Nómina, finiquitos y propinas conectados al expediente del
                empleado, con alertas de reglas laborales y costo por sucursal.
              </p>
            </details>
            <p className="mt-6 max-w-[48ch] text-[0.8125rem] leading-relaxed text-[var(--l-ink-soft)]">
              WhatsApp ejecuta tareas, asistencia y evidencia. Los gastos se registran en la plataforma web.
            </p>
          </div>
          <WhatsAppPanel variant="light" />
        </div>
      </Section>

      <Section id="implementacion" tone="soft" className="border-t border-[var(--l-line)]">
        <SectionIntro
          title="Primero entendemos tu operación."
          lead="El diagnóstico guiado define por dónde empezar. No necesitas sustituir tu punto de venta ni conectar un ERP para operar la primera sucursal."
        />
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {[
            { title: "Revisamos contigo", body: "Sucursales, turnos, controles y responsables de autorización. Con esas prioridades definimos el alcance y la propuesta." },
            { title: "Configuramos el arranque", body: "Empresa, sucursales, plantillas, presupuestos, roles y reglas de aprobación. Acordamos qué catálogos y datos necesitas cargar." },
            { title: "El equipo empieza a operar", body: "Las tareas se ejecutan desde la web y WhatsApp. Dirección revisa el mismo registro, sin pedir reportes paralelos." },
          ].map((item) => (
            <li key={item.title} className="border-t border-[var(--l-line-strong)] pt-5">
              <h3 className="l-h3">{item.title}</h3>
              <p className="l-body mt-3">{item.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8"><CallToAction href={diagnosisHref()}>Solicitar diagnóstico</CallToAction></div>
        <p className="mt-3 text-[0.8125rem] text-[var(--l-ink-soft)]">La solicitud se abre en WhatsApp. No necesitas crear una cuenta.</p>
      </Section>

      <Section id="precios" className="border-t border-[var(--l-line)]">
        <SectionIntro
          title={HAS_PUBLISHED_PRICES ? "Planes por tamaño de operación." : "Cómo se cobra."}
          lead="Por sucursales incluidas, no por usuario. El diagnóstico ayuda a elegir el alcance; la propuesta fija el importe antes de contratar."
        />
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {PRICING.map((plan) => <PricingCard key={plan.slug} plan={plan} />)}
        </div>
        <p className="mt-6 max-w-[62ch] text-[0.8125rem] leading-relaxed text-[var(--l-ink-soft)]">
          Cada plan incluye las capacidades del anterior. Consultar un plan abre WhatsApp
          con su nombre en el mensaje; el alcance y la facturación se acuerdan con el equipo.
        </p>
      </Section>

      <Section id="faq" className="border-t border-[var(--l-line)]">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <SectionIntro title="Preguntas antes de empezar." lead="Punto de venta, evidencia, cumplimiento y alcance actual de Pulso." />
          <Faq />
        </div>
      </Section>

      <Section tone="deep" className="border-t border-[var(--l-line)]">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-end lg:gap-16">
          <div>
            <h2 className="l-h2 max-w-[20ch]">Hablemos de tus sucursales.</h2>
            <p className="l-lead mt-5 max-w-[46ch]">
              Cuéntanos qué necesitas controlar. En el diagnóstico revisamos tus prioridades
              y definimos cómo empezar con Pulso.
            </p>
          </div>
          <div className="lg:justify-self-end">
            <CallToAction href={diagnosisHref()}>Solicitar diagnóstico</CallToAction>
            <p className="mt-3 text-[0.8125rem] text-[var(--l-deep-fg-soft)]">Por WhatsApp · Sin crear una cuenta</p>
          </div>
        </div>
        <p className="mt-10 border-t border-[var(--l-deep-line)] pt-6 text-[0.75rem] text-[var(--l-deep-fg-faint)]">
          Las cifras, sucursales y nombres de esta página son demostrativos.
        </p>
      </Section>
    </>
  )
}
