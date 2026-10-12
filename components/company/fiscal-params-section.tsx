"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Percent, Receipt, Landmark, Scale } from "lucide-react";
import type { FiscalParamsValues } from "@/lib/company/operating-config-values";

/**
 * C14 — los cuatro parámetros que los motores ya consumían sin editor.
 *
 * Cada campo nombra a su consumidor y su estado vacío, porque `null` no es un
 * cero: vaciar el IVA apaga la estimación de venta neta, vaciar la carga deja
 * la nómina bruta sin semáforo cargado y vaciar el umbral de merma devuelve el
 * 5% del sistema. Ninguno se muestra con un default aparente.
 */

interface FiscalFieldProps {
  id: string;
  label: string;
  /** Qué lee este parámetro, en una frase. */
  consumer: string;
  /** Qué significa el campo vacío, en una frase. */
  emptyMeans: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  icon: typeof Percent;
}

function FiscalField({
  id,
  label,
  consumer,
  emptyMeans,
  value,
  onChange,
  error,
  icon: Icon,
}: FiscalFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1.5 p-3.5 rounded-lg bg-muted/20 border border-border/60">
      <Label htmlFor={id} className="text-xs font-semibold flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min="0"
          max="100"
          step="0.5"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-8 text-sm font-medium"
          aria-invalid={!!error}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
          %
        </span>
      </div>
      <p id={hintId} className="text-xs text-muted-foreground leading-tight">
        {consumer} <span className="text-muted-foreground/80">{emptyMeans}</span>
      </p>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

interface FiscalParamsSectionProps {
  values: FiscalParamsValues;
  onChange: (key: keyof FiscalParamsValues, value: string) => void;
  /** Error del servidor por campo, ya traducido al nombre del input. */
  errors?: Record<string, string>;
}

export function FiscalParamsSection({ values, onChange, errors = {} }: FiscalParamsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Receipt className="w-5 h-5 text-foreground" /> Parámetros Fiscales, de Nómina y Merma
        </CardTitle>
        <CardDescription className="text-xs">
          Tasas que los reportes financieros y los conteos leen al calcular. Cambiarlas afecta los
          cálculos futuros; los periodos cerrados conservan su snapshot.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FiscalField
            id="vatRate"
            label="Tasa de IVA estimada"
            consumer="La base de ventas neta la usa el P&L y los KPI cuando el POS no exporta el impuesto."
            emptyMeans="Vacío = no estimar: la venta se toma bruta y el renglón lo declara."
            value={values.vatRate}
            onChange={(v) => onChange("vatRate", v)}
            error={errors.vatRate}
            icon={Receipt}
          />
          <FiscalField
            id="laborBurden"
            label="Carga patronal sobre nómina bruta"
            consumer="El ratio de nómina cargado del módulo de sucursales lo suma al costo bruto."
            emptyMeans="Vacío = sin factor: la nómina se rotula bruta y el semáforo no pinta color."
            value={values.laborBurden}
            onChange={(v) => onChange("laborBurden", v)}
            error={errors.laborBurden}
            icon={Landmark}
          />
          <FiscalField
            id="stateTax"
            label="Impuesto estatal sobre nóminas (ISN)"
            consumer="Va en línea propia dentro de la carga patronal; la tasa depende del estado."
            emptyMeans="Vacío = no se conoce, no se suma al factor."
            value={values.stateTax}
            onChange={(v) => onChange("stateTax", v)}
            error={errors.stateTax}
            icon={Landmark}
          />
          <FiscalField
            id="mermaThreshold"
            label="Umbral de varianza para merma automática"
            consumer="Al contar, un faltante mayor a este porcentaje registra merma en inventario."
            emptyMeans="Vacío = el conteo usa el 5% del sistema."
            value={values.mermaThreshold}
            onChange={(v) => onChange("mermaThreshold", v)}
            error={errors.mermaThreshold}
            icon={Scale}
          />
        </div>
      </CardContent>
    </Card>
  );
}
