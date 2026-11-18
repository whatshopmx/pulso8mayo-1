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
  IntelligencePanel,
  PurchasePanel,
  WhatsAppPanel,
  WorkforcePanel,
  WorkflowTimeline,
} from "@/components/marketing/panels"
import { Faq } from "@/components/marketing/faq"

const PILLARS = [
  {
    label: "Operación",
    title: "Qué sucede",
    description:
      "Workflows, evidencia, excepciones y cumplimiento en cada sucursal. Lo que requiere atención hoy, con responsable y seguimiento.",
    modules: "Workflows · Evidencia · Excepciones · NOM-251/035",
    href: "#operaciones",
  },
  {
    label: "Costo",
    title: "Cuánto cuesta",
    description:
      "Gastos, presupuesto, compras, proveedores y resultado por sucursal. El costo aparece cuando se origina, no a fin de mes.",
    modules: "Gastos · Presupuesto · Compras · P&L",
    href: "#finanzas",
  },
  {
    label: "Conexión",
    title: "Qué hacer después",
    description:
      "El workflow convierte una desviación en una acción, y la acción en un gasto con evidencia, autorización y presupuesto.",
    modules: "Incidencia → acción → gasto → resultado",
    href: "#workflows",
  },
]

const PRICING = [
  {
    slug: "foundation",
    name: "Foundation",
    limit: 5,
    description: "Para grupos que están ordenando la operación diaria.",
    features: [
      "Workflows, plantillas y evidencia",
      "Excepciones, alertas y brief diario",
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
      "Benchmarking entre sucursales",
      "Flujo de efectivo y conciliación",
      "Inteligencia de compras y playbooks",
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

const INDUSTRIES = [
  {
    name: "Restaurantes",
    description:
      "Apertura, cierre, temperatura, merma, conteo y costo de receta en el mismo lugar donde se ejecuta el turno.",
    examples: "Operación diaria · Inocuidad · Food cost",
  },
  {
    name: "Hoteles",
    description:
      "Buffet, cocina, áreas comunes y mantenimiento con evidencia por área y turno, sin perder el costo del servicio.",
    examples: "Multiárea · Turnos · Mantenimiento",
  },
  {
    name: "Cafeterías",
    description:
      "Control de barra, insumos, mermas y personal en operaciones con alto volumen y equipos pequeños.",
    examples: "Barra · Insumos · Asistencia",
  },
  {
    name: "Grupos y franquicias",
    description:
      "Consolidado por sucursal y por red, con permisos por rol y comparación de desempeño entre unidades.",
    examples: "Multi-sucursal · Roles · Benchmarking",
  },
]

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
        "inline-flex h-11 items-center justify-center gap-2 rounded-md px-5 text-sm font-medium transition-colors",
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
        href="/sign-up"
        variant={plan.featured ? "primary" : "outline"}
        className="mt-8 w-full"
      >
        Empezar con {plan.name}
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
      {/* Hero */}
      <section className="pb-16 pt-12 md:pb-24 md:pt-20">
        <div className="l-container grid gap-12 lg:grid-cols-[minmax(0,1.04fr)_minmax(0,0.96fr)] lg:items-start lg:gap-16">
          <div className="max-w-2xl">
            <p className="l-kicker">Operación y finanzas para cadenas HORECA</p>
            <h1 className="l-display mt-6">
              Tu operación ya cuenta qué pasó. Ahora también cuenta{" "}
              <span className="text-[var(--l-signal)]">cuánto costó</span>.
            </h1>
            <p className="l-lead mt-6">
              Pulso conecta la ejecución diaria de tus sucursales con el gasto, el presupuesto y
              el resultado. La misma evidencia que cierra una tarea abre el gasto que la resolvió.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <CallToAction href="/sign-up">Crear cuenta</CallToAction>
              <CallToAction href="#workflows" variant="outline">
                Ver el recorrido
              </CallToAction>
            </div>
            <p className="mt-4 text-[0.8125rem] text-[var(--l-ink-faint)]">
              Configura tu empresa y tu primera sucursal. Sin instalar nada.
            </p>
          </div>
          <div className="lg:pt-3">
            <HeroControlPanel />
          </div>
        </div>
      </section>

      {/* Problema */}
      <Section id="problema" className="border-t border-[var(--l-line)]">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16">
          <SectionIntro
            title={
              <>
                La operación se ejecuta en un lugar.
                <br />
                El costo se explica en otro.
              </>
            }
            lead="Cuando la tarea, la evidencia y el gasto viven en sistemas distintos, cada decisión se toma con la mitad de la información."
          />
          <div className="divide-y divide-[var(--l-line)] border-t border-[var(--l-line)]">
            {[
              {
                title: "La incidencia se cierra, pero nadie sabe cuánto costó resolverla.",
                body: "El mantenimiento llegó, la cámara volvió a su temperatura y el gasto apareció semanas después en el estado de cuenta.",
              },
              {
                title: "El gasto se aprueba, pero no se sabe qué lo originó.",
                body: "La factura trae un monto y un proveedor. No trae la sucursal, el turno ni la desviación que obligó a comprar.",
              },
              {
                title: "El presupuesto se revisa a fin de mes, cuando ya no se puede corregir.",
                body: "Para cuando el reporte muestra la desviación, el compromiso ya está hecho y el margen ya se movió.",
              },
            ].map((item) => (
              <div key={item.title} className="py-6">
                <p className="text-[1rem] font-medium leading-snug text-[var(--l-ink)]">
                  {item.title}
                </p>
                <p className="l-body mt-2 max-w-[52ch]">{item.body}</p>
              </div>
            ))}
            <p className="pt-6 text-[0.9375rem] leading-relaxed text-[var(--l-ink-soft)]">
              Pulso mantiene el hilo: qué pasó, quién lo atendió, con qué evidencia y a qué costo.
            </p>
          </div>
        </div>
      </Section>

      {/* Tres pilares */}
      <Section id="producto" tone="soft" className="border-t border-[var(--l-line)]">
        <SectionIntro
          title="Tres capas que comparten los mismos datos."
          lead="No es un módulo de operaciones con un reporte financiero al final. Es el mismo registro el que se ejecuta, se evidencia, se autoriza y se mide."
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-[var(--l-line)] bg-[var(--l-line)] md:grid-cols-3">
          {PILLARS.map((pillar) => (
            <a
              key={pillar.title}
              href={pillar.href}
              className="group flex flex-col bg-[var(--l-paper)] p-6 transition-colors hover:bg-white"
            >
              <p className="text-[0.75rem] font-medium uppercase tracking-[0.14em] text-[var(--l-ink-faint)]">
                {pillar.label}
              </p>
              <h3 className="l-h3 mt-3">{pillar.title}</h3>
              <p className="l-body mt-3 flex-1">{pillar.description}</p>
              <p className="mt-6 border-t border-[var(--l-line)] pt-4 text-[0.75rem] text-[var(--l-ink-faint)]">
                {pillar.modules}
              </p>
              <span className="mt-3 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--l-ink)]">
                Ver
                <ArrowRight
                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </span>
            </a>
          ))}
        </div>
      </Section>

      {/* Operaciones */}
      <Section id="operaciones" className="border-t border-[var(--l-line)]">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:items-center lg:gap-16">
          <div>
            <SectionIntro
              title="Un centro de operación, no un tablero de tarjetas."
              lead="Revisa qué requiere atención hoy en cada sucursal, qué evidencia existe y quién es responsable. Sin cambiar de sistema ni pedir reportes por WhatsApp."
            />
            <BulletList
              items={[
                "Excepciones con ciclo de vida: asignar, escalar, resolver, verificar y cerrar.",
                "Evidencia fotográfica con verificación automática y revisión humana cuando hace falta.",
                "Comparación entre sucursales para encontrar la que necesita ayuda, no la que hace más ruido.",
                "Cumplimiento NOM-251 y NOM-035 documentado dentro de la operación diaria, no en una carpeta aparte.",
              ]}
            />
          </div>
          <ExceptionsPanel />
        </div>
      </Section>

      {/* Finanzas */}
      <Section id="finanzas" tone="deep" className="border-t border-[var(--l-line)]">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:items-center lg:gap-16">
          <div>
            <SectionIntro
              inverse
              title="El costo de operar, con la misma claridad que la operación."
              lead="Cada gasto tiene origen, autorización y comprobante. Cada presupuesto muestra lo comprometido antes de que se convierta en sorpresa."
            />
            <BulletList
              inverse
              items={[
                "Gasto operativo con evidencia, presupuesto y matriz de aprobación por monto.",
                "Compras y proveedores: orden, autorización, recepción con temperatura y factura.",
                "Cuentas por pagar, tesorería, caja chica y conciliación bancaria.",
                "P&L por sucursal y costo laboral con procedencia auditable de cada cifra.",
              ]}
            />
            <p className="mt-8 text-[0.8125rem] leading-relaxed text-[var(--l-deep-fg-muted)]">
              También cierra el circuito fiscal: validación de CFDI contra el SAT y timbrado de
              nómina, con el modo de prueba separado de producción.
            </p>
          </div>
          <FinancePanel />
        </div>
      </Section>

      {/* Workflows. Es la sección que demuestra el mecanismo (incidencia →
          costo), así que va a ancho completo en lugar de media columna. */}
      <Section id="workflows" className="border-t border-[var(--l-line)]">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.55fr)] lg:items-end lg:gap-16">
          <SectionIntro
            title="De la incidencia al gasto, sin salir del hilo."
            lead="Un mismo registro atraviesa operación, evidencia, autorización y resultado. Este es el recorrido que el sistema ya ejecuta hoy."
          />
          <p className="text-[0.8125rem] leading-relaxed text-[var(--l-ink-faint)] lg:pb-1">
            Cinco pasos, un solo registro. El ejemplo usa la sucursal Condesa y un importe
            demostrativo; no es el resultado de un cliente.
          </p>
        </div>
        <div className="mt-14">
          <WorkflowTimeline layout="row" />
        </div>
        <BulletList
          columns={2}
          items={[
            "31 plantillas de operación listas para adaptar: apertura, cierre, temperatura, recepción, conteo y más.",
            "Verificación automática de la evidencia, con umbral de confianza y revisión cuando no alcanza.",
            "Escalamiento por niveles y smart links para ejecutar tareas sin crear una cuenta.",
            "Cada paso deja historial: quién, cuándo, con qué foto y con qué resultado.",
          ]}
        />
      </Section>

      {/* Compras + turno: dos costos que no aparecen en el corte, en un solo
          bloque de dos columnas. Antes eran dos secciones idénticas seguidas. */}
      <Section id="compras" tone="soft" className="border-t border-[var(--l-line)]">
        <SectionIntro
          title="Dos costos que el corte de caja no muestra."
          lead="Lo que entra a la bodega y las horas que cubren el turno salen del mismo presupuesto. En Pulso se autorizan y se leen juntos."
        />
        <div className="mt-12 grid gap-12 md:grid-cols-2 md:gap-10 lg:gap-14">
          <div>
            <h3 className="l-h3">Compras y proveedores</h3>
            <p className="l-body mt-2">
              La orden de compra nace de una necesidad operativa, pasa por la matriz de aprobación y
              termina en recepción, factura y cuenta por pagar.
            </p>
            <div className="mt-8">
              <PurchasePanel />
            </div>
            <BulletList
              items={[
                "Órdenes de compra con estados claros: borrador, por autorizar, aprobada, enviada, recibida.",
                "Autorización por monto y por rol, sin perseguir firmas por mensaje.",
                "Recepción con temperatura y costo, para comparar la factura con lo que llegó.",
                "Proveedores con cuentas bancarias y condiciones de pago registradas.",
              ]}
            />
          </div>
          <div>
            <h3 className="l-h3">Turno y personal</h3>
            <p className="l-body mt-2">
              Asistencia, turnos, horas extra y nómina comparten la misma base que la operación. Lo
              que pasa en el piso se puede leer en el costo laboral.
            </p>
            <div className="mt-8">
              <WorkforcePanel />
            </div>
            <BulletList
              items={[
                "Asistencia con geolocalización y registro desde WhatsApp.",
                "Turnos, cambios de turno, breaks y vacaciones con aprobación.",
                "Horas extra y reglas laborales con alertas antes de que se conviertan en pasivo.",
                "Nómina, finiquitos y propinas conectados al mismo expediente del empleado.",
              ]}
            />
          </div>
        </div>
      </Section>

      {/* Inteligencia */}
      <Section id="inteligencia" tone="soft" className="border-t border-[var(--l-line)]">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)] lg:items-center lg:gap-16">
          <div className="lg:order-2">
            <SectionIntro
              title="Una lectura ejecutiva, no otro reporte."
              lead="El cockpit de dirección reúne unit economics, prime cost y liquidez a 14 días. La comparación entre sucursales dice dónde intervenir primero."
            />
            <BulletList
              items={[
                "Prime cost, food cost y costo laboral por sucursal y por grupo.",
                "Liquidez proyectada y compromisos de los próximos 14 días.",
                "Benchmarking entre sucursales y mejores prácticas.",
                "Brief matutino con lo que cambió y lo que requiere una decisión.",
              ]}
            />
          </div>
          <div className="lg:order-1">
            <IntelligencePanel />
          </div>
        </div>
      </Section>

      {/* WhatsApp */}
      <Section id="whatsapp" tone="deep" className="border-t border-[var(--l-line)]">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-16">
          <div>
            <SectionIntro
              inverse
              title="El trabajo ocurre donde está el equipo."
              lead="Pulso manda la tarea por WhatsApp y recibe la evidencia en el mismo hilo. La asistencia y los breaks se registran sin abrir una computadora."
            />
            <BulletList
              inverse
              items={[
                "Asignación de tareas y recordatorios directo al teléfono.",
                "Evidencia fotográfica que vuelve al workflow, no a un chat perdido.",
                "Check-in, check-out y breaks con la misma trazabilidad que la web.",
                "Notificaciones de excepciones, documentos y cumplimiento.",
              ]}
            />
            <p className="mt-8 max-w-[48ch] text-[0.8125rem] leading-relaxed text-[var(--l-deep-fg-muted)]">
              Alcance actual: WhatsApp ejecuta tareas, asistencia y evidencia. El registro de gastos
              se hace desde el dashboard.
            </p>
          </div>
          <WhatsAppPanel />
        </div>
      </Section>

      {/* Industrias */}
      <Section id="industrias" className="border-t border-[var(--l-line)]">
        <SectionIntro
          title="Hecho para operaciones con turnos, insumos y mermas."
          lead="La misma plataforma cambia de configuración según el tipo de negocio. Lo que no cambia es el hilo entre lo que pasó y lo que costó."
        />
        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-[var(--l-line)] bg-[var(--l-line)] sm:grid-cols-2">
          {INDUSTRIES.map((industry) => (
            <div key={industry.name} className="bg-[var(--l-paper)] p-6">
              <h3 className="l-h3">{industry.name}</h3>
              <p className="l-body mt-3">{industry.description}</p>
              <p className="mt-5 text-[0.75rem] text-[var(--l-ink-faint)]">{industry.examples}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Implementación */}
      <Section id="implementacion" tone="soft" className="border-t border-[var(--l-line)]">
        <SectionIntro
          title="Empezar no requiere migrar tu operación."
          lead="Pulso se configura sobre lo que ya haces. No necesitas conectar un ERP ni sustituir tu punto de venta para tener la primera sucursal operando."
        />
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {[
            {
              step: "Paso 1",
              title: "Diagnóstico",
              body: "Revisamos sucursales, turnos, controles y quién autoriza qué. De ahí sale la configuración inicial, no un paquete genérico.",
            },
            {
              step: "Paso 2",
              title: "Configuración",
              body: "Empresa, sucursales, plantillas, presupuestos, roles y reglas de aprobación. El equipo empieza con las tareas que ya hace todos los días.",
            },
            {
              step: "Paso 3",
              title: "Operación",
              body: "El equipo ejecuta desde la web y WhatsApp. Dirección lee el mismo dato en el cockpit, sin pedir reportes paralelos.",
            },
          ].map((item) => (
            <div key={item.title} className="border-t border-[var(--l-line-strong)] pt-5">
              <p className="text-[0.75rem] font-medium uppercase tracking-[0.14em] text-[var(--l-ink-faint)]">
                {item.step}
              </p>
              <h3 className="l-h3 mt-2">{item.title}</h3>
              <p className="l-body mt-2">{item.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 max-w-[62ch] text-[0.8125rem] leading-relaxed text-[var(--l-ink-faint)]">
          La carga de catálogo, empleados y presupuestos se acuerda en la implementación. No hay
          migración obligatoria ni integración con ERP como requisito de arranque.
        </p>
      </Section>

      {/* Cómo se cobra. Si `PRICE_FROM_PER_BRANCH_MXN` tiene cifras, el título
          y la bajada pasan a modo lista de precios. */}
      <Section id="precios" className="border-t border-[var(--l-line)]">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end lg:gap-16">
          <SectionIntro
            title={HAS_PUBLISHED_PRICES ? "Planes por tamaño de operación." : "Cómo se cobra."}
            lead="Cobramos por sucursales incluidas, no por usuario. Cada plan acumula las capacidades del anterior."
          />
          <p className="text-[0.875rem] leading-relaxed text-[var(--l-ink-soft)] lg:pb-1">
            {HAS_PUBLISHED_PRICES
              ? "El importe final depende del número de sucursales y del alcance con el que arranques. La propuesta fija ambos antes de contratar."
              : "El importe depende del número de sucursales y del alcance con el que arranques, así que lo fijamos en la propuesta en lugar de publicar una cifra que no corresponde a tu operación."}
          </p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {PRICING.map((plan) => (
            <PricingCard key={plan.slug} plan={plan} />
          ))}
        </div>
        <p className="mt-8 text-[0.8125rem] text-[var(--l-ink-faint)]">
          El límite de sucursales se aplica al configurar la empresa y no cambia lo que ya operas.
          La facturación se acuerda con el equipo.
        </p>
      </Section>

      {/* FAQ */}
      <Section id="faq" className="border-t border-[var(--l-line)]">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <SectionIntro
            title="Preguntas antes de empezar."
            lead="Lo que suele preguntar un grupo antes de abrir la primera sucursal."
          />
          <Faq />
        </div>
      </Section>

      {/* CTA final */}
      <Section tone="deep" className="border-t border-[var(--l-line)]">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-end lg:gap-16">
          <div>
            <h2 className="l-h2 max-w-[18ch]">
              Más control sobre tu operación. Más claridad sobre tus costos.
            </h2>
            <p className="l-lead mt-5 max-w-[46ch]">
              Empieza con una sucursal y configura la operación que ya tienes. El resto se conecta
              sobre el mismo registro.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
            <CallToAction href="/sign-up">Crear cuenta</CallToAction>
            <Link
              href="/sign-in"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[var(--l-deep-outline)] px-5 text-sm font-medium text-[var(--l-deep-fg)] transition-colors hover:bg-[var(--l-deep-hover)]"
            >
              Iniciar sesión
            </Link>
          </div>
        </div>
        <p className="mt-10 border-t border-[var(--l-deep-line)] pt-6 text-[0.75rem] text-[var(--l-deep-fg-faint)]">
          Las cifras, sucursales y nombres de esta página son demostrativos.
        </p>
      </Section>
    </>
  )
}
