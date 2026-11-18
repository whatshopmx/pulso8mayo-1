import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { SiteHeader } from "@/components/marketing/site-header"
import { SiteFooter } from "@/components/marketing/site-footer"

export const metadata: Metadata = {
  title: "Página no encontrada — Pulso HORECA",
  robots: { index: false, follow: false },
}

/**
 * 404 del sitio. Sin este archivo Next sirve su pantalla por defecto: un
 * callejón sin salida cuando alguien llega desde un enlace viejo compartido por
 * WhatsApp. Aquí se conserva el armazón del landing y se ofrecen los dos
 * caminos reales (volver al inicio o entrar a la cuenta).
 */
export default function NotFound() {
  return (
    <div className="landing-scope min-h-dvh">
      <SiteHeader />
      <main id="contenido" className="l-section">
        <div className="l-container">
          <p className="l-kicker">Error 404</p>
          <h1 className="l-display mt-6 max-w-[20ch]">Esta página ya no existe.</h1>
          <p className="l-lead mt-6">
            El enlace que abriste no corresponde a ninguna página de Pulso. Puede ser una dirección
            vieja o un enlace incompleto.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--l-signal)] px-5 text-sm font-medium text-white transition-colors hover:bg-[var(--l-signal-hover)]"
            >
              Volver al inicio
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex h-11 items-center justify-center rounded-md border border-[var(--l-line-strong)] px-5 text-sm font-medium text-[var(--l-ink)] transition-colors hover:bg-[var(--l-paper-deep)]"
            >
              Iniciar sesión
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
