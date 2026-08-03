"use client";

import { useState, useEffect } from "react";
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
import { Plus, Search, Building2, Star, Phone, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ServiceProviderForm } from "@/components/equipment/service-provider-form";

interface ServiceProvider {
  id: string;
  name: string;
  businessName?: string;
  providerType: string;
  services: string[];
  contactName?: string;
  phone?: string;
  email?: string;
  certifications?: string[];
  isCertified: boolean;
  rating?: number;
  isActive: boolean;
}

export default function EquipmentProvidersPage() {
  const [providers, setProviders] = useState<ServiceProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      const res = await fetch("/api/equipment/providers");
      if (res.ok) {
      const data = await res.json();
      setProviders(data.data || []);
      }
    } catch (error) {
      toast({ title: "Error", description: "No se pudieron cargar los proveedores" });
    } finally {
      setLoading(false);
    }
  };

  const filteredProviders = providers.filter(
    (provider) =>
      provider.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      provider.businessName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getProviderTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      INTERNAL: "Interno",
      EXTERNAL: "Externo",
      CERTIFIED: "Certificado",
    };
    return labels[type] || type;
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`w-4 h-4 ${
              star <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
            }`}
          />
        ))}
      </div>
    );
  };

  if (loading) {
    return <div className="p-6">Cargando proveedores...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Proveedores de Servicios</h1>
          <p className="text-muted-foreground">Gestión de proveedores de mantenimiento y servicios</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Nuevo Proveedor
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Agregar Proveedor</DialogTitle>
            </DialogHeader>
            <ServiceProviderForm onSuccess={() => { setDialogOpen(false); fetchProviders(); }} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{providers.length}</div>
            <p className="text-sm text-muted-foreground">Total Proveedores</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {providers.filter((p) => p.providerType === "EXTERNAL").length}
            </div>
            <p className="text-sm text-muted-foreground">Externos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {providers.filter((p) => p.isCertified).length}
            </div>
            <p className="text-sm text-muted-foreground">Certificados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">
              {providers.filter((p) => p.providerType === "CERTIFIED").length}
            </div>
            <p className="text-sm text-muted-foreground">Con Certificación</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar proveedores..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Servicios</TableHead>
                <TableHead>Contacto</TableHead>
                <TableHead>Certificación</TableHead>
                <TableHead>Calificación</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProviders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <Building2 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No hay proveedores registrados</p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredProviders.map((provider) => (
                  <TableRow key={provider.id}>
                    <TableCell>
                      <div className="font-medium">{provider.name}</div>
                      {provider.businessName && (
                        <div className="text-sm text-muted-foreground">
                          {provider.businessName}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          provider.providerType === "CERTIFIED"
                            ? "default"
                            : provider.providerType === "INTERNAL"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {getProviderTypeLabel(provider.providerType)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {provider.services.slice(0, 2).map((service, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {service}
                          </Badge>
                        ))}
                        {provider.services.length > 2 && (
                          <Badge variant="secondary" className="text-xs">
                            +{provider.services.length - 2}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1 text-sm">
                        {provider.contactName && <div>{provider.contactName}</div>}
                        {provider.phone && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Phone className="w-3 h-3" />
                            {provider.phone}
                          </div>
                        )}
                        {provider.email && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Mail className="w-3 h-3" />
                            {provider.email}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {provider.isCertified ? (
                        <Badge variant="default" className="bg-green-600">
                          Certificado
                        </Badge>
                      ) : (
                        <Badge variant="secondary">No Certificado</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {provider.rating ? renderStars(provider.rating) : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={provider.isActive ? "default" : "secondary"}>
                        {provider.isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}