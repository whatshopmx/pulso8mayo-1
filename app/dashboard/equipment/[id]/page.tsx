"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ArrowLeft,
  Edit,
  Wrench,
  FileText,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Shield,
  History,
  Settings,
  Plus,
  Trash2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EquipmentForm } from "@/components/equipment/equipment-form";

interface Equipment {
  id: string;
  name: string;
  equipmentCode: string;
  type: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  assetTag?: string;
  location?: string;
  area?: string;
  status: string;
  purchaseDate?: string;
  purchasePrice?: number;
  vendor?: string;
  vendorContact?: string;
  invoiceNumber?: string;
  maintenanceFrequency?: string;
  nextMaintenanceDate?: string;
  lastMaintenanceDate?: string;
  isCritical: boolean;
  notes?: string;
  warranties?: Warranty[];
  maintenanceHistory?: MaintenanceRecord[];
  scheduledMaintenance?: ScheduledMaintenance[];
}

interface Warranty {
  id: string;
  warrantyNumber?: string;
  warrantyType: string;
  provider: string;
  providerContact?: string;
  coverageDescription?: string;
  startDate: string;
  endDate: string;
  status: string;
}

interface MaintenanceRecord {
  id: string;
  maintenanceType: string;
  status: string;
  scheduledDate: string;
  completedDate?: string;
  description: string;
  workPerformed?: string;
  providerName?: string;
  technicianName?: string;
  totalCost?: number;
}

interface ScheduledMaintenance {
  id: string;
  maintenanceType: string;
  frequency: string;
  nextScheduledDate?: string;
  isActive: boolean;
}

