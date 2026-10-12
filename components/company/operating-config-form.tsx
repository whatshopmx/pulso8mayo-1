"use client";

import { useState, useMemo, type FormEvent } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  OperatingConfigPresets,
  type OperatingPreset,
} from "@/components/company/operating-config-presets";
import {
  OperatingDimensionsSection,
  type OperatingDimensionsValues,
} from "@/components/company/operating-dimensions-section";
import {
  FinancialThresholdsSection,
  type FinancialThresholdsValues,
} from "@/components/company/financial-thresholds-section";
import {
  CostTargetsSection,
  type CostTargetsValues,
} from "@/components/company/cost-targets-section";
import { FiscalParamsSection } from "@/components/company/fiscal-params-section";
import { OperatingConfigStickyBar } from "@/components/company/operating-config-sticky-bar";
import {
  camposInvalidos,
  cuerpoDeConfiguracion,
  erroresPorCampo,
  valoresIniciales,
  type FiscalParamsValues,
  type OperatingConfigValues,
} from "@/lib/company/operating-config-values";

export type { OperatingConfigValues };

interface OperatingConfigFormProps {
  initialConfig: OperatingConfigValues | null;
  onSuccess?: () => void;
}

/** Campo del servidor → input del formulario que lo captura. */
const UMBRAL_POR_CAMPO: Record<string, keyof FinancialThresholdsValues> = {
  managerAuthLimitCents: "managerAuthLimit",
  doubleApprovalThresholdCents: "doubleApprovalThreshold",
  pettyCashLimitCents: "pettyCashLimit",
  emergencyPurchaseCapCents: "emergencyCap",
  courtesyWasteMonthlyCapCents: "courtesyWasteCap",
};

const PORCENTAJE_POR_CAMPO: Record<string, keyof CostTargetsValues> = {
  foodCostTargetPercent: "foodTarget",
  foodCostWarnPercent: "foodWarn",
  laborCostTargetPercent: "laborTarget",
  laborCostWarnPercent: "laborWarn",
  healthyMarginTargetPercent: "marginTarget",
  healthyMarginWarnPercent: "marginWarn",
};

/** C14 — columna fiscal → input del formulario. */
const FISCAL_POR_CAMPO: Record<string, "vatRate" | "laborBurden" | "stateTax" | "mermaThreshold"> = {
  vatRatePercent: "vatRate",
  laborBurdenFactorPercent: "laborBurden",
  payrollStateTaxPercent: "stateTax",
  mermaVarianceThresholdPct: "mermaThreshold",
};

