import type { Metadata } from "next"
import type { ReactNode } from "react"
import { SiteHeader } from "@/components/marketing/site-header"
import { SiteFooter } from "@/components/marketing/site-footer"

const TITLE = "Pulso HORECA — Operación y finanzas conectadas"
const DESCRIPTION =
  "Pulso conecta la ejecución diaria de tus sucursales con el gasto, el presupuesto y el resultado. Workflows, evidencia, compras, personal y control financiero para cadenas HORECA en México."
const OG_IMAGE = {
  url: "/icon-512.png",
  width: 512,
  height: 512,
  alt: "Pulso HORECA",
}

/**
 * Base absoluta para canonical y Open Graph. Sin esto Next emite URLs
 * relativas y WhatsApp no arma la tarjeta, que es el canal por el que se
 * comparte esta página. Cae al host público configurado y, en último caso, a
 * localhost para no romper el build sin variables.
 */
function resolveBaseUrl(): URL {
  const candidate =
    process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000"
  try {
    return new URL(candidate)
  } catch {
    return new URL("http://localhost:3000")
  }
}

export const metadata: Metadata = {
  metadataBase: resolveBaseUrl(),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Pulso HORECA",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "es_MX",
    siteName: "Pulso HORECA",
    url: "/",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE.url],
  },
  robots: {
    index: true,
    follow: true,
  },
}

/** Datos estructurados mínimos: nombre y propósito, sin precios ni ratings. */
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Pulso HORECA",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  inLanguage: "es-MX",
  description: DESCRIPTION,
  featureList: [
    "Workflows operativos con evidencia",
    "Cumplimiento NOM-251 y NOM-035 documentado",
    "Inventario, compras y proveedores",
    "Gastos, presupuesto y cuentas por pagar",
    "Asistencia, turnos y costo laboral",
    "Ejecución de tareas por WhatsApp",
  ],
}

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="landing-scope min-h-dvh">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--l-ink)]"
      >
        Saltar al contenido
      </a>
      <SiteHeader />
      <main id="contenido">{children}</main>
      <SiteFooter />
    </div>
  )
}