const equipmentTypeLabels: Record<string, string> = {
  REFRIGERATOR: "Refrigerador",
  FREEZER: "Congelador",
  OVEN: "Horno",
  STOVE: "Estufa",
  GRILL: "Parrilla",
  FRYER: "Freidora",
  DISHWASHER: "Lavavajillas",
  COFFEE_MACHINE: "Cafetera",
  BLENDER: "Licuadora",
  MIXER: "Batidora",
  EXHAUST_HOOD: "Campana Extractora",
  AIR_CONDITIONER: "Aire Acondicionado",
  FIRE_SUPPRESSION: "Sistema Contra Incendios",
  SECURITY_CAMERA: "Cámara de Seguridad",
  POS_SYSTEM: "Sistema POS",
  OTHER: "Otro",
};

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  ACTIVE: {
    label: "Activo",
    color: "bg-green-100 text-green-800 border-green-200",
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  INACTIVE: {
    label: "Inactivo",
    color: "bg-gray-100 text-gray-800 border-gray-200",
    icon: <Clock className="w-4 h-4" />,
  },
  UNDER_MAINTENANCE: {
    label: "En Mantenimiento",
    color: "bg-blue-100 text-blue-800 border-blue-200",
    icon: <Wrench className="w-4 h-4" />,
  },
  OUT_OF_ORDER: {
    label: "Fuera de Servicio",
    color: "bg-red-100 text-red-800 border-red-200",
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  DISPOSED: {
    label: "Dado de Baja",
    color: "bg-gray-100 text-gray-600 border-gray-300",
    icon: <FileText className="w-4 h-4" />,
  },
};

const maintenanceTypeLabels: Record<string, string> = {
  PREVENTIVE: "Preventivo",
  CORRECTIVE: "Correctivo",
  INSPECTION: "Inspección",
  CLEANING: "Limpieza",
  CALIBRATION: "Calibración",
  EMERGENCY: "Emergencia",
};

export default function EquipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { toast } = useToast();
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [equipmentId, setEquipmentId] = useState<string>("");

  useEffect(() => {
    params.then(p => {
      setEquipmentId(p.id);
      fetchEquipment(p.id);
    });
  }, [params]);

  const fetchEquipment = async (id: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/equipment/${id}`);
      if (!response.ok) throw new Error("Failed to fetch equipment");
      const data = await response.json();
      setEquipment(data.data);
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo cargar la información del equipo",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEquipmentUpdated = () => {
    setIsEditDialogOpen(false);
    fetchEquipment(equipmentId);
    toast({
      title: "Éxito",
      description: "Equipo actualizado correctamente",
    });
  };

  const handleDelete = async () => {
    if (!confirm("¿Estás seguro de que deseas dar de baja este equipo?")) return;

    try {
      const response = await fetch(`/api/equipment/${equipmentId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete equipment");
      toast({
        title: "Éxito",
        description: "Equipo dado de baja correctamente",
      });
      router.push("/dashboard/equipment");
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo dar de baja el equipo",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!equipment) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <AlertTriangle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">Equipo no encontrado</h3>
          <p className="text-muted-foreground mb-4">
            El equipo que buscas no existe o ha sido eliminado
          </p>
          <Button onClick={() => router.push("/dashboard/equipment")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Volver al Inventario
          </Button>
        </div>
      </div>
    );
  }

  const status = statusConfig[equipment.status];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Button
            variant="ghost"
            className="mb-2 -ml-2"
            onClick={() => router.push("/dashboard/equipment")}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Volver
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{equipment.name}</h1>
            {equipment.isCritical && (
              <Badge variant="destructive">Crítico</Badge>
            )}
          </div>
          <div className="flex items-center gap-4 text-muted-foreground">
            <span className="font-mono">{equipment.equipmentCode}</span>
            <span>•</span>
            <span>{equipmentTypeLabels[equipment.type] || equipment.type}</span>
            <span>•</span>
            <Badge variant="outline" className={status.color}>
              {status.icon}
              <span className="ml-1">{status.label}</span>
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Edit className="w-4 h-4 mr-2" />
                Editar
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Editar Equipo</DialogTitle>
              </DialogHeader>
              <EquipmentForm
                initialData={{
                  ...equipment,
                  purchasePrice: equipment.purchasePrice ? String(equipment.purchasePrice / 100) : "",
                }}
                onSuccess={handleEquipmentUpdated}
              />
            </DialogContent>
          </Dialog>
          <Button variant="destructive" onClick={handleDelete}>
            <Trash2 className="w-4 h-4 mr-2" />
            Dar de Baja
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {equipment.warranties?.filter(w => w.status === "ACTIVE").length || 0}
            </div>
            <p className="text-sm text-muted-foreground">Garantías Activas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {equipment.maintenanceHistory?.length || 0}
            </div>
            <p className="text-sm text-muted-foreground">Mantenimientos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {equipment.lastMaintenanceDate
                ? new Date(equipment.lastMaintenanceDate).toLocaleDateString()
                : "N/A"}
            </div>
            <p className="text-sm text-muted-foreground">Último Mantenimiento</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className={`text-2xl font-bold ${
              equipment.nextMaintenanceDate && new Date(equipment.nextMaintenanceDate) < new Date()
                ? "text-red-600"
                : ""
            }`}>
              {equipment.nextMaintenanceDate
                ? new Date(equipment.nextMaintenanceDate).toLocaleDateString()
                : "No programado"}
            </div>
            <p className="text-sm text-muted-foreground">Próximo Mantenimiento</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="details" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto">
          <TabsTrigger value="details" className="gap-2">
            <FileText className="w-4 h-4" />
            Detalles
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="gap-2">
            <Wrench className="w-4 h-4" />
            Mantenimiento
          </TabsTrigger>
          <TabsTrigger value="warranties" className="gap-2">
            <Shield className="w-4 h-4" />
            Garantías
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="w-4 h-4" />
            Historial
          </TabsTrigger>
        </TabsList>

        {/* Details Tab */}
        <TabsContent value="details" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* General Information */}
            <Card>
              <CardHeader>
                <CardTitle>Información General</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Marca</p>
                    <p className="font-medium">{equipment.brand || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Modelo</p>
                    <p className="font-medium">{equipment.model || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Número de Serie</p>
                    <p className="font-medium">{equipment.serialNumber || "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Tag de Activo</p>
                    <p className="font-medium">{equipment.assetTag || "-"}</p>
                  </div>
                </div>
                <div className="pt-4 border-t">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Ubicación</p>
                      <p className="font-medium">{equipment.location || "-"}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Área</p>
                      <p className="font-medium">{equipment.area || "-"}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Purchase Information */}
            <Card>
              <CardHeader>
                <CardTitle>Información de Compra</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Fecha de Compra</p>
                    <p className="font-medium">
                      {equipment.purchaseDate
                        ? new Date(equipment.purchaseDate).toLocaleDateString()
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Precio</p>
                    <p className="font-medium">
                      {equipment.purchasePrice
                        ? `$${(equipment.purchasePrice / 100).toFixed(2)}`
                        : "-"}
                    </p>
                  </div>
                </div>
                <div className="pt-4 border-t">
                  <div>
                    <p className="text-sm text-muted-foreground">Proveedor</p>
                    <p className="font-medium">{equipment.vendor || "-"}</p>
                  </div>
                  {equipment.vendorContact && (
                    <div className="mt-2">
                      <p className="text-sm text-muted-foreground">Contacto</p>
                      <p className="font-medium">{equipment.vendorContact}</p>
                    </div>
                  )}
                  {equipment.invoiceNumber && (
                    <div className="mt-2">
                      <p className="text-sm text-muted-foreground">Factura</p>
                      <p className="font-medium">{equipment.invoiceNumber}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Maintenance Configuration */}
            <Card>
              <CardHeader>
                <CardTitle>Configuración de Mantenimiento</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Frecuencia</p>
                    <p className="font-medium">
                      {equipment.maintenanceFrequency || "No configurada"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Equipo Crítico</p>
                    <p className="font-medium">
                      {equipment.isCritical ? "Sí" : "No"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle>Notas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">
                  {equipment.notes || "Sin notas adicionales"}
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Maintenance Tab */}
        <TabsContent value="maintenance" className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium">Historial de Mantenimiento</h3>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Registrar Mantenimiento
            </Button>
          </div>

          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Fecha Programada</TableHead>
                    <TableHead>Fecha Completada</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>Costo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipment.maintenanceHistory?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        <Wrench className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">
                          No hay registros de mantenimiento
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    equipment.maintenanceHistory?.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell>
                          {maintenanceTypeLabels[record.maintenanceType] ||
                            record.maintenanceType}
                        </TableCell>
                        <TableCell>
                          {new Date(record.scheduledDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {record.completedDate
                            ? new Date(record.completedDate).toLocaleDateString()
                            : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              record.status === "COMPLETED"
                                ? "default"
                                : record.status === "SCHEDULED"
                                ? "secondary"
                                : "destructive"
                            }
                          >
                            {record.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{record.providerName || "-"}</TableCell>
                        <TableCell>
                          {record.totalCost
                            ? `$${(record.totalCost / 100).toFixed(2)}`
                            : "-"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Scheduled Maintenance */}
          {equipment.scheduledMaintenance && equipment.scheduledMaintenance.length > 0 && (
            <>
              <h3 className="text-lg font-medium">Mantenimientos Programados</h3>
              <Card>
                <CardContent className="pt-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Frecuencia</TableHead>
                        <TableHead>Próxima Fecha</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {equipment.scheduledMaintenance.map((schedule) => (
                        <TableRow key={schedule.id}>
                          <TableCell>
                            {maintenanceTypeLabels[schedule.maintenanceType] ||
                              schedule.maintenanceType}
                          </TableCell>
                          <TableCell>{schedule.frequency}</TableCell>
                          <TableCell>
                            {schedule.nextScheduledDate
                              ? new Date(schedule.nextScheduledDate).toLocaleDateString()
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={schedule.isActive ? "default" : "secondary"}>
                              {schedule.isActive ? "Activo" : "Inactivo"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Warranties Tab */}
        <TabsContent value="warranties" className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium">Garantías</h3>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Agregar Garantía
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {equipment.warranties?.length === 0 ? (
              <Card className="col-span-2">
                <CardContent className="text-center py-12">
                  <Shield className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    No hay garantías registradas
                  </p>
                </CardContent>
              </Card>
            ) : (
              equipment.warranties?.map((warranty) => (
                <Card key={warranty.id}>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg">
                          {warranty.warrantyNumber || "Garantía"}
                        </CardTitle>
                        <CardDescription>{warranty.provider}</CardDescription>
                      </div>
                      <Badge
                        variant={warranty.status === "ACTIVE" ? "default" : "secondary"}
                      >
                        {warranty.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Inicio</p>
                        <p className="font-medium">
                          {new Date(warranty.startDate).toLocaleDateString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Vencimiento</p>
                        <p className="font-medium">
                          {new Date(warranty.endDate).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {warranty.coverageDescription && (
                      <div>
                        <p className="text-sm text-muted-foreground">Cobertura</p>
                        <p className="text-sm">{warranty.coverageDescription}</p>
                      </div>
                    )}
                    {warranty.providerContact && (
                      <div>
                        <p className="text-sm text-muted-foreground">Contacto</p>
                        <p className="text-sm">{warranty.providerContact}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Historial de Cambios</CardTitle>
              <CardDescription>
                Registro de todas las modificaciones al equipo
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <History className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  Historial de cambios próximamente
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
