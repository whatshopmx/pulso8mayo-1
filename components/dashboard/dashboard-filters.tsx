"use client"

import { useState, useEffect, useCallback } from "react"
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

type DateRangeKey = "today" | "yesterday" | "last7" | "thisMonth" | "custom"

function getDateRangeConfig(key: DateRangeKey) {
  const now = new Date()
  switch (key) {
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
  if (!startDate) return "today"
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

export function DashboardFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [branches, setBranches] = useState<any[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState<string>(searchParams.get("branch") || "all")
  
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

  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const response = await fetch('/api/branches', {
          credentials: 'include',
        });
        if (response.ok) {
          const result = await response.json();
          const data = result.data || result;
          if (Array.isArray(data)) {
            setBranches(data);
          }
        }
      } catch (error) {
        console.error('Error fetching branches:', error);
      }
    };

    fetchBranches();
  }, []);

  const activeDateKey = inferDateRangeKey(searchParams.get("startDate"))
  const currentStart = searchParams.get("startDate")
  const currentEnd = searchParams.get("endDate")
  
  const displayDate = activeDateKey === "custom" && currentStart
    ? `${currentStart} - ${currentEnd || 'Hoy'}`
    : getDateRangeConfig(activeDateKey).label

  const handleBranchChange = (branchId: string) => {
    setSelectedBranchId(branchId)
    updateParams({ branch: branchId === "all" ? null : branchId })
  }

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

  const selectedBranch = branches.find(b => b.id === selectedBranchId)
  const displayBranch = selectedBranchId === "all" ? "Todas" : (selectedBranch?.name || "Seleccionar")

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span>Sucursal: {displayBranch}</span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[200px]">
          <DropdownMenuItem onClick={() => handleBranchChange("all")}>
            <div className="flex w-full items-center justify-between">
              <span>Todas</span>
              {selectedBranchId === "all" && <Check className="h-4 w-4" />}
            </div>
          </DropdownMenuItem>
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>Fecha: {displayDate}</span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(["today", "yesterday", "last7", "thisMonth"] as DateRangeKey[]).map(key => (
            <DropdownMenuItem key={key} onClick={() => handleDateRangeChange(key)}>
              <div className="flex w-full items-center justify-between">
                <span>{getDateRangeConfig(key).label}</span>
                {activeDateKey === key && <Check className="h-4 w-4" />}
              </div>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleDateRangeChange("custom")}>
            <div className="flex w-full items-center justify-between">
              <span>Rango personalizado...</span>
              {activeDateKey === "custom" && <Check className="h-4 w-4" />}
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Popover for Custom Date Picker */}
      <Popover open={customPopoverOpen} onOpenChange={setCustomPopoverOpen}>
        <PopoverContent align="end" className="w-80 p-4">
          <div className="space-y-4">
            <h4 className="font-semibold text-sm">Seleccionar Rango de Fechas</h4>
            <div className="grid gap-3">
              <div className="grid gap-1">
                <Label htmlFor="start-date" className="text-xs">Fecha Inicial</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="end-date" className="text-xs">Fecha Final</Label>
                <Input
                  id="end-date"
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
              <Button size="sm" onClick={handleApplyCustomDates}>
                Aplicar
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