export function OperatingConfigForm({ initialConfig, onSuccess }: OperatingConfigFormProps) {
  const { toast } = useToast();
  // Un solo lugar donde se decide qué se muestra: `initialConfig` null significa
  // "sin fila", y la página sólo monta el formulario tras una carga exitosa.
  const inicial = useMemo(() => valoresIniciales(initialConfig), [initialConfig]);

  const [dimensions, setDimensions] = useState<OperatingDimensionsValues>(inicial.dimensions);
  const [thresholds, setThresholds] = useState<FinancialThresholdsValues>(inicial.thresholds);
  const [costTargets, setCostTargets] = useState<CostTargetsValues>(inicial.costTargets);
  const [fiscal, setFiscal] = useState(inicial.fiscal);
  const [loading, setLoading] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});

  const estado = useMemo(
    () => ({ dimensions, thresholds, costTargets, fiscal }),
    [dimensions, thresholds, costTargets, fiscal]
  );

  const handleDimensionChange = (key: keyof OperatingDimensionsValues, value: string) => {
    setDimensions((prev) => ({ ...prev, [key]: value }));
  };

  const handleThresholdChange = (key: keyof FinancialThresholdsValues, value: string) => {
    setThresholds((prev) => ({ ...prev, [key]: value }));
    setErrores((prev) => Object.fromEntries(Object.entries(prev).filter(([campo]) => UMBRAL_POR_CAMPO[campo] !== key)));
  };

  const handleCostTargetChange = (key: keyof CostTargetsValues, value: string) => {
    setCostTargets((prev) => ({ ...prev, [key]: value }));
    setErrores((prev) => Object.fromEntries(Object.entries(prev).filter(([campo]) => PORCENTAJE_POR_CAMPO[campo] !== key)));
  };

  const handleFiscalChange = (key: keyof FiscalParamsValues, value: string) => {
    setFiscal((prev) => ({ ...prev, [key]: value }));
    setErrores((prev) => Object.fromEntries(Object.entries(prev).filter(([campo]) => FISCAL_POR_CAMPO[campo] !== key)));
  };

  const handleApplyPreset = (preset: OperatingPreset) => {
    setDimensions(preset.dimensions);
    toast({
      title: `Plantilla "${preset.name}" aplicada`,
      description: "Las 7 dimensiones han sido pre-configuradas. Puedes realizar ajustes antes de guardar.",
    });
  };

  const handleReset = () => {
    setDimensions(inicial.dimensions);
    setThresholds(inicial.thresholds);
    setCostTargets(inicial.costTargets);
    setFiscal(inicial.fiscal);
    setErrores({});
    toast({
      title: "Cambios descartados",
      description: "Se han restaurado los valores originales.",
    });
  };

  // Validaciones lógicas
  const num = (raw: string) => Number(raw);
  const foodPairInvalid = num(costTargets.foodWarn) < num(costTargets.foodTarget);
  const laborPairInvalid = num(costTargets.laborWarn) < num(costTargets.laborTarget);
  const marginPairInvalid = num(costTargets.marginWarn) > num(costTargets.marginTarget);
  const percentPairsInvalid = foodPairInvalid || laborPairInvalid || marginPairInvalid;

  const invalidos = useMemo(() => camposInvalidos(estado), [estado]);
  const isDirty = useMemo(
    () =>
      JSON.stringify(estado) !== JSON.stringify(inicial),
    [estado, inicial]
  );

  /**
   * Los errores del servidor vienen con el nombre de la columna; el formulario
   * los muestra junto al input que la captura. Un solo mapa por sección evita
   * repetir la traducción en cada campo.
   */
  const erroresDeUmbral = useMemo(() => {
    const salida: Record<string, string> = {};
    for (const [columna, mensaje] of Object.entries(errores)) {
      const input = UMBRAL_POR_CAMPO[columna];
      if (input) salida[input] = mensaje;
    }
    return salida;
  }, [errores]);

  const erroresDePorcentaje = useMemo(() => {
    const salida: Record<string, string> = {};
    for (const [columna, mensaje] of Object.entries(errores)) {
      const input = PORCENTAJE_POR_CAMPO[columna];
      if (input) salida[input] = mensaje;
    }
    return salida;
  }, [errores]);

  const erroresDeFiscal = useMemo(() => {
    const salida: Record<string, string> = {};
    for (const [columna, mensaje] of Object.entries(errores)) {
      const input = FISCAL_POR_CAMPO[columna];
      if (input) salida[input] = mensaje;
    }
    return salida;
  }, [errores]);

  async function guardar(event: FormEvent) {
    event.preventDefault();
    if (percentPairsInvalid || invalidos.length || loading) return;
    setLoading(true);
    setErrores({});

    try {
      const res = await fetch("/api/company/operating-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpoDeConfiguracion(estado)),
      });

      const data = await res.json();
      if (!res.ok) {
        const porCampo = erroresPorCampo(data?.error?.details);
        if (Object.keys(porCampo).length) {
          setErrores(porCampo);
          throw new Error(
            `Revisa ${Object.keys(porCampo).length === 1 ? "el campo marcado" : "los campos marcados"}: ${Object.values(porCampo)[0]}`
          );
        }
        throw new Error(data?.error?.message || data?.error || "Error al actualizar configuración.");
      }

      toast({
        title: "Configuración Actualizada",
        description: "El modelo operativo y los umbrales financieros del grupo se han guardado exitosamente.",
      });

      if (onSuccess) onSuccess();
    } catch (err) {
      toast({
        title: "Error al guardar",
        description: err instanceof Error ? err.message : "No se pudo actualizar la configuración.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-8 pb-20" noValidate>
      {/* 1 Clic Archetype Presets */}
      <OperatingConfigPresets onApplyPreset={handleApplyPreset} disabled={loading} />

      {/* 7 Structural Dimensions (Categorized into 3 domains) */}
      <OperatingDimensionsSection values={dimensions} onChange={handleDimensionChange} />

      {/* Financial Thresholds & Approval Policies */}
      <FinancialThresholdsSection
        values={thresholds}
        onChange={handleThresholdChange}
        errors={erroresDeUmbral}
      />

      {/* Cost KPI Targets with Spectrum Gauges */}
      <CostTargetsSection
        values={costTargets}
        onChange={handleCostTargetChange}
        foodPairInvalid={foodPairInvalid}
        laborPairInvalid={laborPairInvalid}
        marginPairInvalid={marginPairInvalid}
        errors={erroresDePorcentaje}
      />

      {/* C14 — parámetros que los motores ya consumían */}
      <FiscalParamsSection values={fiscal} onChange={handleFiscalChange} errors={erroresDeFiscal} />

      {/* Persistent Sticky Action Bar */}
      <OperatingConfigStickyBar
        isDirty={isDirty}
        loading={loading}
        disabled={percentPairsInvalid || invalidos.length > 0}
        disabledMessage={
          invalidos.length
            ? `Corrige ${invalidos.length} ${invalidos.length === 1 ? "campo" : "campos"} antes de guardar.`
            : undefined
        }
        onReset={handleReset}
      />
    </form>
  );
}
