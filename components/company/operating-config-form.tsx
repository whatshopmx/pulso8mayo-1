"use client";

import { useState, useMemo, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_FINANCIAL_TARGETS } from "@/lib/services/financial-kpi-types";
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
import { OperatingConfigStickyBar } from "@/components/company/operating-config-sticky-bar";

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

  // Helper para resolver estado inicial consistente
  const getInitialDimensions = useCallback((): OperatingDimensionsValues => ({
    purchasingStructure: initialConfig?.purchasingStructure || "CENTRALIZADA",
    foodProduction: initialConfig?.foodProduction || "IN_SITU",
    treasuryModel: initialConfig?.treasuryModel || "CUENTA_UNICA",
    supplierPayment: initialConfig?.supplierPayment || "CENTRALIZADO",
    managerAutonomy: initialConfig?.managerAutonomy || "MEDIA",
    payrollDispersion: initialConfig?.payrollDispersion || "CONSOLIDADA",
    tenantType: initialConfig?.tenantType || "GRUPO_PROPIO",
  }), [initialConfig]);

  const getInitialThresholds = useCallback((): FinancialThresholdsValues => ({
    managerAuthLimit: ((initialConfig?.managerAuthLimitCents || 100000) / 100).toString(),
    doubleApprovalThreshold: ((initialConfig?.doubleApprovalThresholdCents || 1000000) / 100).toString(),
    pettyCashLimit: ((initialConfig?.pettyCashLimitCents || 500000) / 100).toString(),
    emergencyCap: initialConfig?.emergencyPurchaseCapCents
      ? (initialConfig.emergencyPurchaseCapCents / 100).toString()
      : "",
    courtesyWasteCap: initialConfig?.courtesyWasteMonthlyCapCents
      ? (initialConfig.courtesyWasteMonthlyCapCents / 100).toString()
      : "",
  }), [initialConfig]);

  const getInitialCostTargets = useCallback((): CostTargetsValues => ({
    foodTarget: String(
      initialConfig?.foodCostTargetPercent ?? DEFAULT_FINANCIAL_TARGETS.foodCostTargetPercent
    ),
    foodWarn: String(
      initialConfig?.foodCostWarnPercent ?? DEFAULT_FINANCIAL_TARGETS.foodCostWarnPercent
    ),
    laborTarget: String(
      initialConfig?.laborCostTargetPercent ?? DEFAULT_FINANCIAL_TARGETS.laborCostTargetPercent
    ),
    laborWarn: String(
      initialConfig?.laborCostWarnPercent ?? DEFAULT_FINANCIAL_TARGETS.laborCostWarnPercent
    ),
    marginTarget: String(
      initialConfig?.healthyMarginTargetPercent ??
        DEFAULT_FINANCIAL_TARGETS.healthyMarginTargetPercent
    ),
    marginWarn: String(
      initialConfig?.healthyMarginWarnPercent ??
        DEFAULT_FINANCIAL_TARGETS.healthyMarginWarnPercent
    ),
  }), [initialConfig]);

  // Estados del formulario
  const [dimensions, setDimensions] = useState<OperatingDimensionsValues>(getInitialDimensions);
  const [thresholds, setThresholds] = useState<FinancialThresholdsValues>(getInitialThresholds);
  const [costTargets, setCostTargets] = useState<CostTargetsValues>(getInitialCostTargets);
  const [loading, setLoading] = useState(false);

  // Manejadores de cambios
  const handleDimensionChange = (key: keyof OperatingDimensionsValues, value: string) => {
    setDimensions((prev) => ({ ...prev, [key]: value }));
  };

  const handleThresholdChange = (key: keyof FinancialThresholdsValues, value: string) => {
    setThresholds((prev) => ({ ...prev, [key]: value }));
  };

  const handleCostTargetChange = (key: keyof CostTargetsValues, value: string) => {
    setCostTargets((prev) => ({ ...prev, [key]: value }));
  };

  const handleApplyPreset = (preset: OperatingPreset) => {
    setDimensions(preset.dimensions);
    toast({
      title: `Plantilla "${preset.name}" aplicada`,
      description: "Las 7 dimensiones han sido pre-configuradas. Puedes realizar ajustes antes de guardar.",
    });
  };

  const handleReset = () => {
    setDimensions(getInitialDimensions());
    setThresholds(getInitialThresholds());
    setCostTargets(getInitialCostTargets());
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

  // Detección de modificaciones (isDirty)
  const isDirty = useMemo(() => {
    const initDim = getInitialDimensions();
    const initThresh = getInitialThresholds();
    const initTargets = getInitialCostTargets();

    const dimChanged = Object.keys(dimInitMatch(dimensions, initDim)).some((k) => {
      const key = k as keyof OperatingDimensionsValues;
      return dimensions[key] !== initDim[key];
    });

    const threshChanged = Object.keys(threshInitMatch(thresholds, initThresh)).some((k) => {
      const key = k as keyof FinancialThresholdsValues;
      return thresholds[key] !== initThresh[key];
    });

    const targetsChanged = Object.keys(targetsInitMatch(costTargets, initTargets)).some((k) => {
      const key = k as keyof CostTargetsValues;
      return costTargets[key] !== initTargets[key];
    });

    return dimChanged || threshChanged || targetsChanged;
  }, [dimensions, thresholds, costTargets, getInitialDimensions, getInitialThresholds, getInitialCostTargets]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (percentPairsInvalid) return;
    setLoading(true);

    try {
      const body = {
        purchasingStructure: dimensions.purchasingStructure,
        foodProduction: dimensions.foodProduction,
        treasuryModel: dimensions.treasuryModel,
        supplierPayment: dimensions.supplierPayment,
        managerAutonomy: dimensions.managerAutonomy,
        payrollDispersion: dimensions.payrollDispersion,
        tenantType: dimensions.tenantType,
        managerAuthLimitCents: Math.round(parseFloat(thresholds.managerAuthLimit || "0") * 100),
        doubleApprovalThresholdCents: Math.round(parseFloat(thresholds.doubleApprovalThreshold || "0") * 100),
        pettyCashLimitCents: Math.round(parseFloat(thresholds.pettyCashLimit || "0") * 100),
        emergencyPurchaseCapCents:
          thresholds.emergencyCap.trim() === "" ? null : Math.round(parseFloat(thresholds.emergencyCap) * 100),
        courtesyWasteMonthlyCapCents:
          thresholds.courtesyWasteCap.trim() === "" ? null : Math.round(parseFloat(thresholds.courtesyWasteCap) * 100),
        foodCostTargetPercent: parseFloat(costTargets.foodTarget),
        foodCostWarnPercent: parseFloat(costTargets.foodWarn),
        laborCostTargetPercent: parseFloat(costTargets.laborTarget),
        laborCostWarnPercent: parseFloat(costTargets.laborWarn),
        healthyMarginTargetPercent: parseFloat(costTargets.marginTarget),
        healthyMarginWarnPercent: parseFloat(costTargets.marginWarn),
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
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8 pb-20">
      {/* 1 Clic Archetype Presets */}
      <OperatingConfigPresets onApplyPreset={handleApplyPreset} disabled={loading} />

      {/* 7 Structural Dimensions (Categorized into 3 domains) */}
      <OperatingDimensionsSection values={dimensions} onChange={handleDimensionChange} />

      {/* Financial Thresholds & Approval Policies */}
      <FinancialThresholdsSection values={thresholds} onChange={handleThresholdChange} />

      {/* Cost KPI Targets with Spectrum Gauges */}
      <CostTargetsSection
        values={costTargets}
        onChange={handleCostTargetChange}
        foodPairInvalid={foodPairInvalid}
        laborPairInvalid={laborPairInvalid}
        marginPairInvalid={marginPairInvalid}
      />

      {/* Persistent Sticky Action Bar */}
      <OperatingConfigStickyBar
        isDirty={isDirty}
        loading={loading}
        disabled={percentPairsInvalid}
        onReset={handleReset}
      />
    </form>
  );
}

// Helpers para comparación de tipos
function dimInitMatch(a: OperatingDimensionsValues, b: OperatingDimensionsValues) {
  return a;
}
function threshInitMatch(a: FinancialThresholdsValues, b: FinancialThresholdsValues) {
  return a;
}
function targetsInitMatch(a: CostTargetsValues, b: CostTargetsValues) {
  return a;
}
