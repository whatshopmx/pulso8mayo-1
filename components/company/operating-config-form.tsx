"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_FINANCIAL_TARGETS } from "@/lib/services/financial-kpi-types";
import { DollarSign, Building2, Save, Loader2, Target } from "lucide-react";

/**
 * Lo que el formulario lee de `/api/company/operating-config`. Todo opcional:
 * la fila puede no existir todavía y la API resuelve defaults perezosamente.
 * Los porcentajes son `numeric` en Postgres, así que llegan como string.
 */
export interface OperatingConfigValues {
  purchasingStructure?: string;
  foodProduction?: string;
  treasuryModel?: string;
  supplierPayment?: string;
  managerAutonomy?: string;
  payrollDispersion?: string;
  tenantType?: string;
  managerAuthLimitCents?: number | null;
  doubleApprovalThresholdCents?: number | null;
  pettyCashLimitCents?: number | null;
  emergencyPurchaseCapCents?: number | null;
  courtesyWasteMonthlyCapCents?: number | null;
  foodCostTargetPercent?: string | null;
  foodCostWarnPercent?: string | null;
  laborCostTargetPercent?: string | null;
  laborCostWarnPercent?: string | null;
  healthyMarginTargetPercent?: string | null;
  healthyMarginWarnPercent?: string | null;
}

interface OperatingConfigFormProps {
  initialConfig: OperatingConfigValues | null;
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
  // Vacío = sin tope (null): hasta que el admin lo configure no se bloquea nada.
  const [emergencyCap, setEmergencyCap] = useState(
    initialConfig?.emergencyPurchaseCapCents
      ? (initialConfig.emergencyPurchaseCapCents / 100).toString()
      : ""
  );
  // Tope mensual de cortesías y consumo de personal (centavos → pesos)
  const [courtesyWasteCap, setCourtesyWasteCap] = useState(
    initialConfig?.courtesyWasteMonthlyCapCents
      ? (initialConfig.courtesyWasteMonthlyCapCents / 100).toString()
      : ""
  );

  // Objetivos financieros (migración 0039). Llegan como `numeric` → string, y
  // `??` en vez de `||` porque un objetivo de 0% es un valor legítimo que `||`
  // reemplazaría por el default.
  const [foodTarget, setFoodTarget] = useState(
    String(initialConfig?.foodCostTargetPercent ?? DEFAULT_FINANCIAL_TARGETS.foodCostTargetPercent)
  );
  const [foodWarn, setFoodWarn] = useState(
    String(initialConfig?.foodCostWarnPercent ?? DEFAULT_FINANCIAL_TARGETS.foodCostWarnPercent)
  );
  const [laborTarget, setLaborTarget] = useState(
    String(initialConfig?.laborCostTargetPercent ?? DEFAULT_FINANCIAL_TARGETS.laborCostTargetPercent)
  );
  const [laborWarn, setLaborWarn] = useState(
    String(initialConfig?.laborCostWarnPercent ?? DEFAULT_FINANCIAL_TARGETS.laborCostWarnPercent)
  );
  const [marginTarget, setMarginTarget] = useState(
    String(
      initialConfig?.healthyMarginTargetPercent ??
        DEFAULT_FINANCIAL_TARGETS.healthyMarginTargetPercent
    )
  );
  const [marginWarn, setMarginWarn] = useState(
    String(
      initialConfig?.healthyMarginWarnPercent ?? DEFAULT_FINANCIAL_TARGETS.healthyMarginWarnPercent
    )
  );

  const [loading, setLoading] = useState(false);

