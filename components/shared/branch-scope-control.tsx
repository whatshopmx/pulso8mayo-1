"use client"

import { useCallback, useState } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { Calendar, Building2, ChevronDown, Check } from "lucide-react"
import { format, subDays, startOfMonth, startOfDay, endOfDay } from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useBranch } from "@/lib/branch-context"

type DateRangeKey = "all" | "today" | "yesterday" | "last7" | "thisMonth" | "custom"

function getDateRangeConfig(key: DateRangeKey) {
  const now = new Date()
  switch (key) {
    case "all":
      return { startDate: "", endDate: "", label: "Todo el período" }
    case "today":
      return { startDate: format(startOfDay(now), "yyyy-MM-dd"), endDate: format(endOfDay(now), "yyyy-MM-dd"), label: "Hoy" }
    case "yesterday":
      return { startDate: format(startOfDay(subDays(now, 1)), "yyyy-MM-dd"), endDate: format(endOfDay(subDays(now, 1)), "yyyy-MM-dd"), label: "Ayer" }
    case "last7":
      return { startDate: format(startOfDay(subDays(now, 7)), "yyyy-MM-dd"), endDate: format(endOfDay(now), "yyyy-MM-dd"), label: "Últimos 7 días" }
    case "thisMonth":
      return { startDate: format(startOfMonth(now), "yyyy-MM-dd"), endDate: format(endOfDay(now), "yyyy-MM-dd"), label: "Este mes" }
    case "custom":
      return { startDate: "", endDate: "", label: "Rango personalizado" }
  }
}

function inferDateRangeKey(startDate: string | null): DateRangeKey {
  // Sin `startDate` en la URL no hay filtro aplicado. Devolver "today" hacía que
  // el control anunciara "Hoy" mientras las páginas mostraban todo el histórico.
  if (!startDate) return "all"
  const now = new Date()
  const today = format(startOfDay(now), "yyyy-MM-dd")
  const yesterday = format(startOfDay(subDays(now, 1)), "yyyy-MM-dd")
  const last7 = format(startOfDay(subDays(now, 7)), "yyyy-MM-dd")
  const thisMonth = format(startOfMonth(now), "yyyy-MM-dd")
  if (startDate === today) return "today"
  if (startDate === yesterday) return "yesterday"
  if (startDate === last7) return "last7"
  if (startDate === thisMonth) return "thisMonth"
  return "custom"
}


/**
 * El filtro de fecha, extraído para que las dos formas del control —el menú de
 * sucursal y el rótulo de un rol fijado— compartan exactamente el mismo, en vez
 * de tener dos copias que se separen con el tiempo.
 */
