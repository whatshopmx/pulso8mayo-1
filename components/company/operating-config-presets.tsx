"use client";

import { Sparkles, Building, Store, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface OperatingPreset {
  id: string;
  name: string;
  shortDesc: string;
  icon: typeof Building;
  dimensions: {
    purchasingStructure: "CENTRALIZADA" | "POR_SUCURSAL" | "HIBRIDO";
    foodProduction: "IN_SITU" | "COCINA_CENTRAL" | "MIXTO";
    treasuryModel: "CUENTA_UNICA" | "CUENTA_POR_SUCURSAL" | "MIXTO";
    supplierPayment: "CENTRALIZADO" | "POR_SUCURSAL" | "HIBRIDO";
    managerAutonomy: "ALTA" | "MEDIA" | "BAJA";
    payrollDispersion: "CONSOLIDADA" | "POR_RAZON_SOCIAL" | "MIXTO";
    tenantType: "GRUPO_PROPIO" | "MIXTO_FRANQUICIAS";
  };
}

export const OPERATING_PRESETS: OperatingPreset[] = [
  {
    id: "corporativo",
    name: "Corporativo Centralizado",
    shortDesc: "Mando único, compras consolidadas y cuenta concentradora.",
    icon: Building,
    dimensions: {
      purchasingStructure: "CENTRALIZADA",
      foodProduction: "COCINA_CENTRAL",
      treasuryModel: "CUENTA_UNICA",
      supplierPayment: "CENTRALIZADO",
      managerAutonomy: "MEDIA",
      payrollDispersion: "CONSOLIDADA",
      tenantType: "GRUPO_PROPIO",
    },
  },
  {
    id: "franquicia",
    name: "Franquicia con Comisariato",
    shortDesc: "Insumos clave desde comisariato, cuentas y dispersión segregadas.",
    icon: Network,
    dimensions: {
      purchasingStructure: "HIBRIDO",
      foodProduction: "MIXTO",
      treasuryModel: "CUENTA_POR_SUCURSAL",
      supplierPayment: "HIBRIDO",
      managerAutonomy: "BAJA",
      payrollDispersion: "POR_RAZON_SOCIAL",
      tenantType: "MIXTO_FRANQUICIAS",
    },
  },
  {
    id: "descentralizado",
    name: "Operación Descentralizada",
    shortDesc: "Producción in situ y alta autonomía para gerentes de sucursal.",
    icon: Store,
    dimensions: {
      purchasingStructure: "POR_SUCURSAL",
      foodProduction: "IN_SITU",
      treasuryModel: "CUENTA_POR_SUCURSAL",
      supplierPayment: "POR_SUCURSAL",
      managerAutonomy: "ALTA",
      payrollDispersion: "POR_RAZON_SOCIAL",
      tenantType: "GRUPO_PROPIO",
    },
  },
];

interface OperatingConfigPresetsProps {
  onApplyPreset: (preset: OperatingPreset) => void;
  disabled?: boolean;
}

export function OperatingConfigPresets({
  onApplyPreset,
  disabled = false,
}: OperatingConfigPresetsProps) {
  return (
    <div className="p-4 rounded-lg bg-card border border-border space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-accent/20 text-primary">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              Plantillas de Arquetipo HORECA
              <Badge variant="outline" className="text-xs py-0 px-1.5 font-normal">
                1 Clic
              </Badge>
            </h3>
            <p className="text-xs text-muted-foreground">
              Aplica un perfil predeterminado a las 7 dimensiones estructurales. Puedes ajustar cualquier valor después.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
        {OPERATING_PRESETS.map((preset) => {
          const Icon = preset.icon;
          return (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onApplyPreset(preset)}
              className="h-auto py-2.5 px-3 flex items-start gap-2.5 text-left justify-start hover:border-primary/50 hover:bg-accent/10 transition-colors"
            >
              <div className="p-1 rounded bg-muted text-muted-foreground mt-0.5 shrink-0">
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div className="space-y-0.5 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{preset.name}</p>
                <p className="text-xs text-muted-foreground line-clamp-2 leading-tight">
                  {preset.shortDesc}
                </p>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
