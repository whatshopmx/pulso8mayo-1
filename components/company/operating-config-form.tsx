"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Settings2, ShieldCheck, DollarSign, Building2, Save, Loader2 } from "lucide-react";

interface OperatingConfigFormProps {
  initialConfig: any;
  onSuccess?: () => void;
}

export function OperatingConfigForm({ initialConfig, onSuccess }: OperatingConfigFormProps) {
  const { toast } = useToast();
  const [purchasingStructure, setPurchasingStructure] = useState(
    initialConfig?.purchasingStructure || "CENTRALIZADA"
  );
  const [foodProduction, setFoodProduction] = useState(
    initialConfig?.foodProduction || "IN_SITU"
  );
  const [treasuryModel, setTreasuryModel] = useState(
    initialConfig?.treasuryModel || "CUENTA_UNICA"
  );
  const [supplierPayment, setSupplierPayment] = useState(
    initialConfig?.supplierPayment || "CENTRALIZADO"
  );
  const [managerAutonomy, setManagerAutonomy] = useState(
    initialConfig?.managerAutonomy || "MEDIA"
  );
  const [payrollDispersion, setPayrollDispersion] = useState(
    initialConfig?.payrollDispersion || "CONSOLIDADA"
  );
  const [tenantType, setTenantType] = useState(
    initialConfig?.tenantType || "GRUPO_PROPIO"
  );

  const [managerAuthLimit, setManagerAuthLimit] = useState(
    ((initialConfig?.managerAuthLimitCents || 100000) / 100).toString()
  );
  const [doubleApprovalThreshold, setDoubleApprovalThreshold] = useState(
    ((initialConfig?.doubleApprovalThresholdCents || 1000000) / 100).toString()
  );
  const [pettyCashLimit, setPettyCashLimit] = useState(
    ((initialConfig?.pettyCashLimitCents || 500000) / 100).toString()
  );

  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const body = {
        purchasingStructure,
        foodProduction,
        treasuryModel,
        supplierPayment,
        managerAutonomy,
        payrollDispersion,
        tenantType,
        managerAuthLimitCents: Math.round(parseFloat(managerAuthLimit) * 100),
        doubleApprovalThresholdCents: Math.round(parseFloat(doubleApprovalThreshold) * 100),
        pettyCashLimitCents: Math.round(parseFloat(pettyCashLimit) * 100),
      };

      const res = await fetch("/api/company/operating-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Error al actualizar configuración.");
      }

      toast({
        title: "Configuración Actualizada",
        description: "Las dimensiones del modelo operativo y umbrales se han guardado exitosamente.",
      });

      if (onSuccess) onSuccess();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "No se pudo actualizar la configuración.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 7 Structural Dimensions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" /> Las 7 Dimensiones del Modelo Operativo (§2)
          </CardTitle>
          <CardDescription className="text-xs">
            Define la arquitectura funcional del grupo para adaptar el enrutamiento de aprobaciones, visibilidad y consolidación.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="purchasingStructure">Estructura de Compras</Label>
            <Select value={purchasingStructure} onValueChange={setPurchasingStructure}>
              <SelectTrigger id="purchasingStructure">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CENTRALIZADA">Centralizada (Misas de compra por corporativo)</SelectItem>
                <SelectItem value="POR_SUCURSAL">Por Sucursal (Gerentes compran directo)</SelectItem>
                <SelectItem value="HIBRIDO">Híbrido (Insumos clave centralizados / frescos local)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="foodProduction">Producción de Alimentos</Label>
            <Select value={foodProduction} onValueChange={setFoodProduction}>
              <SelectTrigger id="foodProduction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="IN_SITU">In Situ (Preparación 100% en restaurante)</SelectItem>
                <SelectItem value="COCINA_CENTRAL">Cocina Central / Comisariato</SelectItem>
                <SelectItem value="MIXTO">Mixto (Sub-recetas de Comisariato + ensamble local)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="treasuryModel">Modelo de Tesorería</Label>
            <Select value={treasuryModel} onValueChange={setTreasuryModel}>
              <SelectTrigger id="treasuryModel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CUENTA_UNICA">Cuenta Única Concentradora</SelectItem>
                <SelectItem value="CUENTA_POR_SUCURSAL">Cuenta Bancaria por Sucursal</SelectItem>
                <SelectItem value="MIXTO">Mixto</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="supplierPayment">Pago a Proveedores</Label>
            <Select value={supplierPayment} onValueChange={setSupplierPayment}>
              <SelectTrigger id="supplierPayment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CENTRALIZADO">Centralizado por Dirección de Finanzas</SelectItem>
                <SelectItem value="POR_SUCURSAL">Por Sucursal</SelectItem>
                <SelectItem value="HIBRIDO">Híbrido</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="managerAutonomy">Autonomía del Gerente de Sucursal</Label>
            <Select value={managerAutonomy} onValueChange={setManagerAutonomy}>
              <SelectTrigger id="managerAutonomy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALTA">Alta (Aprobación directa de compras menores)</SelectItem>
                <SelectItem value="MEDIA">Media (Aprobación sujeta a límite de catálogo)</SelectItem>
                <SelectItem value="BAJA">Baja (Toda orden requiere validación corporativa)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="payrollDispersion">Dispersión de Nómina</Label>
            <Select value={payrollDispersion} onValueChange={setPayrollDispersion}>
              <SelectTrigger id="payrollDispersion">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CONSOLIDADA">Consolidada (Una sola dispersión del grupo)</SelectItem>
                <SelectItem value="POR_RAZON_SOCIAL">Por Razón Social / Sucursal</SelectItem>
                <SelectItem value="MIXTO">Mixto</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="tenantType">Tipo de Estructura de Tenant</Label>
            <Select value={tenantType} onValueChange={setTenantType}>
              <SelectTrigger id="tenantType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GRUPO_PROPIO">Grupo Propio (100% unidades corporativas)</SelectItem>
                <SelectItem value="MIXTO_FRANQUICIAS">Mixto con Franquiciatarios (Segregación por franquicia)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Threshold Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-emerald-600" /> Umbrales Financieros y Políticas de Aprobación
          </CardTitle>
          <CardDescription className="text-xs">
            Ajusta los límites monetarios que disparan auto-aprobación o escalamiento a doble autorización.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="managerAuthLimit">Límite Autonomía Gerente ($ MXN)</Label>
            <Input
              id="managerAuthLimit"
              type="number"
              step="100"
              value={managerAuthLimit}
              onChange={(e) => setManagerAuthLimit(e.target.value)}
              required
            />
            <span className="text-[10px] text-muted-foreground block">
              Gastos/OC menores a este monto se auto-aprueban por el gerente.
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="doubleApprovalThreshold">Umbral Doble Aprobación ($ MXN)</Label>
            <Input
              id="doubleApprovalThreshold"
              type="number"
              step="1000"
              value={doubleApprovalThreshold}
              onChange={(e) => setDoubleApprovalThreshold(e.target.value)}
              required
            />
            <span className="text-[10px] text-muted-foreground block">
              Montos superiores requieren aprobación de Dirección u Owner.
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pettyCashLimit">Monto Fondo Caja Chica ($ MXN)</Label>
            <Input
              id="pettyCashLimit"
              type="number"
              step="500"
              value={pettyCashLimit}
              onChange={(e) => setPettyCashLimit(e.target.value)}
              required
            />
            <span className="text-[10px] text-muted-foreground block">
              Fondo fijo asignado por sucursal para gastos imprevistos.
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Guardar Configuración Operativa
        </Button>
      </div>
    </form>
  );
}
