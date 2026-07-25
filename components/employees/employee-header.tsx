"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Edit, MessageSquare, Download, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";

import { toast } from "sonner";

interface EmployeeHeaderProps {
  employee: {
    id: string;
    userName: string | null;
    userEmail: string | null;
    employeeNumber: string | null;
    employeeStatus: string | null;
    profilePhotoUrl: string | null;
    position: string | null;
    department: string | null;
  };
  onBack: () => void;
  onEdit?: () => void;
  onExport?: () => void;
  onMessage?: () => void;
  onSelectTab?: (tab: string) => void;
  onArchive?: () => void;
  canEdit?: boolean;
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
  ONBOARDING: "En Onboarding",
  ACTIVE: "Activo",
  ON_LEAVE: "Licencia / Permiso",
  SUSPENDED: "Suspendido",
  TERMINATED: "Baja / Finiquitado",
  RESIGNED: "Renuncia Voluntaria",
};

export function EmployeeHeader({
  employee,
  onBack,
  onEdit,
  onExport,
  onMessage,
  onSelectTab,
  onArchive,
  canEdit,
}: EmployeeHeaderProps) {
  const router = useRouter();

  const handleMessage = () => {
    if (onMessage) {
      onMessage();
    } else if (employee.userEmail) {
      window.location.href = `mailto:${employee.userEmail}`;
    } else {
      toast.info("No hay correo electrónico disponible para enviar mensaje.");
    }
  };

  const handleExport = () => {
    if (onExport) {
      onExport();
    } else {
      // Export profile JSON summary
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(employee, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `colaborador_${employee.employeeNumber || employee.id}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      toast.success("Expediente del colaborador exportado correctamente.");
    }
  };

  return (
    <div className="space-y-4">
      {/* Back button & actions */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} className="gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Volver al Directorio
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleMessage}>
            <MessageSquare className="mr-2 h-4 w-4" />
            Mensaje
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Exportar
          </Button>
          {canEdit && (
            <Button size="sm" onClick={onEdit}>
              <Edit className="mr-2 h-4 w-4" />
              Editar
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onSelectTab?.("documents")}>
                Ver Documentos
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSelectTab?.("contracts")}>
                Ver Contratos
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {canEdit && (
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => {
                    if (onArchive) {
                      onArchive();
                    } else {
                      toast.info("La función de archivar está reservada para administradores.");
                    }
                  }}
                >
                  Archivar Colaborador
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Profile header */}
      <div className="flex items-start gap-6">
        <Avatar className="h-20 w-20 border border-border/60 shadow-xs">
          <AvatarImage src={employee.profilePhotoUrl || undefined} alt={employee.userName || "Colaborador"} />
          <AvatarFallback className="text-2xl font-semibold text-muted-foreground bg-muted">
            {employee.userName?.charAt(0)?.toUpperCase() || "C"}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3 mb-1.5">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{employee.userName || "Sin Nombre"}</h1>
            {employee.employeeStatus && (
              <Badge variant={statusColors[employee.employeeStatus] || "outline"} className="text-xs font-semibold tracking-wide px-2.5 py-0.5">
                {statusLabels[employee.employeeStatus] || employee.employeeStatus}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
            {employee.position && (
              <span className="text-sm font-medium">{employee.position}</span>
            )}
            {employee.department && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-sm text-muted-foreground">{employee.department}</span>
              </>
            )}
            {employee.employeeNumber && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-sm font-mono tracking-tight tabular-nums text-muted-foreground">#{employee.employeeNumber}</span>
              </>
            )}
          </div>

          <div className="text-sm text-muted-foreground mt-1">
            {employee.userEmail}
          </div>
        </div>
      </div>

      <Separator />
    </div>
  );
}