function FiltroDeFecha({
  activeDateKey,
  displayDate,
  onChange,
  customPopoverOpen,
  setCustomPopoverOpen,
  customStartDate,
  setCustomStartDate,
  customEndDate,
  setCustomEndDate,
  onApply,
}: {
  activeDateKey: DateRangeKey
  displayDate: string
  onChange: (key: DateRangeKey) => void
  customPopoverOpen: boolean
  setCustomPopoverOpen: (open: boolean) => void
  customStartDate: string
  setCustomStartDate: (v: string) => void
  customEndDate: string
  setCustomEndDate: (v: string) => void
  onApply: () => void
}) {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2"
            aria-label={`Fecha: ${displayDate}`}
          >
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="hidden md:inline">Fecha: {displayDate}</span>
            <span className="md:hidden">{displayDate}</span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(["all", "today", "yesterday", "last7", "thisMonth"] as DateRangeKey[]).map(key => (
            <DropdownMenuItem key={key} onClick={() => onChange(key)}>
              <div className="flex w-full items-center justify-between">
                <span>{getDateRangeConfig(key).label}</span>
                {activeDateKey === key && <Check className="h-4 w-4" />}
              </div>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onChange("custom")}>
            <div className="flex w-full items-center justify-between">
              <span>Rango personalizado...</span>
              {activeDateKey === "custom" && <Check className="h-4 w-4" />}
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Popover for custom date range */}
      <Popover open={customPopoverOpen} onOpenChange={setCustomPopoverOpen}>
        <PopoverContent align="end" className="w-80 p-4">
          <div className="space-y-4">
            <h4 className="font-semibold text-sm">Seleccionar Rango de Fechas</h4>
            <div className="grid gap-3">
              <div className="grid gap-1">
                <Label htmlFor="scope-start-date" className="text-xs">Fecha Inicial</Label>
                <Input
                  id="scope-start-date"
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="scope-end-date" className="text-xs">Fecha Final</Label>
                <Input
                  id="scope-end-date"
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setCustomPopoverOpen(false)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={onApply}>
                Aplicar
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

/**
 * BranchScopeControl — single source of scope for the dashboard.
 *
 * - Branch: cookie-backed truth via `BranchProvider.setSelectedBranchId`
 *   ("Todas" ⇒ null ⇒ chain-wide rollup). Propagates across tabs/sections.
 * - Date range: URL-encoded (`?startDate=&endDate=`) so links are shareable
 *   and per-page, ported verbatim from the retired home/dashboard filter component (T4).
 *
 * Para `GERENTE` y `SUPERVISOR` esto **no es un control**: `lib/branch-scope.ts:85`
 * ignora la sucursal que pidan y les impone la suya, así que el desplegable
 * tenía una sola opción real y ningún efecto. Se pinta como rótulo (AD-B8).
 *
 * See AD-1 in tasks/plan-grupo-restaurantero-unificado.md, y AD-B8 en
 * tasks/plan-capa-datos-cliente.md.
 */
export function BranchScopeControl() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { branches, selectedBranchId, setSelectedBranchId, isBranchScoped, userBranchId } = useBranch()

  const [customPopoverOpen, setCustomPopoverOpen] = useState(false)
  const [customStartDate, setCustomStartDate] = useState(searchParams.get("startDate") || "")
  const [customEndDate, setCustomEndDate] = useState(searchParams.get("endDate") || "")

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    }
    router.push(pathname + "?" + params.toString(), { scroll: false })
  }, [router, pathname, searchParams])

  // --- Branch (cookie) -----------------------------------------------------
  const isAll = selectedBranchId == null
  const selectedBranch = branches.find(b => b.id === selectedBranchId)
  const displayBranch = isAll ? "Todas" : (selectedBranch?.name || "Seleccionar")

  const handleBranchChange = (branchId: string | null) => {
    setSelectedBranchId(branchId) // writes/clears the cookie

    /**
     * Y se le avisa al servidor.
     *
     * El alcance vive en una cookie, y una cookie que cambia no vuelve a
     * renderizar nada por sí sola: los componentes de servidor —el Tablero,
     * Incidentes, el historial de flujos— seguían mostrando la sucursal
     * anterior hasta que el usuario recargaba a mano. Las pantallas que piden
     * por su cuenta sí reaccionaban, así que el alcance "funcionaba en unas
     * páginas y en otras no", que es la peor de las formas de fallar: parece
     * que el filtro anda y en realidad estás leyendo datos de otra sucursal.
     *
     * `components/nav-company.tsx:73` ya hacía esto tras cambiar de sucursal;
     * lo que faltaba era hacerlo también desde aquí.
     */
    router.refresh()
  }

  // --- Date range (URL) ----------------------------------------------------
  const activeDateKey = inferDateRangeKey(searchParams.get("startDate"))
  const currentStart = searchParams.get("startDate")
  const currentEnd = searchParams.get("endDate")
  const displayDate = activeDateKey === "custom" && currentStart
    ? `${currentStart} - ${currentEnd || 'Hoy'}`
    : getDateRangeConfig(activeDateKey).label

  const handleDateRangeChange = (key: DateRangeKey) => {
    if (key === "custom") {
      setCustomPopoverOpen(true)
      return
    }
    const config = getDateRangeConfig(key)
    updateParams({ startDate: config.startDate, endDate: config.endDate })
  }

  const handleApplyCustomDates = () => {
    if (customStartDate) {
      updateParams({
        startDate: customStartDate,
        endDate: customEndDate || customStartDate
      })
      setCustomPopoverOpen(false)
    }
  }

  /**
   * Un rol fijado a sucursal no elige: el servidor le impone la suya. Mostrarle
   * un menú es prometer una agencia que no tiene, y deshabilitar la opción sólo
   * invita a preguntarse qué falta para habilitarla. Un rótulo no promete nada.
   *
   * Sin sucursal asignada el alcance es `NONE` y no ve nada; decirlo aquí evita
   * que lea "Todas" mientras las pantallas le salen vacías.
   */
  if (isBranchScoped) {
    const propia = branches.find(b => b.id === userBranchId)
    const etiqueta = userBranchId
      ? `Sucursal: ${propia?.name ?? selectedBranch?.name ?? "la tuya"}`
      : "Sin sucursal asignada"
    const motivo = userBranchId
      ? "Tu usuario está asignado a esta sucursal."
      : "Tu usuario no tiene una sucursal asignada. Pídele a un administrador que te asigne una."

    return (
      <div className="flex items-center gap-2">
        <span
          className="flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground"
          title={motivo}
        >
          <Building2 className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{etiqueta}</span>
          <span className="sm:hidden">{userBranchId ? (propia?.name ?? "Tu sucursal") : "Sin sucursal"}</span>
          <span className="sr-only">{motivo}</span>
        </span>
        <FiltroDeFecha
          activeDateKey={activeDateKey}
          displayDate={displayDate}
          onChange={handleDateRangeChange}
          customPopoverOpen={customPopoverOpen}
          setCustomPopoverOpen={setCustomPopoverOpen}
          customStartDate={customStartDate}
          setCustomStartDate={setCustomStartDate}
          customEndDate={customEndDate}
          setCustomEndDate={setCustomEndDate}
          onApply={handleApplyCustomDates}
        />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2"
            aria-label={`Sucursal: ${displayBranch}`}
          >
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="hidden sm:inline">Sucursal: {displayBranch}</span>
            <span className="sm:hidden">{displayBranch}</span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[220px]">
          <DropdownMenuItem onClick={() => handleBranchChange(null)}>
            <div className="flex w-full items-center justify-between">
              <span>Todas</span>
              {isAll && <Check className="h-4 w-4" />}
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {branches.map(branch => (
            <DropdownMenuItem key={branch.id} onClick={() => handleBranchChange(branch.id)}>
              <div className="flex w-full items-center justify-between">
                <span>{branch.name}</span>
                {selectedBranchId === branch.id && <Check className="h-4 w-4" />}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <FiltroDeFecha
        activeDateKey={activeDateKey}
        displayDate={displayDate}
        onChange={handleDateRangeChange}
        customPopoverOpen={customPopoverOpen}
        setCustomPopoverOpen={setCustomPopoverOpen}
        customStartDate={customStartDate}
        setCustomStartDate={setCustomStartDate}
        customEndDate={customEndDate}
        setCustomEndDate={setCustomEndDate}
        onApply={handleApplyCustomDates}
      />
    </div>
  )
}