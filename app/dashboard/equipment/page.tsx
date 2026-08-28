"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PageHeader,
  PageContainer,
} from "@/components/shared";
import { 
  Plus, 
  Search, 
  Filter, 
  Wrench, 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  Calendar,
  MoreHorizontal,
  FileText,
  History,
  Shield,
  Loader2
} from "lucide-react";
import { EquipmentForm } from "@/components/equipment/equipment-form";
import { EquipmentStats } from "@/components/equipment/equipment-stats";
import { MaintenanceCalendar } from "@/components/equipment/maintenance-calendar";
import { ComplianceServicesList } from "@/components/equipment/compliance-services-list";
import { EquipmentAlerts } from "@/components/equipment/equipment-alerts";
import { useToast } from "@/hooks/use-toast";

interface Equipment {
  id: string;
  name: string;
  equipmentCode: string;
  type: string;
  brand?: string;
  model?: string;
  location?: string;
  status: string;
  lastMaintenanceDate?: string;
  nextMaintenanceDate?: string;
  isCritical: boolean;
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
    icon: <CheckCircle2 className="w-4 h-4" />
  },
  INACTIVE: { 
    label: "Inactivo", 
    color: "bg-gray-100 text-gray-800 border-gray-200",
    icon: <Clock className="w-4 h-4" />
  },
  UNDER_MAINTENANCE: { 
    label: "En Mantenimiento", 
    color: "bg-blue-100 text-blue-800 border-blue-200",
    icon: <Wrench className="w-4 h-4" />
  },
  OUT_OF_ORDER: { 
    label: "Fuera de Servicio", 
    color: "bg-red-100 text-red-800 border-red-200",
    icon: <AlertTriangle className="w-4 h-4" />
  },
  DISPOSED: { 
    label: "Dado de Baja", 
    color: "bg-gray-100 text-gray-600 border-gray-300",
    icon: <FileText className="w-4 h-4" />
  },
};

export default function EquipmentPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  useEffect(() => {
    fetchEquipment();
  }, [statusFilter, typeFilter]);

  const fetchEquipment = async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "ALL") params.append("status", statusFilter);
      if (typeFilter && typeFilter !== "ALL") params.append("type", typeFilter);
      
      const response = await fetch(`/api/equipment?${params}`);
      if (!response.ok) throw new Error("Failed to fetch equipment");
      
      const data = await response.json();
      setEquipment(data.data || []);
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo cargar el inventario de equipos",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const filteredEquipment = equipment.filter((item) => {
    const matchesSearch = 
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.equipmentCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.brand?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.location?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const handleEquipmentClick = (id: string) => {
    router.push(`/dashboard/equipment/${id}`);
  };

  const handleEquipmentCreated = () => {
    setIsAddDialogOpen(false);
    fetchEquipment();
    toast({
      title: "Éxito",
      description: "Equipo creado correctamente",
    });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Equipos y Activos"
        description="Gestión de equipos, mantenimientos y servicios de cumplimiento"
        icon={Wrench}
        actions={
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Agregar Equipo
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nuevo Equipo</DialogTitle>
              </DialogHeader>
              <EquipmentForm onSuccess={handleEquipmentCreated} />
            </DialogContent>
          </Dialog>
        }
      />

      <Tabs defaultValue="equipment" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto">
          <TabsTrigger value="equipment" className="gap-2">
            <Wrench className="w-4 h-4" />
            Equipos
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-2">
            <Calendar className="w-4 h-4" />
            Calendario
          </TabsTrigger>
          <TabsTrigger value="compliance" className="gap-2">
            <Shield className="w-4 h-4" />
            Servicios
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <AlertTriangle className="w-4 h-4" />
            Alertas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="equipment" className="space-y-6">
          <EquipmentStats />

          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row gap-4 justify-between">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar equipos..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <div className="flex gap-2">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40">
                      <Filter className="w-4 h-4 mr-2" />
                      <SelectValue placeholder="Estado" />
                    </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos</SelectItem>
                <SelectItem value="ACTIVE">Activo</SelectItem>
                <SelectItem value="INACTIVE">Inactivo</SelectItem>
                <SelectItem value="UNDER_MAINTENANCE">En Mantenimiento</SelectItem>
                <SelectItem value="OUT_OF_ORDER">Fuera de Servicio</SelectItem>
              </SelectContent>
                  </Select>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-45">
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos</SelectItem>
              {Object.entries(equipmentTypeLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredEquipment.length === 0 ? (
                <div className="text-center py-12">
                  <Wrench className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium">No hay equipos registrados</h3>
                  <p className="text-muted-foreground mb-4">
                    Comienza agregando tu primer equipo
                  </p>
                  <Button onClick={() => setIsAddDialogOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Agregar Equipo
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Código</TableHead>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Ubicación</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Último Mant.</TableHead>
                        <TableHead>Próximo Mant.</TableHead>
                        <TableHead className="w-25"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEquipment.map((item) => {
                        const status = statusConfig[item.status];
                        return (
                          <TableRow
                            key={item.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => handleEquipmentClick(item.id)}
                          >
                            <TableCell className="font-medium">
                              {item.equipmentCode}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {item.name}
                                {item.isCritical && (
                                  <Badge variant="destructive" className="text-xs">
                                    Crítico
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>{equipmentTypeLabels[item.type] || item.type}</TableCell>
                            <TableCell>{item.location || "-"}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`${status.color} flex items-center gap-1`}
                              >
                                {status.icon}
                                {status.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {item.lastMaintenanceDate
                                ? new Date(item.lastMaintenanceDate).toLocaleDateString()
                                : "N/A"}
                            </TableCell>
                            <TableCell>
                              {item.nextMaintenanceDate ? (
                                <span
                                  className={
                                    new Date(item.nextMaintenanceDate) < new Date()
                                      ? "text-red-600 font-medium"
                                      : ""
                                  }
                                >
                                  {new Date(item.nextMaintenanceDate).toLocaleDateString()}
                                </span>
                              ) : (
                                "N/A"
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEquipmentClick(item.id);
                                }}
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar">
          <MaintenanceCalendar />
        </TabsContent>

        <TabsContent value="compliance">
          <ComplianceServicesList />
        </TabsContent>

        <TabsContent value="alerts">
          <EquipmentAlerts />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
