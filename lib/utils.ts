import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Formatea un monto expresado en **pesos**. Para centavos, usa `formatCents`. */
export function formatCurrency(value: number, currency = 'MXN'): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
  }).format(value);
}

/**
 * Formatea un monto expresado en **centavos** (la unidad en que el esquema
 * guarda todo el dinero). Reemplaza las copias locales de `formatMXN`.
 */
export function formatCents(cents: number, currency = 'MXN'): string {
  return formatCurrency(cents / 100, currency);
}

/**
 * Formatea una cantidad fraccionaria devuelta por la DB (numeric llega como
 * string): quita ceros redundantes — `"2.5000"` → `"2.5"`, `"10.0000"` → `"10"`,
 * `"-0.4000"` → `"-0.4"`. Nunca devuelve `"5.0000"`.
 */
export function formatQty(n: number | string | null | undefined): string {
  const num = typeof n === "string" ? parseFloat(n) : typeof n === "number" ? n : NaN;
  if (Number.isNaN(num)) return "0";
  return String(parseFloat(num.toFixed(4)));
}

/**
 * Helper que produce clases de badge compuestas para estados semánticos.
 * Usa las variantes nativas de Badge (outline) + tonalidades de diseño.
 *
 * Colores soportados: success | warning | destructive | info | neutral
 */
export function statusBadgeClasses(
  status: "success" | "warning" | "destructive" | "info" | "neutral"
): string {
  const map: Record<string, string> = {
    success: "bg-success/10 text-success border-success/20",
    // `text-warning-text`, no `text-warning`: el ámbar de relleno sobre un tinte
    // al 10% no alcanza AA. Ver `--warning-text` en globals.css.
    warning: "bg-warning/10 text-warning-text border-warning/25",
    destructive: "bg-destructive/10 text-destructive border-destructive/20",
    info: "bg-info/10 text-info border-info/20",
    neutral: "bg-muted text-muted-foreground border-muted",
  };
  return map[status] ?? map.neutral;
}

export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T; label: string }[],
  filename: string
): void {
  const header = columns.map((c) => `"${c.label}"`).join(",")
  const rows = data.map((row) =>
    columns.map((c) => `"${String(row[c.key] ?? "").replace(/"/g, '""')}"`).join(",")
  )
  const csv = [header, ...rows].join("\n")
  const bom = "\uFEFF"
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${filename}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
