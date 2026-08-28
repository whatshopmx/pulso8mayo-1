"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DollarSign, ShieldAlert, Wallet, Sparkles, AlertCircle } from "lucide-react";

export interface FinancialThresholdsValues {
  managerAuthLimit: string;
  doubleApprovalThreshold: string;
  pettyCashLimit: string;
  emergencyCap: string;
  courtesyWasteCap: string;
}

interface FinancialThresholdsSectionProps {
  values: FinancialThresholdsValues;
  onChange: (key: keyof FinancialThresholdsValues, value: string) => void;
}

export function FinancialThresholdsSection({
  values,
  onChange,
}: FinancialThresholdsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-foreground" /> Umbrales Financieros y Políticas de Aprobación
        </CardTitle>
        <CardDescription className="text-xs">
          Establece los topes de autorización de gasto por rol y los límites de seguridad financiera para todas las unidades.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Límite Gerente */}
        <div className="space-y-2 p-3.5 rounded-lg bg-muted/20 border border-border/60">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-muted text-muted-foreground">
              <ShieldAlert className="w-3.5 h-3.5" />
            </div>
            <Label htmlFor="managerAuthLimit" className="text-xs font-semibold">
              Límite de Autonomía de Gerente
            </Label>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">
              $
            </span>
            <Input
              id="managerAuthLimit"
              type="number"
              min="0"
              step="100"
              value={values.managerAuthLimit}
              onChange={(e) => onChange("managerAuthLimit", e.target.value)}
              className="pl-7 pr-12 text-sm font-medium"
              required
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
              MXN
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-tight">
            Gastos por debajo de este monto pueden ser autorizados directamente por el gerente de sucursal (siempre requiriendo firma de un segundo usuario).
          </p>
        </div>

        {/* Umbral Dirección General */}
        <div className="space-y-2 p-3.5 rounded-lg bg-muted/20 border border-border/60">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-muted text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <Label htmlFor="doubleApprovalThreshold" className="text-xs font-semibold">
              Umbral Autorización Dirección General
            </Label>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">
              $
            </span>
            <Input
              id="doubleApprovalThreshold"
              type="number"
              min="0"
              step="1000"
              value={values.doubleApprovalThreshold}
              onChange={(e) => onChange("doubleApprovalThreshold", e.target.value)}
              className="pl-7 pr-12 text-sm font-medium"
              required
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
              MXN
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-tight">
            Montos a partir de este valor escalan obligatoriamente para firma y visto bueno de Dirección General o Dueño del grupo.
          </p>
        </div>

        {/* Fondo Caja Chica */}
        <div className="space-y-2 p-3.5 rounded-lg bg-muted/20 border border-border/60">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-muted text-muted-foreground">
              <Wallet className="w-3.5 h-3.5" />
            </div>
            <Label htmlFor="pettyCashLimit" className="text-xs font-semibold">
              Fondo Fijo de Caja Chica por Sucursal
            </Label>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">
              $
            </span>
            <Input
              id="pettyCashLimit"
              type="number"
              min="0"
              step="500"
              value={values.pettyCashLimit}
              onChange={(e) => onChange("pettyCashLimit", e.target.value)}
              className="pl-7 pr-12 text-sm font-medium"
              required
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
              MXN
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-tight">
            Monto máximo asignado al fondo revolvente de cada unidad para compras imprevistas y gastos menores en efectivo.
          </p>
        </div>

        {/* Tope Mensual Compras de Emergencia */}
        <div className="space-y-2 p-3.5 rounded-lg bg-muted/20 border border-border/60">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-muted text-muted-foreground">
              <AlertCircle className="w-3.5 h-3.5" />
            </div>
            <Label htmlFor="emergencyPurchaseCap" className="text-xs font-semibold">
              Tope Mensual Compras de Emergencia
            </Label>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">
              $
            </span>
            <Input
              id="emergencyPurchaseCap"
              type="number"
              min="0"
              step="500"
              value={values.emergencyCap}
              onChange={(e) => onChange("emergencyCap", e.target.value)}
              placeholder="Sin límite fijado"
              className="pl-7 pr-12 text-sm font-medium"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
              MXN
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-tight">
            Acumulado mensual permitido de compras urgentes por sucursal. Al alcanzar este límite, las órdenes de emergencia quedan bloqueadas hasta el siguiente ciclo.
          </p>
        </div>

        {/* Tope Mensual Cortesías y Personal */}
        <div className="space-y-2 p-3.5 rounded-lg bg-muted/20 border border-border/60 md:col-span-2">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-muted text-muted-foreground">
              <DollarSign className="w-3.5 h-3.5" />
            </div>
            <Label htmlFor="courtesyWasteCap" className="text-xs font-semibold">
              Tope Mensual de Cortesías y Consumo de Personal (Grupo Completo)
            </Label>
          </div>
          <div className="relative max-w-md">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">
              $
            </span>
            <Input
              id="courtesyWasteCap"
              type="number"
              min="0"
              step="500"
              value={values.courtesyWasteCap}
              onChange={(e) => onChange("courtesyWasteCap", e.target.value)}
              placeholder="Sin límite fijado"
              className="pl-7 pr-12 text-sm font-medium"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
              MXN
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-tight">
            Presupuesto mensual consolidado para mermas operativas por consumo de colaboradores y atenciones a comensales. Al superarlo, toda merma posterior requiere visto bueno de Dirección.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
