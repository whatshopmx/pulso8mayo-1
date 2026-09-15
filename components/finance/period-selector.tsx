"use client";

import { useState } from "react";
import { format, subDays, subMonths, startOfMonth, startOfWeek, endOfWeek, startOfQuarter, isValid } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type DateRange = {
  from: Date | undefined;
  to?: Date | undefined;
};

export type Preset = "this_week" | "this_month" | "last_month" | "this_quarter" | "custom";

interface PeriodSelectorProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  disabled?: boolean;
}

export function getPresetRange(preset: Preset): DateRange {
  const today = new Date();
  switch (preset) {
    case "this_week":
      return {
        from: startOfWeek(today, { weekStartsOn: 1 }),
        to: endOfWeek(today, { weekStartsOn: 1 }),
      };
    case "this_month":
      return {
        from: startOfMonth(today),
        to: today,
      };
    case "last_month":
      const lastM = subMonths(today, 1);
      return {
        from: startOfMonth(lastM),
        to: subDays(startOfMonth(today), 1),
      };
    case "this_quarter":
      return {
        from: startOfQuarter(today),
        to: today,
      };
    default:
      return { from: undefined, to: undefined };
  }
}

export function PeriodSelector({ dateRange, onDateRangeChange, disabled }: PeriodSelectorProps) {
  const [activePreset, setActivePreset] = useState<Preset>("this_month");
  const [customRange, setCustomRange] = useState<DateRange>(dateRange);
  const [isCustomOpen, setIsCustomOpen] = useState(false);

  const handlePresetClick = (preset: Preset) => {
    setActivePreset(preset);
    if (preset !== "custom") {
      onDateRangeChange(getPresetRange(preset));
    } else {
      setIsCustomOpen(true);
    }
  };

  const handleCustomApply = () => {
    setActivePreset("custom");
    onDateRangeChange(customRange);
    setIsCustomOpen(false);
  };

  const isCustomActive = activePreset === "custom";

  // Desktop Pill Group
  const desktopView = (
    <div className="hidden sm:flex items-center gap-1 bg-muted/50 p-1 rounded-lg border border-border">
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        className={cn(
          "h-7 px-3 text-xs font-medium rounded-md",
          activePreset === "this_week" ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => handlePresetClick("this_week")}
      >
        Esta semana
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        className={cn(
          "h-7 px-3 text-xs font-medium rounded-md",
          activePreset === "this_month" ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => handlePresetClick("this_month")}
      >
        Este mes
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        className={cn(
          "h-7 px-3 text-xs font-medium rounded-md",
          activePreset === "last_month" ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => handlePresetClick("last_month")}
      >
        Mes anterior
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            className={cn(
              "h-7 px-3 text-xs font-medium rounded-md",
              isCustomActive || activePreset === "this_quarter" ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {isCustomActive && dateRange.from ? (
              dateRange.to ? (
                <>
                  {format(dateRange.from, "dd MMM", { locale: es })} –{" "}
                  {format(dateRange.to, "dd MMM", { locale: es })}
                </>
              ) : (
                format(dateRange.from, "dd MMM", { locale: es })
              )
            ) : activePreset === "this_quarter" ? (
              "Este trimestre"
            ) : (
              <>Más <ChevronDown className="ml-1 h-3 w-3" /></>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handlePresetClick("this_quarter")}>
            Este trimestre
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsCustomOpen(true)}>
            Personalizado...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover open={isCustomOpen} onOpenChange={setIsCustomOpen}>
        <PopoverTrigger asChild>
          <div className="hidden" />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={customRange?.from}
            selected={customRange}
            onSelect={(range) => setCustomRange(range || { from: undefined, to: undefined })}
            numberOfMonths={2}
            locale={es}
            disabled={(date) => date > new Date()}
          />
          <div className="p-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Máximo 90 días recomendados</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setIsCustomOpen(false)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={handleCustomApply} disabled={!customRange?.from}>
                Aplicar
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );

  // Mobile Select
  const mobileView = (
    <div className="sm:hidden w-full">
      <Select
        value={activePreset}
        onValueChange={(val) => handlePresetClick(val as Preset)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full h-9 text-xs">
          <SelectValue placeholder="Seleccionar período" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="this_week">Esta semana</SelectItem>
          <SelectItem value="this_month">Este mes</SelectItem>
          <SelectItem value="last_month">Mes anterior</SelectItem>
          <SelectItem value="this_quarter">Este trimestre</SelectItem>
          <SelectItem value="custom">Personalizado...</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <>
      {desktopView}
      {mobileView}
    </>
  );
}
