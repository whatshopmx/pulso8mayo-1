"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { es } from "date-fns/locale";

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

interface PresetOption {
  label: string;
  days: number;
}

const DEFAULT_PRESETS: PresetOption[] = [
  { label: "7 días", days: 7 },
  { label: "30 días", days: 30 },
  { label: "90 días", days: 90 },
];

interface DateRangePickerProps {
  value?: DateRange;
  onChange?: (range: DateRange) => void;
  presets?: PresetOption[];
  align?: "start" | "center" | "end";
}

export function DateRangePicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  align = "start",
}: DateRangePickerProps) {
  const [startDate, setStartDate] = useState<Date>(
    value?.startDate || subDays(new Date(), 30)
  );
  const [endDate, setEndDate] = useState<Date>(
    value?.endDate || new Date()
  );
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (value) {
      setStartDate(value.startDate);
      setEndDate(value.endDate);
    }
  }, [value]);

  const applyPreset = useCallback(
    (days: number) => {
      const start = startOfDay(subDays(new Date(), days));
      const end = endOfDay(new Date());
      setStartDate(start);
      setEndDate(end);
      onChange?.({ startDate: start, endDate: end });
      setIsOpen(false);
    },
    [onChange]
  );

  const handleApply = useCallback(() => {
    onChange?.({ startDate, endDate });
    setIsOpen(false);
  }, [startDate, endDate, onChange]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-[240px] justify-start text-left font-normal"
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          <span>
            {format(startDate, "dd MMM", { locale: es })} -{" "}
            {format(endDate, "dd MMM", { locale: es })}
          </span>
          <ChevronDown className="ml-auto h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <div className="p-3 border-b">
          <div className="flex gap-1">
            {presets.map((preset) => (
              <Button
                key={preset.days}
                variant="outline"
                size="sm"
                onClick={() => applyPreset(preset.days)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex gap-3 p-3">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 text-center">
              Desde
            </div>
            <Calendar
              mode="single"
              selected={startDate}
              onSelect={(date) => date && setStartDate(date)}
              locale={es}
              className="rounded-md border"
            />
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 text-center">
              Hasta
            </div>
            <Calendar
              mode="single"
              selected={endDate}
              onSelect={(date) => date && setEndDate(date)}
              locale={es}
              className="rounded-md border"
            />
          </div>
        </div>
        <div className="flex justify-end p-3 border-t">
          <Button size="sm" onClick={handleApply}>
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
