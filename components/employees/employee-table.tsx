"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, MoreHorizontal, User, Edit, MessageSquare, FileText, Plus, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Employee } from "./employee-directory";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useSession } from "@/hooks/use-session";

interface EmployeeTableProps {
  employees: Employee[];
  loading: boolean;
  onViewEmployee: (employeeId: string) => void;
  onEditEmployee: (employeeId: string) => void;
  onViewDocuments: (employeeId: string) => void;
  canEdit: boolean;
  selectedEmployees?: string[];
  onSelectEmployee?: (employeeId: string, selected: boolean) => void;
  onSelectAll?: (selected: boolean) => void;
  onAddEmployee?: () => void;
  onClearFilters?: () => void;
}

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ONBOARDING: "secondary",
  ACTIVE: "default",
  ON_LEAVE: "outline",
  SUSPENDED: "destructive",
  TERMINATED: "destructive",
  RESIGNED: "destructive",
};

const statusLabels: Record<string, string> = {
  ONBOARDING: "Onboarding",
  ACTIVE: "Active",
  ON_LEAVE: "On Leave",
  SUSPENDED: "Suspended",
  TERMINATED: "Terminated",
  RESIGNED: "Resigned",
};

export function EmployeeTable({ 
  employees, 
  loading, 
  onViewEmployee, 
  onEditEmployee, 
  onViewDocuments,
  selectedEmployees = [],
  onSelectEmployee,
  onSelectAll,
  onAddEmployee,
  onClearFilters,
}: EmployeeTableProps) {
  const { session } = useSession();
  const userRole = session?.user?.role;
  const canEdit = userRole === "SUPER_ADMIN" || userRole === "ADMIN" || userRole === "GERENTE";
  
  const allSelected = employees.length > 0 && employees.every(e => selectedEmployees.includes(e.id));

  if (loading) {
    return (
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Skeleton className="h-4 w-4" /></TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Employee #</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Hire Date</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                <TableCell className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell className="text-right"><Skeleton className="h-8 w-8 rounded-md ml-auto" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <div className="text-center py-12 border rounded-lg space-y-4">
        <User className="mx-auto h-12 w-12 text-muted-foreground" />
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">No employees found</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Try adjusting your search or filters, or add a new team member to your organization.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 pt-2">
          {onClearFilters && (
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              <X className="mr-2 h-4 w-4" />
              Clear Filters
            </Button>
          )}
          {canEdit && onAddEmployee && (
            <Button size="sm" onClick={onAddEmployee}>
              <Plus className="mr-2 h-4 w-4" />
              Add Employee
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox 
                checked={allSelected}
                onCheckedChange={(checked) => onSelectAll?.(checked as boolean)}
                aria-label="Select all employees"
              />
            </TableHead>
            <TableHead>Employee</TableHead>
            <TableHead>Employee #</TableHead>
            <TableHead>Position</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Hire Date</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {employees.map((employee) => (
            <TableRow key={employee.id}>
              <TableCell>
                <Checkbox
                  checked={selectedEmployees.includes(employee.id)}
                  onCheckedChange={(checked) => onSelectEmployee?.(employee.id, checked as boolean)}
                  aria-label={`Select ${employee.userName || 'employee'}`}
                />
              </TableCell>
              <TableCell className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src={employee.profilePhotoUrl || undefined} />
                  <AvatarFallback>
                    {employee.userName?.charAt(0) || employee.userEmail?.charAt(0) || "U"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-medium">{employee.userName || "N/A"}</div>
                  <div className="text-xs text-muted-foreground">{employee.userEmail}</div>
                </div>
              </TableCell>
              <TableCell className="font-mono text-sm">
                {employee.employeeNumber || "—"}
              </TableCell>
              <TableCell>{employee.position || "—"}</TableCell>
              <TableCell>{employee.department || "—"}</TableCell>
              <TableCell>
                {employee.employeeStatus && (
                  <Badge variant={statusColors[employee.employeeStatus] || "outline"}>
                    {statusLabels[employee.employeeStatus] || employee.employeeStatus}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {employee.hireDate
                  ? format(new Date(employee.hireDate), "MMM d, yyyy", { locale: es })
                  : "—"}
              </TableCell>
              <TableCell className="text-sm">
                {employee.personalEmail && (
                  <div className="text-xs">{employee.personalEmail}</div>
                )}
                {employee.personalPhone && (
                  <div className="text-xs text-muted-foreground">{employee.personalPhone}</div>
                )}
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                      <span className="sr-only">Open menu</span>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => onViewEmployee(employee.id)}>
                      <User className="mr-2 h-4 w-4" />
                      View Profile
                    </DropdownMenuItem>
                    {canEdit && (
                      <DropdownMenuItem onClick={() => onEditEmployee(employee.id)}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit Profile
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <MessageSquare className="mr-2 h-4 w-4" />
                      Send Message
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onViewDocuments(employee.id)}>
                      <FileText className="mr-2 h-4 w-4" />
                      View Documents
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
