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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Plus, 
  Search, 
  Shield, 
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Clock,
  MoreHorizontal
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTenant } from "@/hooks/use-tenant";
import { complianceServiceTypes, maintenanceFrequencies } from "@/lib/equipment-constants";

interface ComplianceService {
  id: string;
  serviceType: string;
  serviceName: string;
  regulationReference?: string;
  isMandatory: boolean;
  frequency: string;
  providerName?: string;
  nextServiceDate?: string;
  lastServiceDate?: string;
  serviceAreas?: string[];
  isActive: boolean;
}

const serviceTypeLabels: Record<string, string> = Object.fromEntries(
  complianceServiceTypes.map(t => [t.value, t.label])
);

const frequencyLabels: Record<string, string> = Object.fromEntries(
  maintenanceFrequencies.map(f => [f.value, f.label])
);

export function ComplianceServicesList({ branchId: propBranchId }: { branchId?: string | null } = {}) {
  const { toast } = useToast();
  const { tenant } = useTenant();
  const branchId = propBranchId !== undefined ? propBranchId : tenant?.branchId;
  const [services, setServices] = useState<ComplianceService[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newService, setNewService] = useState({
    serviceType: "",
    serviceName: "",
    frequency: "",
    providerName: "",
    nextServiceDate: "",
  });

  useEffect(() => {
    fetchServices();
  }, [branchId]);

  const fetchServices = async () => {
    try {
      setIsLoading(true);
      const url = branchId && branchId !== "ALL"
        ? `/api/compliance-services?branchId=${branchId}`
        : `/api/compliance-services`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch services");

      const result = await response.json();
      const data = result.data || [];
      setServices(data.map((s: any) => s.service || s));
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudieron cargar los servicios de cumplimiento",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateService = async () => {
    try {
      const response = await fetch(`/api/compliance-services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newService,
          nextServiceDate: newService.nextServiceDate ? new Date(newService.nextServiceDate).toISOString() : undefined,
        }),
      });

      if (!response.ok) throw new Error("Failed to create service");

      toast({
        title: "Éxito",
        description: "Servicio creado correctamente",
      });

      setIsAddDialogOpen(false);
      setNewService({
        serviceType: "",
        serviceName: "",
        frequency: "",
        providerName: "",
        nextServiceDate: "",
      });
      fetchServices();
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo crear el servicio",
        variant: "destructive",
      });
    }
  };

  const filteredServices = services.filter((service) =>
    service.serviceName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    serviceTypeLabels[service.serviceType]?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getServiceStatus = (service: ComplianceService) => {
    if (!service.nextServiceDate) return { label: "Sin Programar", color: "bg-gray-100 text-gray-800" };
    
    const nextDate = new Date(service.nextServiceDate);
    const today = new Date();
    const diffDays = Math.ceil((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return { label: "Vencido", color: "bg-red-100 text-red-800" };
    if (diffDays <= 7) return { label: "Próximo", color: "bg-yellow-100 text-yellow-800" };
    return { label: "Programado", color: "bg-blue-100 text-blue-800" };
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Servicios de Cumplimiento</h2>
          <p className="text-muted-foreground">
            Gestión de servicios regulados y normativas
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Nuevo Servicio
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Nuevo Servicio de Cumplimiento</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Tipo de Servicio *</Label>
                <Select
                  value={newService.serviceType}
                  onValueChange={(value) => {
                    setNewService({
                      ...newService,
                      serviceType: value,
                      serviceName: serviceTypeLabels[value] || "",
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona el tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(serviceTypeLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Nombre del Servicio *</Label>
                <Input
                  value={newService.serviceName}
                  onChange={(e) => setNewService({ ...newService, serviceName: e.target.value })}
                  placeholder="Ej. Fumigación Mensual"
                />
              </div>

              <div className="space-y-2">
                <Label>Frecuencia *</Label>
                <Select
                  value={newService.frequency}
                  onValueChange={(value) => setNewService({ ...newService, frequency: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona la frecuencia" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(frequencyLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Proveedor</Label>
                <Input
                  value={newService.providerName}
                  onChange={(e) => setNewService({ ...newService, providerName: e.target.value })}
                  placeholder="Nombre del proveedor"
                />
              </div>

              <div className="space-y-2">
                <Label>Próximo Servicio</Label>
                <Input
                  type="date"
                  value={newService.nextServiceDate}
                  onChange={(e) => setNewService({ ...newService, nextServiceDate: e.target.value })}
                />
              </div>

              <Button 
                className="w-full" 
                onClick={handleCreateService}
                disabled={!newService.serviceType || !newService.serviceName || !newService.frequency}
              >
                Crear Servicio
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar servicios..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredServices.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium">No hay servicios registrados</h3>
              <p className="text-muted-foreground mb-4">
                Comienza agregando tu primer servicio de cumplimiento
              </p>
              <Button onClick={() => setIsAddDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Nuevo Servicio
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Servicio</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Frecuencia</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Próximo Servicio</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredServices.map((service) => {
                  const status = getServiceStatus(service);
                  return (
                    <TableRow key={service.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{service.serviceName}</p>
                          {service.regulationReference && (
                            <p className="text-xs text-muted-foreground">
                              {service.regulationReference}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{serviceTypeLabels[service.serviceType]}</TableCell>
                      <TableCell>{frequencyLabels[service.frequency]}</TableCell>
                      <TableCell>{service.providerName || "-"}</TableCell>
                      <TableCell>
                        {service.nextServiceDate 
                          ? new Date(service.nextServiceDate).toLocaleDateString()
                          : "No programado"
                        }
                      </TableCell>
                      <TableCell>
                        <Badge className={status.color}>
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
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
