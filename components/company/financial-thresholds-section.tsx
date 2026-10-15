"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DollarSign, ShieldAlert, Wallet, Sparkles, AlertCircle, Check, Info } from "lucide-react";
import { ETIQUETA_CLASIFICACION, politicaPorInput } from "@/lib/company/operating-policy-catalog";

/**
 * C15 — un umbral y una promesa no son lo mismo.
 *
 * Cuatro de los cinco topes de esta tarjeta cambian decisiones: los revisó
 * `rolExigidoPorMonto`, `validateEmergencyCap` y la aprobación de merma. El
 * fondo de caja chica no lo lee nadie —`petty-cash-service` trabaja con el
 * monto que el operador escribe en cada movimiento— y su texto decía
 * «monto máximo asignado al fondo revolvente», que suena a tope y no lo es.
 *
 * El distintivo sale del catálogo, no de esta tarjeta: si mañana el fondo pasa
 * a consumirse, el texto se actualiza en un solo lugar y no en dos.
 */
function EstadoDePolitica({ input }: { input: keyof FinancialThresholdsValues }) {
  const clasificacion = politicaPorInput(input)?.clasificacion ?? "descriptiva";
  return (
    <Badge
      variant="secondary"
      className={
        clasificacion === "aplicada"
          ? "ml-auto shrink-0 text-xs py-0 px-1.5 font-normal tracking-tight gap-1 bg-primary/15 text-primary border-primary/20"
          : "ml-auto shrink-0 text-xs py-0 px-1.5 font-normal tracking-tight gap-1 bg-muted text-muted-foreground"
      }
    >
      {clasificacion === "aplicada" ? (
        <Check className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Info className="h-3 w-3" aria-hidden="true" />
      )}
      {ETIQUETA_CLASIFICACION[clasificacion]}
    </Badge>
  );
}

/** Aviso del servidor junto al input que lo provocó (C13). */
function ErrorDeCampo({ id, mensaje }: { id: string; mensaje?: string }) {
  if (!mensaje) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {mensaje}
    </p>
  );
}

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
  /** Error del servidor por campo, ya traducido al nombre del input. */
  errors?: Record<string, string>;
}

