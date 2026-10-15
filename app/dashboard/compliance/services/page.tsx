"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import {
  Plus,
  Search,
  Shield,
  Calendar,
  CheckCircle2,
  FileSignature,
  ExternalLink,
  ShieldAlert,
  Clock,
  History,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, PageContainer, EmptyState } from "@/components/shared";
import { MetricCard, MetricGrid } from "@/components/ui/metric-card";
import { ComplianceServiceForm } from "@/components/equipment/compliance-service-form";
import { CreateOrderDialog } from "@/components/service-orders/create-order-dialog";
import { getComplianceServiceTypeLabel, getMaintenanceFrequencyLabel } from "@/lib/equipment-constants";
import { useBranch } from "@/lib/branch-context";

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

export default function ComplianceServicesPage() {
  const { selectedBranchId, branches: contextBranches } = useBranch();
  const [services, setServices] = useState<ComplianceService[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [localBranchFilter, setLocalBranchFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [osService, setOsService] = useState<ComplianceService | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchBranches();
  }, []);

  // Sync with global header branch context if selected
  useEffect(() => {
    if (selectedBranchId && selectedBranchId !== "ALL" && selectedBranchId !== "all") {
      setLocalBranchFilter(selectedBranchId);
    } else {
      setLocalBranchFilter("ALL");
    }
  }, [selectedBranchId]);

  useEffect(() => {
    fetchServices();
  }, [localBranchFilter]);

  const fetchBranches = async () => {
    try {
      if (contextBranches && contextBranches.length > 0) {
        setBranches(contextBranches);
        return;
      }
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
      const url = localBranchFilter && localBranchFilter !== "ALL"
        ? `/api/compliance-services?branchId=${localBranchFilter}`
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

  const mandatoryCount = services.filter((s) => s.isMandatory).length;
  const overdueCount = services.filter((s) => {
    if (!s.nextServiceDate) return false;
    return new Date(s.nextServiceDate) <= new Date();
  }).length;
  const withHistoryCount = services.filter((s) => s.lastServiceDate).length;

  return (
    <PageContainer>
      <PageHeader
        title="Servicios Normativos & Pólizas"
        description="Gestión y programación de servicios obligatorios por sucursal (Fumigación, Extintores, Trampas de Grasa, Calidad de Agua)"
        icon={Shield}
        badge="NOM-251 · Protección Civil · STPS"
      >
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
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
      </PageHeader>

      {/* Métricas clave */}
      <MetricGrid columns={4}>
        <MetricCard
          label="Total Servicios"
          value={services.length}
          icon={<Shield className="h-4 w-4" />}
          subtitle="Servicios configurados"
        />
        <MetricCard
          label="Obligatorios"
          value={mandatoryCount}
          icon={<ShieldAlert className="h-4 w-4" />}
          subtitle="Cumplimiento legal / COFEPRIS"
          tone="warning"
        />
        <MetricCard
          label="Por Vencer o Vencidos"
          value={overdueCount}
          icon={<Clock className="h-4 w-4" />}
          subtitle="Requieren programación"
          tone={overdueCount > 0 ? "destructive" : "success"}
        />
        <MetricCard
          label="Con Historial"
          value={withHistoryCount}
          icon={<History className="h-4 w-4" />}
          subtitle="Servicios con ejecución previa"
          tone="success"
        />
      </MetricGrid>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por servicio, tipo o sucursal..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 text-xs"
              />
            </div>
            <div className="w-56">
              <select
                className="w-full border rounded-md px-3 py-2 text-xs bg-background text-foreground"
                value={localBranchFilter}
                onChange={(e) => setLocalBranchFilter(e.target.value)}
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
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Cargando servicios normativos...
            </div>
          ) : filteredServices.length === 0 ? (
            <EmptyState
              icon={Shield}
              title="No hay servicios normativos configurados"
              description="Registra pólizas de fumigación, extintores o análisis de agua para asegurar cumplimiento legal."
              action={{
                label: "Agregar Primer Servicio",
                onClick: () => setIsDialogOpen(true),
              }}
            />
          ) : (
            <div className="overflow-x-auto">
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
                  {filteredServices.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell className="font-medium text-xs">
                        <div className="flex items-center gap-2">
                          <span>{service.serviceName}</span>
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
                      <TableCell className="text-xs">{getServiceTypeLabel(service.serviceType)}</TableCell>
                      <TableCell className="text-xs">{getFrequencyLabel(service.frequency)}</TableCell>
                      <TableCell className="text-xs">
                        {service.nextServiceDate
                          ? new Date(service.nextServiceDate).toLocaleDateString()
                          : "-"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {service.lastServiceDate
                          ? new Date(service.lastServiceDate).toLocaleDateString()
                          : "-"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {service.providerId ? (
                          <span className="font-medium text-foreground">{service.providerName}</span>
                        ) : service.providerName ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-foreground">{service.providerName}</span>
                            <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10">
                              Sin catálogo
                            </Badge>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10">
                            Sin proveedor
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={service.isActive ? "default" : "secondary"} className="text-xs">
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
                            className="text-xs h-8"
                          >
                            <FileSignature className="h-3.5 w-3.5 mr-1" />
                            Generar OS
                          </Button>
                          <Link
                            href={`/dashboard/equipment/compliance/service-orders?complianceServiceId=${service.id}`}
                            title="Ver órdenes de servicio de este servicio normativo"
                          >
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                              <ExternalLink className="h-4 w-4" />
                              <span className="sr-only">Ver OS</span>
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
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
    </PageContainer>
  );
}