  // Se valida en cliente lo mismo que rechaza el servidor, para que el error
  // aparezca junto al campo y no como un toast rojo después del viaje.
  const num = (raw: string) => Number(raw);
  const foodPairInvalid = num(foodWarn) < num(foodTarget);
  const laborPairInvalid = num(laborWarn) < num(laborTarget);
  const marginPairInvalid = num(marginWarn) > num(marginTarget);
  const percentPairsInvalid = foodPairInvalid || laborPairInvalid || marginPairInvalid;

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
        emergencyPurchaseCapCents:
          emergencyCap.trim() === "" ? null : Math.round(parseFloat(emergencyCap) * 100),
        courtesyWasteMonthlyCapCents:
          courtesyWasteCap.trim() === "" ? null : Math.round(parseFloat(courtesyWasteCap) * 100),
        foodCostTargetPercent: parseFloat(foodTarget),
        foodCostWarnPercent: parseFloat(foodWarn),
        laborCostTargetPercent: parseFloat(laborTarget),
        laborCostWarnPercent: parseFloat(laborWarn),
        healthyMarginTargetPercent: parseFloat(marginTarget),
        healthyMarginWarnPercent: parseFloat(marginWarn),
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
    } catch (err) {
      toast({
        title: "Error",
        description:
          err instanceof Error ? err.message : "No se pudo actualizar la configuración.",
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
            Definen qué rol hace falta para autorizar un gasto según su monto. Se aplican cuando no
            hay una regla de autorización específica que lo cubra.
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
            <span className="text-xs text-muted-foreground block">
              Gastos por debajo de este monto los autoriza un gerente. Nadie aprueba lo que
              registró: siempre firma otra persona.
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
            <span className="text-xs text-muted-foreground block">
              Desde este monto la autorización sube al dueño. (La doble firma —dos aprobadores
              sobre el mismo gasto— todavía no existe; hoy esto eleva el rol exigido.)
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
            <span className="text-xs text-muted-foreground block">
              Fondo fijo asignado por sucursal para gastos imprevistos.
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="emergencyPurchaseCap">Tope Mensual Compras de Emergencia ($ MXN)</Label>
            <Input
              id="emergencyPurchaseCap"
              type="number"
              step="500"
              value={emergencyCap}
              onChange={(e) => setEmergencyCap(e.target.value)}
              placeholder="Sin tope"
            />
            <span className="text-xs text-muted-foreground block">
              Acumulado mensual de OC/OS de emergencia por sucursal. Vacío = sin tope. Al llegar al
              tope, el envío a aprobación se bloquea.
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="courtesyWasteCap">Tope Mensual Cortesías y Consumo de Personal ($ MXN)</Label>
            <Input
              id="courtesyWasteCap"
              type="number"
              step="500"
              value={courtesyWasteCap}
              onChange={(e) => setCourtesyWasteCap(e.target.value)}
              placeholder="Sin tope"
            />
            <span className="text-xs text-muted-foreground block">
              Monto máximo mensual de mermas STAFF/CORTESÍA autorizado por gerentes (empresa completa). Al superarlo, sólo Admin u Owner pueden autorizar (loteprod §8.1). Vacío = sin tope.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Objetivos de costo — antes vivían hardcodeados en el JSX de las
          tarjetas de KPI, iguales para cualquier tipo de restaurante. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" /> Objetivos de Costo del Grupo
          </CardTitle>
          <CardDescription className="text-xs">
            Definen el semáforo de food cost, labor cost y margen en el módulo de Finanzas, y los
            umbrales de la alerta diaria de rentabilidad. Una taquería y una marisquería no comparten
            estructura de costo: estos son <em>tus</em> números, no los del sector.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <TargetPair
            idPrefix="foodCost"
            label="Food Cost"
            hint="Costo de insumos y merma sobre venta neta. Menor es mejor."
            targetLabel="Objetivo (verde hasta)"
            warnLabel="Precaución (amarillo hasta)"
            targetValue={foodTarget}
            warnValue={foodWarn}
            onTargetChange={setFoodTarget}
            onWarnChange={setFoodWarn}
            invalid={foodPairInvalid}
            invalidMessage="En costos, el umbral de precaución debe ser mayor o igual al objetivo. Si no, no hay zona amarilla: el semáforo salta de verde a rojo."
          />

          <TargetPair
            idPrefix="laborCost"
            label="Labor Cost"
            hint="Sueldo bruto sobre venta neta. No incluye IMSS ni provisiones. Menor es mejor."
            targetLabel="Objetivo (verde hasta)"
            warnLabel="Precaución (amarillo hasta)"
            targetValue={laborTarget}
            warnValue={laborWarn}
            onTargetChange={setLaborTarget}
            onWarnChange={setLaborWarn}
            invalid={laborPairInvalid}
            invalidMessage="En costos, el umbral de precaución debe ser mayor o igual al objetivo. Si no, no hay zona amarilla: el semáforo salta de verde a rojo."
          />

          <TargetPair
            idPrefix="healthyMargin"
            label="Margen tras food y labor"
            hint="100% menos food cost menos labor cost. No es utilidad operativa: todavía no descuenta renta ni gastos. Mayor es mejor."
            targetLabel="Objetivo (verde desde)"
            warnLabel="Precaución (amarillo desde)"
            targetValue={marginTarget}
            warnValue={marginWarn}
            onTargetChange={setMarginTarget}
            onWarnChange={setMarginWarn}
            invalid={marginPairInvalid}
            invalidMessage="En margen, el piso de precaución debe ser menor o igual al objetivo: mayor es mejor."
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={loading || percentPairsInvalid}>
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Guardar Configuración Operativa
        </Button>
      </div>
    </form>
  );
}

/**
 * Par objetivo/precaución de un KPI porcentual.
 *
 * Van juntos a propósito: el sentido de "precaución" depende de si el KPI mejora
 * hacia arriba o hacia abajo, y separarlos en dos campos sueltos hacía fácil
 * guardar una combinación sin zona amarilla.
 */
function TargetPair({
  idPrefix,
  label,
  hint,
  targetLabel,
  warnLabel,
  targetValue,
  warnValue,
  onTargetChange,
  onWarnChange,
  invalid,
  invalidMessage,
}: {
  idPrefix: string;
  label: string;
  hint: string;
  targetLabel: string;
  warnLabel: string;
  targetValue: string;
  warnValue: string;
  onTargetChange: (value: string) => void;
  onWarnChange: (value: string) => void;
  invalid: boolean;
  invalidMessage: string;
}) {
  const errorId = `${idPrefix}-error`;

  return (
    <div className="space-y-2 pb-4 border-b last:border-b-0 last:pb-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}Target`}>{targetLabel} (%)</Label>
          <Input
            id={`${idPrefix}Target`}
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={targetValue}
            onChange={(e) => onTargetChange(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}Warn`}>{warnLabel} (%)</Label>
          <Input
            id={`${idPrefix}Warn`}
            type="number"
            min="0"
            max="100"
            step="0.5"
            value={warnValue}
            onChange={(e) => onWarnChange(e.target.value)}
            required
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
          />
        </div>
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {invalidMessage}
        </p>
      )}
    </div>
  );
}