export function FinancialThresholdsSection({
  values,
  onChange,
  errors = {},
}: FinancialThresholdsSectionProps) {
  const mensajeDe = (campo: keyof FinancialThresholdsValues) => errors[campo];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-foreground" /> Umbrales Financieros y Políticas de Aprobación
        </CardTitle>
        <CardDescription className="text-xs">
          Los umbrales financieros gobiernan autorizaciones por rol, topes corporativos de compras y el límite del fondo de caja chica.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Límite Gerente */}
        <div className="space-y-2 p-3.5 rounded-lg bg-muted/20 border border-border/60">
          <div className="flex flex-wrap items-center gap-2">
            <div className="p-1 rounded bg-muted text-muted-foreground">
              <ShieldAlert className="w-3.5 h-3.5" />
            </div>
            <Label htmlFor="managerAuthLimit" className="text-xs font-semibold">
              Límite de Autonomía de Gerente
            </Label>
            <EstadoDePolitica input="managerAuthLimit" />
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
              aria-invalid={!!mensajeDe("managerAuthLimit")}
              aria-describedby={mensajeDe("managerAuthLimit") ? "managerAuthLimit-error" : undefined}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
              MXN
            </span>
          </div>
          <ErrorDeCampo id="managerAuthLimit-error" mensaje={mensajeDe("managerAuthLimit")} />
          <p className="text-xs text-muted-foreground leading-tight">
            Gastos por debajo de este monto los autoriza un gerente de sucursal. Aplica cuando la empresa no
            capturó una regla de autorización para ese monto, y siempre lo resuelve alguien distinto de quien
            lo registró, salvo el dueño y el super administrador.
          </p>
        </div>

        {/* Umbral Dirección General */}
        <div className="space-y-2 p-3.5 rounded-lg bg-muted/20 border border-border/60">
          <div className="flex flex-wrap items-center gap-2">
            <div className="p-1 rounded bg-muted text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <Label htmlFor="doubleApprovalThreshold" className="text-xs font-semibold">
              Umbral Autorización Dirección General
            </Label>
            <EstadoDePolitica input="doubleApprovalThreshold" />
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
              aria-invalid={!!mensajeDe("doubleApprovalThreshold")}
              aria-describedby={mensajeDe("doubleApprovalThreshold") ? "doubleApprovalThreshold-error" : undefined}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
              MXN
            </span>
          </div>
          <ErrorDeCampo id="doubleApprovalThreshold-error" mensaje={mensajeDe("doubleApprovalThreshold")} />
          <p className="text-xs text-muted-foreground leading-tight">
            Desde este monto el gasto exige la firma del dueño del grupo. No es doble firma: el sistema tiene un
            aprobador por gasto. Aplica cuando no hay una regla de autorización para ese monto.
            También aporta un umbral a la detección de fraccionamiento.
          </p>
        </div>

        {/* Fondo Caja Chica */}
        <div className="space-y-2 p-3.5 rounded-lg bg-muted/20 border border-border/60">
          <div className="flex flex-wrap items-center gap-2">
            <div className="p-1 rounded bg-muted text-muted-foreground">
              <Wallet className="w-3.5 h-3.5" />
            </div>
            <Label htmlFor="pettyCashLimit" className="text-xs font-semibold">
              Fondo Fijo de Caja Chica por Sucursal
            </Label>
            <EstadoDePolitica input="pettyCashLimit" />
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
              aria-invalid={!!mensajeDe("pettyCashLimit")}
              aria-describedby={mensajeDe("pettyCashLimit") ? "pettyCashLimit-error" : undefined}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
              MXN
            </span>
          </div>
          <ErrorDeCampo id="pettyCashLimit-error" mensaje={mensajeDe("pettyCashLimit")} />
          <p className="text-xs text-muted-foreground leading-tight">
            Tope corporativo para el fondo fijo por sucursal. Aplica en apertura y reapertura de
            fondos, y la reposición no puede exceder el fondo fijo autorizado. Cero deshabilita
            la caja chica; vacío permite abrir sin tope de grupo. Los retiros se acotan al saldo en caja.
          </p>
        </div>

        {/* Tope Mensual Compras de Emergencia */}
        <div className="space-y-2 p-3.5 rounded-lg bg-muted/20 border border-border/60">
          <div className="flex flex-wrap items-center gap-2">
            <div className="p-1 rounded bg-muted text-muted-foreground">
              <AlertCircle className="w-3.5 h-3.5" />
            </div>
            <Label htmlFor="emergencyPurchaseCap" className="text-xs font-semibold">
              Tope Mensual Compras de Emergencia
            </Label>
            <EstadoDePolitica input="emergencyCap" />
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
              aria-invalid={!!mensajeDe("emergencyCap")}
              aria-describedby={mensajeDe("emergencyCap") ? "emergencyPurchaseCap-error" : undefined}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
              MXN
            </span>
          </div>
          <ErrorDeCampo id="emergencyPurchaseCap-error" mensaje={mensajeDe("emergencyCap")} />
          <p className="text-xs text-muted-foreground leading-tight">
            Acumulado mensual permitido de compras urgentes por sucursal. Sólo se consulta en documentos
            marcados como emergencia: si el acumulado más la orden supera el tope, el envío se rechaza. Las órdenes
            normales no pasan por aquí, sino por presupuesto y centro de costo.
          </p>
        </div>

        {/* Tope Mensual Cortesías y Personal */}
        <div className="space-y-2 p-3.5 rounded-lg bg-muted/20 border border-border/60 md:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="p-1 rounded bg-muted text-muted-foreground">
              <DollarSign className="w-3.5 h-3.5" />
            </div>
            <Label htmlFor="courtesyWasteCap" className="text-xs font-semibold">
              Tope Mensual de Cortesías y Consumo de Personal (Grupo Completo)
            </Label>
            <EstadoDePolitica input="courtesyWasteCap" />
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
              aria-invalid={!!mensajeDe("courtesyWasteCap")}
              aria-describedby={mensajeDe("courtesyWasteCap") ? "courtesyWasteCap-error" : undefined}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
              MXN
            </span>
          </div>
          <ErrorDeCampo id="courtesyWasteCap-error" mensaje={mensajeDe("courtesyWasteCap")} />
          <p className="text-xs text-muted-foreground leading-tight">
            Presupuesto mensual consolidado para mermas por consumo de colaboradores y atenciones a
            comensales. Hasta el tope aprueba un gerente; al superarlo se requiere administrador o superior.
            Sólo aplica a esas dos clases de merma. Una merma sin costo conocido no escala por monto.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
