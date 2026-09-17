"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  Wrench,
  Shield,
  Bell,
  Eye,
  Check
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/hooks/use-tenant";

interface EquipmentAlert {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  description?: string;
  dueDate?: string;
  status: string;
  equipment?: {
    name: string;
    equipmentCode: string;
  };
  service?: {
    serviceName: string;
  };
}

const alertTypeLabels: Record<string, string> = {
  MAINTENANCE_DUE: "Mantenimiento Pendiente",
  WARRANTY_EXPIRING: "Garantía por Vencer",
  SERVICE_DUE: "Servicio Programado",
  EQUIPMENT_FAILURE: "Falla de Equipo",
};

const severityConfig: Record<string, { color: string; icon: React.ReactNode }> = {
  LOW: { 
    color: "bg-blue-100 text-blue-800", 
    icon: <Bell className="w-4 h-4" /> 
  },
  MEDIUM: { 
    color: "bg-yellow-100 text-yellow-800", 
    icon: <Clock className="w-4 h-4" /> 
  },
  HIGH: { 
    color: "bg-orange-100 text-orange-800", 
    icon: <AlertTriangle className="w-4 h-4" /> 
  },
  CRITICAL: { 
    color: "bg-red-100 text-red-800", 
    icon: <AlertTriangle className="w-4 h-4" /> 
  },
};

export function EquipmentAlerts({ branchId: propBranchId }: { branchId?: string | null } = {}) {
  const { toast } = useToast();
  const { tenant } = useTenant();
  const branchId = propBranchId !== undefined ? propBranchId : tenant?.branchId;
  const [alerts, setAlerts] = useState<EquipmentAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchAlerts();
  }, [branchId]);

  const fetchAlerts = async () => {
    try {
      setIsLoading(true);
      // This would call a real endpoint in production
      // For now, we'll simulate with empty data
      setAlerts([]);
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudieron cargar las alertas",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAcknowledge = async (alertId: string) => {
    try {
      // Would call API to acknowledge
      toast({
        title: "Éxito",
        description: "Alerta reconocida",
      });
      fetchAlerts();
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo reconocer la alerta",
        variant: "destructive",
      });
    }
  };

  const handleResolve = async (alertId: string) => {
    try {
      // Would call API to resolve
      toast({
        title: "Éxito",
        description: "Alerta resuelta",
      });
      fetchAlerts();
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo resolver la alerta",
        variant: "destructive",
      });
    }
  };

  const activeAlerts = alerts.filter(a => a.status === 'ACTIVE');
  const acknowledgedAlerts = alerts.filter(a => a.status === 'ACKNOWLEDGED');

  const groupedAlerts = {
    maintenance: activeAlerts.filter(a => a.alertType === 'MAINTENANCE_DUE'),
    warranty: activeAlerts.filter(a => a.alertType === 'WARRANTY_EXPIRING'),
    service: activeAlerts.filter(a => a.alertType === 'SERVICE_DUE'),
    failure: activeAlerts.filter(a => a.alertType === 'EQUIPMENT_FAILURE'),
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Alertas y Notificaciones</h2>
        <p className="text-muted-foreground">
          Gestiona alertas de mantenimiento, garantías y servicios
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Mantenimientos</p>
                <p className="text-2xl font-bold">{groupedAlerts.maintenance.length}</p>
              </div>
              <Wrench className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-purple-50 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Garantías</p>
                <p className="text-2xl font-bold">{groupedAlerts.warranty.length}</p>
              </div>
              <Shield className="w-8 h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Servicios</p>
                <p className="text-2xl font-bold">{groupedAlerts.service.length}</p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Fallos</p>
                <p className="text-2xl font-bold">{groupedAlerts.failure.length}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Alerts Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Alertas Activas
          </CardTitle>
          <CardDescription>
            Alertas que requieren atención
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : activeAlerts.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium">No hay alertas activas</h3>
              <p className="text-muted-foreground">
                Todo está en orden. No hay alertas pendientes.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Severidad</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Equipo/Servicio</TableHead>
                  <TableHead>Fecha Límite</TableHead>
                  <TableHead className="w-[150px]">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeAlerts.map((alert) => {
                  const severity = severityConfig[alert.severity] || severityConfig.MEDIUM;
                  const alertLabel = alertTypeLabels[alert.alertType] || alert.alertType;
                  
                  return (
                    <TableRow key={alert.id}>
                      <TableCell>
                        <Badge variant="outline">
                          {alertLabel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={severity.color}>
                          <span className="flex items-center gap-1">
                            {severity.icon}
                            {alert.severity}
                          </span>
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{alert.title}</TableCell>
                      <TableCell>
                        {alert.equipment?.name || alert.service?.serviceName || "-"}
                      </TableCell>
                      <TableCell>
                        {alert.dueDate 
                          ? new Date(alert.dueDate).toLocaleDateString()
                          : "-"
                        }
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAcknowledge(alert.id)}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            Ver
                          </Button>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleResolve(alert.id)}
                          >
                            <Check className="w-4 h-4 mr-1" />
                            Resolver
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
