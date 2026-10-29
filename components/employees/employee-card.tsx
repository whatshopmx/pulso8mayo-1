"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Employee } from "./employee-directory";
import { Mail, MapPin, MoreVertical, Phone, Eye, Edit, MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";

interface EmployeeCardProps {
  employee: Employee;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onViewDocuments?: (id: string) => void;
  canEdit?: boolean;
}

const getStatusColor = (status: string | null) => {
  switch (status) {
    case "ACTIVE":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
    case "ONBOARDING":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
    case "ON_LEAVE":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
    case "SUSPENDED":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
    case "TERMINATED":
    case "RESIGNED":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
  }
};

const getInitials = (name: string | null) => {
  if (!name) return "EP";
  const parts = name.split(" ");
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
};

export function EmployeeCard({ employee, onView, onEdit }: EmployeeCardProps) {
  const t = useTranslations("labor.employees.card");
  const tFilters = useTranslations("labor.employees.filters");
  const status = employee.employeeStatus;
  const statusLabel = status
    ? tFilters.has(`statuses.${status}`)
      ? tFilters(`statuses.${status}`)
      : status.replace("_", " ")
    : t("unknownStatus");

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarImage src={employee.profilePhotoUrl || undefined} alt={employee.userName || ""} />
              <AvatarFallback className="text-sm">{getInitials(employee.userName)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm truncate">{employee.userName}</h3>
              <p className="text-xs text-muted-foreground truncate">{employee.userEmail}</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onView(employee.id)}>
                <Eye className="mr-2 h-4 w-4" />
                {t("viewProfile")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(employee.id)}>
                <Edit className="mr-2 h-4 w-4" />
                {t("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <MessageSquare className="mr-2 h-4 w-4" />
                {t("sendMessage")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Status & Position */}
        <div className="flex items-center justify-between">
          <Badge className={getStatusColor(employee.employeeStatus)} variant="secondary">
            {statusLabel}
          </Badge>
          {employee.employeeNumber && (
            <span className="text-xs text-muted-foreground">#{employee.employeeNumber}</span>
          )}
        </div>

        {/* Professional Info */}
        {employee.position && (
          <p className="text-sm">{employee.position}</p>
        )}
        {employee.department && (
          <p className="text-xs text-muted-foreground">{employee.department}</p>
        )}

        {/* Contact Info */}
        <div className="space-y-1.5 pt-2 border-t">
          {employee.personalEmail && (
            <div className="flex items-center gap-2 text-xs">
              <Mail className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{employee.personalEmail}</span>
            </div>
          )}
          {employee.personalPhone && (
            <div className="flex items-center gap-2 text-xs">
              <Phone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span>{employee.personalPhone}</span>
            </div>
          )}
          {(employee.city || employee.state) && (
            <div className="flex items-center gap-2 text-xs">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="truncate">
                {employee.city}{employee.city && employee.state ? ", " : ""}{employee.state}
              </span>
            </div>
          )}
        </div>

        {/* Hire Date */}
        {employee.hireDate && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              {t("hireDate", { date: new Date(employee.hireDate).toLocaleDateString("es-MX") })}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            onClick={() => onView(employee.id)}
          >
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            {t("view")}
          </Button>
          <Button
            variant="default"
            size="sm"
            className="flex-1 text-xs"
            onClick={() => onEdit(employee.id)}
          >
            <Edit className="mr-1.5 h-3.5 w-3.5" />
            {t("edit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
