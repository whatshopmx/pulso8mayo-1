/**
 * Cortes de nómina quincenal en México — función pura de fechas.
 *
 * Extraída de `components/labor/attendance-dashboard.tsx` para que su prueba no
 * cargue un componente de React con `next/navigation`, gráficas y resumen de
 * asistencia detrás. La prueba de esta aritmética fallaba de forma
 * intermitente y **sólo en la corrida completa** —justo cuando el grafo entero
 * está cargado—, y la causa no podía estar en la suma de días, que es
 * determinista: estaba en todo lo que había que inicializar para llegar a ella.
 *
 * El componente la importa y la reexporta, así que sus importadores no cambian.
 */

import { format } from "date-fns"
import { es } from "date-fns/locale"

export type MexicanDatePreset = "hoy" | "esta-quincena" | "quincena-anterior" | "este-mes" | "personalizado"

/**
 * Calcula fechas y etiquetas de acuerdo a los cortes de nómina quincenal en México.
 * 1ª Quincena: Días 1 al 15.
 * 2ª Quincena: Días 16 al último día del mes.
 */
export function getMexicanPresetDates(preset: MexicanDatePreset, customStart?: string, customEnd?: string, referenceDate?: Date) {
    const now = referenceDate || new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const day = now.getDate()

    const pad = (n: number) => n.toString().padStart(2, "0")
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

    if (preset === "hoy") {
        const todayStr = fmt(now)
        return { startDate: todayStr, endDate: todayStr, label: `Hoy (${format(now, "dd/MMM", { locale: es })})` }
    }

    if (preset === "esta-quincena") {
        if (day <= 15) {
            const start = new Date(year, month, 1)
            const end = new Date(year, month, 15)
            return {
                startDate: fmt(start),
                endDate: fmt(end),
                label: `1ª Quincena de ${format(now, "MMMM", { locale: es })} (1-15)`
            }
        } else {
            const start = new Date(year, month, 16)
            const end = new Date(year, month + 1, 0)
            return {
                startDate: fmt(start),
                endDate: fmt(end),
                label: `2ª Quincena de ${format(now, "MMMM", { locale: es })} (16-${end.getDate()})`
            }
        }
    }

    if (preset === "quincena-anterior") {
        if (day <= 15) {
            const start = new Date(year, month - 1, 16)
            const end = new Date(year, month, 0)
            const prevMonthDate = new Date(year, month - 1, 1)
            return {
                startDate: fmt(start),
                endDate: fmt(end),
                label: `2ª Quincena de ${format(prevMonthDate, "MMMM", { locale: es })} (16-${end.getDate()})`
            }
        } else {
            const start = new Date(year, month, 1)
            const end = new Date(year, month, 15)
            return {
                startDate: fmt(start),
                endDate: fmt(end),
                label: `1ª Quincena de ${format(now, "MMMM", { locale: es })} (1-15)`
            }
        }
    }

    if (preset === "este-mes") {
        const start = new Date(year, month, 1)
        const end = new Date(year, month + 1, 0)
        return {
            startDate: fmt(start),
            endDate: fmt(end),
            label: `Mes completo de ${format(now, "MMMM yyyy", { locale: es })}`
        }
    }

    // personalizado
    return {
        startDate: customStart || fmt(new Date(year, month, 1)),
        endDate: customEnd || fmt(now),
        label: `Rango personalizado (${customStart || ""} - ${customEnd || ""})`
    }
}
