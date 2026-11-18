import Link from "next/link"
import { Logo } from "./logo"
import { diagnosisHref } from "./diagnosis"

const PRODUCT_LINKS = [
  { label: "Operaciones", href: "#operaciones" },
  { label: "Control financiero", href: "#finanzas" },
  { label: "Equipo y WhatsApp", href: "#whatsapp" },
  { label: "Cómo funciona", href: "#workflows" },
]

const ACCESS_LINKS = [
  { label: "Solicitar diagnóstico", href: diagnosisHref() },
  { label: "Iniciar sesión", href: "/sign-in" },
  { label: "Recuperar contraseña", href: "/forgot-password" },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--l-line)] bg-[var(--l-paper)]">
      <div className="l-container py-14 md:py-16">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="max-w-sm">
            <Logo />
            <p className="l-body mt-4">
              Operación, costo y evidencia en un solo sistema para cadenas HORECA.
            </p>
          </div>

          <nav aria-label="Producto">
            <p className="text-[0.75rem] font-medium uppercase tracking-[0.14em] text-[var(--l-ink-faint)]">
              Producto
            </p>
            <ul className="mt-4 space-y-2.5">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-[0.875rem] text-[var(--l-ink-soft)] transition-colors hover:text-[var(--l-ink)]"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Acceso">
            <p className="text-[0.75rem] font-medium uppercase tracking-[0.14em] text-[var(--l-ink-faint)]">
              Acceso
            </p>
            <ul className="mt-4 space-y-2.5">
              {ACCESS_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-[0.875rem] text-[var(--l-ink-soft)] transition-colors hover:text-[var(--l-ink)]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-[var(--l-line)] pt-6 text-[0.75rem] text-[var(--l-ink-faint)] md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} Pulso. Gestión operativa para HORECA.</p>
          <p>Las cifras y nombres de esta página son demostrativos.</p>
        </div>
      </div>
    </footer>
  )
}
