"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Menu, X } from "lucide-react"
import { Logo } from "./logo"

const NAV_LINKS = [
  { label: "El problema", href: "#problema" },
  { label: "Operaciones", href: "#operaciones" },
  { label: "Finanzas", href: "#finanzas" },
  { label: "Workflows", href: "#workflows" },
  // Si se publican precios (`PRICE_FROM_PER_BRANCH_MXN` en la landing),
  // este label vuelve a "Precios".
  { label: "Cómo se cobra", href: "#precios" },
  { label: "Preguntas", href: "#faq" },
]

export function SiteHeader() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open])

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--l-line)] bg-[var(--l-paper)]">
      <div className="l-container flex h-14 items-center justify-between gap-6 md:h-16">
        <Link
          href="/"
          className="rounded-sm"
          aria-label="Pulso HORECA, ir al inicio"
          onClick={() => setOpen(false)}
        >
          <Logo />
        </Link>

        <nav aria-label="Navegación del sitio" className="hidden lg:block">
          <ul className="flex items-center gap-6">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="text-[0.8125rem] font-medium text-[var(--l-ink-soft)] transition-colors hover:text-[var(--l-ink)]"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Link
            href="/sign-in"
            className="rounded-md px-3 py-2 text-[0.8125rem] font-medium text-[var(--l-ink)] transition-colors hover:bg-[var(--l-paper-deep)]"
          >
            Iniciar sesión
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex h-9 items-center rounded-md bg-[var(--l-signal)] px-4 text-[0.8125rem] font-medium text-white transition-colors hover:bg-[var(--l-signal-hover)]"
          >
            Crear cuenta
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-md text-[var(--l-ink)] transition-colors hover:bg-[var(--l-paper-deep)] lg:hidden"
          aria-expanded={open}
          aria-controls="menu-movil"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </button>
      </div>

      <div
        id="menu-movil"
        hidden={!open}
        className="border-t border-[var(--l-line)] bg-[var(--l-paper)] lg:hidden"
      >
        <nav aria-label="Navegación móvil" className="l-container py-4">
          <ul className="flex flex-col">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center border-b border-[var(--l-line)] text-[0.9375rem] font-medium text-[var(--l-ink)]"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-col gap-2">
            <Link
              href="/sign-up"
              onClick={() => setOpen(false)}
              className="inline-flex h-11 items-center justify-center rounded-md bg-[var(--l-signal)] px-5 text-sm font-medium text-white"
            >
              Crear cuenta
            </Link>
            <Link
              href="/sign-in"
              onClick={() => setOpen(false)}
              className="inline-flex h-11 items-center justify-center rounded-md border border-[var(--l-line-strong)] px-5 text-sm font-medium text-[var(--l-ink)]"
            >
              Iniciar sesión
            </Link>
          </div>
        </nav>
      </div>
    </header>
  )
}
