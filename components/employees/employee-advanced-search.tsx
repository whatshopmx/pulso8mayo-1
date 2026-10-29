"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Search, Filter, X, Calendar as CalendarIcon, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export interface AdvancedSearchFilters {
  search: string;
  department: string;
  branch: string;
  status: string;
  hireDateFrom: Date | undefined;
  hireDateTo: Date | undefined;
  position: string;
}

interface EmployeeAdvancedSearchProps {
  filters: AdvancedSearchFilters;
  onFiltersChange: (filters: AdvancedSearchFilters) => void;
  onClearFilters: () => void;
  departments?: string[];
  branches?: string[];
  statuses?: { value: string; label: string }[];
}

const defaultStatuses = [
  "ONBOARDING",
  "ACTIVE",
  "ON_LEAVE",
  "SUSPENDED",
  "TERMINATED",
  "RESIGNED",
];

const defaultDepartments = [
  "KITCHEN",
  "SERVICE",
  "HOUSEKEEPING",
  "RECEPTION",
  "ADMINISTRATION",
  "MAINTENANCE",
  "SALES",
  "ACCOUNTING",
  "HUMAN_RESOURCES",
  "MANAGEMENT",
  "SECURITY",
  "OTHER",
];

export function EmployeeAdvancedSearch({
  filters,
  onFiltersChange,
  onClearFilters,
  departments = defaultDepartments,
  branches = [],
  statuses,
}: EmployeeAdvancedSearchProps) {
  const t = useTranslations("labor.employees.advancedSearch");
  const tFilters = useTranslations("labor.employees.filters");
  const [isOpen, setIsOpen] = useState(false);

  const statusOptions = statuses ?? defaultStatuses.map((value) => ({
    value,
    label: tFilters(`statuses.${value}`),
  }));

  const hasActiveFilters =
    filters.department ||
    filters.branch ||
    filters.status ||
    filters.hireDateFrom ||
    filters.hireDateTo ||
    filters.position;

  const activeFilterCount = [
    filters.department,
    filters.branch,
    filters.status,
    filters.hireDateFrom || filters.hireDateTo,
    filters.position,
  ].filter(Boolean).length;

  const handleSearchChange = (value: string) => {
    onFiltersChange({ ...filters, search: value });
  };

  const handleFilterChange = (key: keyof AdvancedSearchFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={filters.search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              {t("filters")}
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96" align="end">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">{t("filters")}</h4>
                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={onClearFilters}>
                    <X className="mr-1 h-3 w-3" />
                    {t("clearAll")}
                  </Button>
                )}
              </div>

              {/* Department Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("department")}</label>
                <Select
                  value={filters.department || "all"}
                  onValueChange={(value) =>
                    handleFilterChange("department", value === "all" ? "" : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={tFilters("allDepartments")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tFilters("allDepartments")}</SelectItem>
                    {departments.map((dept) => (
                      <SelectItem key={dept} value={dept}>
                        {tFilters(`departments.${dept}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Status Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("status")}</label>
                <Select
                  value={filters.status || "all"}
                  onValueChange={(value) =>
                    handleFilterChange("status", value === "all" ? "" : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={tFilters("allStatuses")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tFilters("allStatuses")}</SelectItem>
                    {statusOptions.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Branch Filter */}
              {branches.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("branch")}</label>
                  <Select
                    value={filters.branch || "all"}
                    onValueChange={(value) =>
                      handleFilterChange("branch", value === "all" ? "" : value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={tFilters("allBranches")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{tFilters("allBranches")}</SelectItem>
                      {branches.map((branch) => (
                        <SelectItem key={branch} value={branch}>
                          {branch}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Position Filter */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("position")}</label>
                <Input
                  placeholder={t("positionPlaceholder")}
                  value={filters.position}
                  onChange={(e) => handleFilterChange("position", e.target.value)}
                />
              </div>

              {/* Hire Date Range */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("hireDateRange")}</label>
                <div className="grid grid-cols-2 gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "justify-start text-left font-normal",
                          !filters.hireDateFrom && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {filters.hireDateFrom ? (
                          format(filters.hireDateFrom, "PP", { locale: es })
                        ) : (
                          <span>{t("from")}</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={filters.hireDateFrom}
                        onSelect={(date) => handleFilterChange("hireDateFrom", date)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "justify-start text-left font-normal",
                          !filters.hireDateTo && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {filters.hireDateTo ? (
                          format(filters.hireDateTo, "PP", { locale: es })
                        ) : (
                          <span>{t("to")}</span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={filters.hireDateTo}
                        onSelect={(date) => handleFilterChange("hireDateTo", date)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <Button className="w-full" onClick={() => setIsOpen(false)}>
                {t("applyFilters")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Active Filter Badges */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2">
          {filters.department && (
            <Badge variant="secondary" className="gap-1">
              {t("badges.department", { value: tFilters(`departments.${filters.department}`) })}
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => handleFilterChange("department", "")}
              />
            </Badge>
          )}
          {filters.status && (
            <Badge variant="secondary" className="gap-1">
              {t("badges.status", {
                value:
                  statusOptions.find((s) => s.value === filters.status)?.label ?? filters.status,
              })}
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => handleFilterChange("status", "")}
              />
            </Badge>
          )}
          {filters.branch && (
            <Badge variant="secondary" className="gap-1">
              {t("badges.branch", { value: filters.branch })}
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => handleFilterChange("branch", "")}
              />
            </Badge>
          )}
          {filters.position && (
            <Badge variant="secondary" className="gap-1">
              {t("badges.position", { value: filters.position })}
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => handleFilterChange("position", "")}
              />
            </Badge>
          )}
          {(filters.hireDateFrom || filters.hireDateTo) && (
            <Badge variant="secondary" className="gap-1">
              {t("badges.hireDate", {
                from: filters.hireDateFrom
                  ? format(filters.hireDateFrom, "MMM d", { locale: es })
                  : t("any"),
                to: filters.hireDateTo
                  ? format(filters.hireDateTo, "MMM d", { locale: es })
                  : t("any"),
              })}
              <X
                className="h-3 w-3 cursor-pointer"
                onClick={() => {
                  handleFilterChange("hireDateFrom", undefined);
                  handleFilterChange("hireDateTo", undefined);
                }}
              />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
