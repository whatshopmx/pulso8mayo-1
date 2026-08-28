"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Search, Shield, Calendar, CheckCircle2, FileSignature, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ComplianceServiceForm } from "@/components/equipment/compliance-service-form";
import { CreateOrderDialog } from "@/components/service-orders/create-order-dialog";
import { getComplianceServiceTypeLabel, getMaintenanceFrequencyLabel } from "@/lib/equipment-constants";

interface ComplianceService {
  id: string;
  branchId?: string;
  serviceType: string;
  serviceName: string;
  frequency: string;
  nextServiceDate?: string;
  lastServiceDate?: string;
  providerId?: string | null;
  providerName?: string;
  branchName?: string;
  isMandatory: boolean;
  isActive: boolean;
}

export default function EquipmentCompliancePage() {
  const [services, setServices] = useState<ComplianceService[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  // Fila desde la que se genera una OS (prefill complianceServiceId + branchId).
  const [osService, setOsService] = useState<ComplianceService | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchServices();
  }, [selectedBranchId]);

  const fetchBranches = async () => {
    try {
      const res = await fetch("/api/branches");
      if (res.ok) {
        const result = await res.json();
        setBranches(result.data || result || []);
      }
    } catch (error) {
      console.error("Error loading branches:", error);
    }
  };

  const fetchServices = async () => {
    try {
      setLoading(true);
      const url = selectedBranchId && selectedBranchId !== "ALL"
        ? `/api/compliance-services?branchId=${selectedBranchId}`
        : `/api/compliance-services?branchId=ALL`;
      const res = await fetch(url);
      if (res.ok) {
        const result = await res.json();
        const rawData = result.data || [];
        const formatted = rawData.map((item: any) => {
          if (item.service) {
            return {
              ...item.service,
              providerId: item.provider?.id || item.service.providerId || null,
              providerName: item.provider?.name || item.service.providerName,
              branchName: item.branch?.name,
            };
          }
          return item;
        });
        setServices(formatted);
      }
    } catch (error) {
      toast({ title: "Error", description: "No se pudieron cargar los servicios" });
    } finally {
      setLoading(false);
    }
  };

  const filteredServices = services.filter(
    (service) =>
      service.serviceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      service.serviceType.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (service.branchName && service.branchName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getServiceTypeLabel = (type: string) => getComplianceServiceTypeLabel(type);

  const getFrequencyLabel = (freq: string) => getMaintenanceFrequencyLabel(freq);

  if (loading) {
    return <div className="p-6">Cargando servicios...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Servicios Normativos</h1>
          <p className="text-muted-foreground">Gestión de servicios de cumplimiento y normativas por sucursal</p>
        </div>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Servicio
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configurar Servicio Normativo</DialogTitle>
          </DialogHeader>
          <ComplianceServiceForm
            onSuccess={() => {
              setIsDialogOpen(false);
              fetchServices();
            }}
          />
        </DialogContent>
      </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{services.length}</div>
            <p className="text-sm text-muted-foreground">Total Servicios</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {services.filter((s) => s.isMandatory).length}
            </div>
            <p className="text-sm text-muted-foreground">Obligatorios</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {services.filter((s) => {
                if (!s.nextServiceDate) return false;
                return new Date(s.nextServiceDate) <= new Date();
              }).length}
            </div>
            <p className="text-sm text-muted-foreground">Próximos a Vencer</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {services.filter((s) => s.lastServiceDate).length}
            </div>
            <p className="text-sm text-muted-foreground">Con Historial</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por servicio, tipo o sucursal..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="w-56">
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
              >
                <option value="ALL">Todas las Sucursales</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Servicio</TableHead>
                <TableHead>Sucursal</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Frecuencia</TableHead>
                <TableHead>Próxima Fecha</TableHead>
                <TableHead>Último Servicio</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredServices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No hay servicios configurados</p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredServices.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {service.serviceName}
                        {service.isMandatory && (
                          <Badge variant="destructive" className="text-xs">
                            Obligatorio
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {service.branchName || "Sucursal"}
                      </Badge>
                    </TableCell>
                    <TableCell>{getServiceTypeLabel(service.serviceType)}</TableCell>
                    <TableCell>{getFrequencyLabel(service.frequency)}</TableCell>
                    <TableCell>
                      {service.nextServiceDate
                        ? new Date(service.nextServiceDate).toLocaleDateString()
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {service.lastServiceDate
                        ? new Date(service.lastServiceDate).toLocaleDateString()
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {service.providerId ? (
                        <span className="font-medium text-foreground">{service.providerName}</span>
                      ) : service.providerName ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-foreground">{service.providerName}</span>
                          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10">
                            Sin catálogo
                          </Badge>
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10">
                          Sin proveedor
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={service.isActive ? "default" : "secondary"}>
                        {service.isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setOsService(service)}
                          title="Generar Orden de Servicio vinculada a este servicio normativo"
                        >
                          <FileSignature className="h-4 w-4 mr-1" />
                          Generar OS
                        </Button>
                        <Link
                          href={`/dashboard/equipment/compliance/service-orders?complianceServiceId=${service.id}`}
                          title="Ver órdenes de servicio de este servicio normativo"
                        >
                          <Button size="sm" variant="ghost">
                            <ExternalLink className="h-4 w-4" />
                            <span className="sr-only">Ver OS</span>
                          </Button>
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Generar OS desde este servicio normativo (prefill vínculo + sucursal + alcance). */}
      <CreateOrderDialog
        open={!!osService}
        onClose={() => setOsService(null)}
        prefill={
          osService
            ? {
                complianceServiceId: osService.id,
                branchId: osService.branchId,
                scope: osService.serviceName,
              }
            : undefined
        }
      />
    </div>
  );
}