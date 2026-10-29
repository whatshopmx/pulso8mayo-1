"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useBranches } from "@/hooks/queries/use-branches";
import { useTranslations } from "next-intl";

export interface EmployeeFiltersState {
  department: string;
  branch: string;
  status: string;
}

interface EmployeeFiltersProps {
  filters: EmployeeFiltersState;
  onFilterChange: (filters: EmployeeFiltersState) => void;
}

const departments = [
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

const statuses = [
  "ONBOARDING",
  "ACTIVE",
  "ON_LEAVE",
  "SUSPENDED",
  "TERMINATED",
  "RESIGNED",
];

export function EmployeeFilters({ filters, onFilterChange }: EmployeeFiltersProps) {
  const t = useTranslations("labor.employees.filters");
  const { data: branches = [] } = useBranches();

  const handleDepartmentChange = (value: string) => {
    onFilterChange({ ...filters, department: value === "all" ? "" : value });
  };

  const handleStatusChange = (value: string) => {
    onFilterChange({ ...filters, status: value === "all" ? "" : value });
  };

  const handleBranchChange = (value: string) => {
    onFilterChange({ ...filters, branch: value === "all" ? "" : value });
  };

  return (
    <div className="flex gap-4 flex-wrap">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">{t("department")}</Label>
        <Select value={filters.department || "all"} onValueChange={handleDepartmentChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t("allDepartments")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allDepartments")}</SelectItem>
            {departments.map((dept) => (
              <SelectItem key={dept} value={dept}>
                {t(`departments.${dept}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">{t("status")}</Label>
        <Select value={filters.status || "all"} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t("allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allStatuses")}</SelectItem>
            {statuses.map((status) => (
              <SelectItem key={status} value={status}>
                {t(`statuses.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">{t("branch")}</Label>
        <Select value={filters.branch || "all"} onValueChange={handleBranchChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t("allBranches")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allBranches")}</SelectItem>
            {branches.map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
