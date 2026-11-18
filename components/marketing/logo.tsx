import Image from "next/image"

/**
 * Lockup provisional de marca (Fase 1).
 *
 * No existe todavía un SVG oficial. Se compone el icono PWA existente con el
 * wordmark en Geist para no inventar un símbolo nuevo. Cuando el logo oficial
 * llegue, solo cambia este archivo.
 */
export function Logo({ showSuffix = true }: { showSuffix?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Image
        src="/icon-192.png"
        alt=""
        width={28}
        height={28}
        className="size-7 rounded-[7px]"
        priority
      />
      <span className="text-[1.0625rem] font-semibold tracking-[-0.025em] text-[var(--l-ink)]">
        Pulso
      </span>
      {showSuffix ? (
        <span className="hidden text-[0.75rem] font-medium uppercase tracking-[0.14em] text-[var(--l-ink-faint)] sm:inline">
          HORECA
        </span>
      ) : null}
    </span>
  )
}
