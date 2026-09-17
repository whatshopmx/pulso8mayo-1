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

const departmentLabels: Record<string, string> = {
  KITCHEN: "Kitchen",
  SERVICE: "Service",
  HOUSEKEEPING: "Housekeeping",
  RECEPTION: "Reception",
  ADMINISTRATION: "Administration",
  MAINTENANCE: "Maintenance",
  SALES: "Sales",
  ACCOUNTING: "Accounting",
  HUMAN_RESOURCES: "Human Resources",
  MANAGEMENT: "Management",
  SECURITY: "Security",
  OTHER: "Other",
};

const statuses = [
  { value: "ONBOARDING", label: "Onboarding" },
  { value: "ACTIVE", label: "Active" },
  { value: "ON_LEAVE", label: "On Leave" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "TERMINATED", label: "Terminated" },
  { value: "RESIGNED", label: "Resigned" },
];

export function EmployeeFilters({ filters, onFilterChange }: EmployeeFiltersProps) {
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
        <Label className="text-xs text-muted-foreground">Department</Label>
        <Select value={filters.department || "all"} onValueChange={handleDepartmentChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map((dept) => (
              <SelectItem key={dept} value={dept}>
                {departmentLabels[dept] || dept}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Status</Label>
        <Select value={filters.status || "all"} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {statuses.map((status) => (
              <SelectItem key={status.value} value={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Branch</Label>
        <Select value={filters.branch || "all"} onValueChange={handleBranchChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Branches" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Branches</SelectItem>
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
