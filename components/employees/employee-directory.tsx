"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EmployeeTable } from "./employee-table";
import { EmployeeFilters, EmployeeFiltersState } from "./employee-filters";
import { EmployeeExportDialog } from "./employee-export-dialog";
import { EmployeeDialog } from "./employee-dialog";
import { EmployeeBulkActions } from "./employee-bulk-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, X, LayoutGrid, List } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { toast } from "sonner";
import { EmployeeCard } from "./employee-card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface Employee {
  id: string;
  userId: string;
  employeeNumber: string | null;
  position: string | null;
  department: string | null;
  employeeStatus: string | null;
  isActive: boolean | null;
  hireDate: Date | null;
  city: string | null;
  state: string | null;
  personalEmail: string | null;
  personalPhone: string | null;
  profilePhotoUrl: string | null;
  userName: string | null;
  userEmail: string | null;
  userRole: string | null;
}

export default function EmployeeDirectory() {
  const { session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState(searchParams?.get("search") || "");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showEmployeeDialog, setShowEmployeeDialog] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | undefined>(undefined);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [filters, setFilters] = useState<EmployeeFiltersState>({
    department: "",
    branch: "",
    status: "",
  });

  const companyId = session?.user?.companyId;
  const userRole = session?.user?.role;
  const canManageEmployees = userRole === "SUPER_ADMIN" || userRole === "ADMIN" || userRole === "GERENTE";

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch employees
  const fetchEmployees = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        companyId,
        page: page.toString(),
        limit: limit.toString(),
      });

      if (debouncedSearch) params.set("search", debouncedSearch);
      if (filters.department) params.set("department", filters.department);
      if (filters.status) params.set("status", filters.status);

      const response = await fetch(`/api/employees?${params}`);
      if (response.ok) {
        const data = await response.json();
        setEmployees(data.data || []);
        setTotal(data.pagination?.total || 0);
      } else {
        toast.error("Error fetching employees");
      }
    } catch (error) {
      console.error("Error fetching employees:", error);
      toast.error("Error fetching employees");
    } finally {
      setLoading(false);
    }
  }, [companyId, page, limit, debouncedSearch, filters]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
  };

  const handleClearFilters = () => {
    setSearch("");
    setFilters({ department: "", branch: "", status: "" });
    setPage(1);
  };

  const handleAddEmployee = () => {
    setSelectedEmployee(undefined);
    setShowEmployeeDialog(true);
  };

  const handleEditEmployee = (employeeId: string) => {
    const employee = employees.find((e) => e.id === employeeId);
    if (employee) {
      setSelectedEmployee(employee);
      setShowEmployeeDialog(true);
    }
  };

  const handleViewEmployee = (employeeId: string) => {
    router.push(`/dashboard/employees/${employeeId}`);
  };

  const handleViewDocuments = (employeeId: string) => {
    router.push(`/dashboard/employees/${employeeId}?tab=documents`);
  };

  const handleSelectEmployee = (employeeId: string, selected: boolean) => {
    if (selected) {
      setSelectedEmployees((prev) => [...prev, employeeId]);
    } else {
      setSelectedEmployees((prev) => prev.filter((id) => id !== employeeId));
    }
  };

  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      setSelectedEmployees(employees.map((e) => e.id));
    } else {
      setSelectedEmployees([]);
    }
  };

  const handleClearSelection = () => {
    setSelectedEmployees([]);
  };

  const handleBulkAction = async (action: string, employeeIds: string[]) => {
    // Implement bulk actions here
    console.log(`Bulk action ${action} for employees:`, employeeIds);
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Employee Directory</h1>
          <p className="text-muted-foreground">
            Manage your team members, view profiles, and update employment information.
          </p>
        </div>
        <div className="flex gap-2">
          {session?.user && (
            <Button variant="outline" onClick={() => setShowExportDialog(true)}>
              Export
            </Button>
          )}
          {canManageEmployees && (
            <Button onClick={handleAddEmployee}>
              <Plus className="mr-2 h-4 w-4" />
              Add Employee
            </Button>
          )}
        </div>
      </div>

      {/* Search & Filters */}
      <div className="space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, employee number, or position..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as "list" | "grid")}>
            <ToggleGroupItem value="list" aria-label="List view">
              <List className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="grid" aria-label="Grid view">
              <LayoutGrid className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
          {(search || filters.department || filters.status) && (
            <Button variant="ghost" onClick={handleClearFilters}>
              <X className="mr-2 h-4 w-4" />
              Clear Filters
            </Button>
          )}
        </div>

        <EmployeeFilters filters={filters} onFilterChange={setFilters} />
      </div>

      {/* Bulk Actions */}
      <EmployeeBulkActions
        selectedEmployees={selectedEmployees}
        onClearSelection={handleClearSelection}
        onBulkAction={handleBulkAction}
      />

      {/* Employee List/Grid */}
      {viewMode === "list" ? (
        <EmployeeTable
          employees={employees}
          loading={loading}
          onViewEmployee={handleViewEmployee}
          onEditEmployee={handleEditEmployee}
          onViewDocuments={handleViewDocuments}
          canEdit={canManageEmployees}
          selectedEmployees={selectedEmployees}
          onSelectEmployee={handleSelectEmployee}
          onSelectAll={handleSelectAll}
          onAddEmployee={handleAddEmployee}
          onClearFilters={handleClearFilters}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {employees.map((employee) => (
            <EmployeeCard
              key={employee.id}
              employee={employee}
              onView={handleViewEmployee}
              onEdit={handleEditEmployee}
              onViewDocuments={handleViewDocuments}
              canEdit={canManageEmployees}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {(page - 1) * limit + 1} to{" "}
          {Math.min(page * limit, total)} of {total} employees
        </p>
        <div className="flex items-center gap-2">
          <select
            value={limit}
            onChange={(e) => handleLimitChange(Number(e.target.value))}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value={10}>10 per page</option>
            <option value={20}>20 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => handlePageChange(page - 1)}
          >
            Previous
          </Button>
          <span className="text-sm">
            Page {page} of {totalPages || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => handlePageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Export Dialog */}
      {showExportDialog && (
        <EmployeeExportDialog
          employees={employees}
          total={total}
          onClose={() => setShowExportDialog(false)}
        />
      )}

      {/* Employee Dialog (Add/Edit) */}
      {companyId && (
        <EmployeeDialog
          open={showEmployeeDialog}
          onOpenChange={setShowEmployeeDialog}
          onSuccess={fetchEmployees}
          companyId={companyId}
          employee={selectedEmployee}
        />
      )}
    </div>
  );
}
