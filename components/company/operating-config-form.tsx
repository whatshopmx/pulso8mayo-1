"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
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
  escaleraDeAutorizacionInvalida,
  idDeInput,
  mensajesDeCamposInvalidos,
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
const FISCAL_POR_CAMPO: Record<
  string,
  "vatRate" | "laborBurden" | "stateTax" | "mermaThreshold" | "payrollPracticeMode" | "aguinaldoBase"
> = {
  vatRatePercent: "vatRate",
  laborBurdenFactorPercent: "laborBurden",
  payrollStateTaxPercent: "stateTax",
  mermaVarianceThresholdPct: "mermaThreshold",
  payrollPracticeMode: "payrollPracticeMode",
  aguinaldoBase: "aguinaldoBase",
};

const INPUTS_DE_UMBRAL: Array<keyof FinancialThresholdsValues> = [
  "managerAuthLimit",
  "doubleApprovalThreshold",
  "pettyCashLimit",
  "emergencyCap",
  "courtesyWasteCap",
];

const INPUTS_DE_COSTO: Array<keyof CostTargetsValues> = [
  "foodTarget",
  "foodWarn",
  "laborTarget",
  "laborWarn",
  "marginTarget",
  "marginWarn",
];

const INPUTS_FISCALES = ["vatRate", "laborBurden", "stateTax", "mermaThreshold"] as const;

export function OperatingConfigForm({ initialConfig, onSuccess }: OperatingConfigFormProps) {
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
    toast.success(`Plantilla "${preset.name}" aplicada`, {
      description: "Las 7 dimensiones quedaron pre-configuradas. Puedes ajustarlas antes de guardar.",
    });
  };

  const handleReset = () => {
    setDimensions(inicial.dimensions);
    setThresholds(inicial.thresholds);
    setCostTargets(inicial.costTargets);
    setFiscal(inicial.fiscal);
    setErrores({});
    toast.info("Cambios descartados", {
      description: "Se restauraron los valores guardados.",
    });
  };

  // Validaciones lógicas
  const num = (raw: string) => Number(raw);
  const foodPairInvalid = num(costTargets.foodWarn) < num(costTargets.foodTarget);
  const laborPairInvalid = num(costTargets.laborWarn) < num(costTargets.laborTarget);
  const marginPairInvalid = num(costTargets.marginWarn) > num(costTargets.marginTarget);
  const percentPairsInvalid = foodPairInvalid || laborPairInvalid || marginPairInvalid;
  const authLadderInvalid = escaleraDeAutorizacionInvalida(thresholds);

  const invalidos = useMemo(() => camposInvalidos(estado), [estado]);
  const mensajesInvalidos = useMemo(() => mensajesDeCamposInvalidos(estado), [estado]);

  /**
   * Compara lo que se guardaría, no el texto del input: tras guardar, el
   * servidor devuelve `"1200.5"` donde el operador escribió `"1200.50"`, y esa
   * diferencia de formato no es un cambio pendiente. Un valor no numérico se
   * firma aparte para que escribir basura en un campo vacío sí cuente como
   * cambio (y active el aviso de salida).
   */
  const isDirty = useMemo(() => {
    const firma = (state: typeof estado) =>
      JSON.stringify(cuerpoDeConfiguracion(state), (_clave, valor) =>
        typeof valor === "number" && !Number.isFinite(valor) ? "__invalido__" : valor
      );
    return firma(estado) !== firma(inicial);
  }, [estado, inicial]);

  // C13 — salir con cambios sin guardar no debe ser silencioso.
  useEffect(() => {
    if (!isDirty) return;
    const advertir = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", advertir);
    return () => window.removeEventListener("beforeunload", advertir);
  }, [isDirty]);

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
    for (const input of INPUTS_DE_UMBRAL) {
      if (mensajesInvalidos[input]) salida[input] = mensajesInvalidos[input];
    }
    return salida;
  }, [errores, mensajesInvalidos]);

  const erroresDePorcentaje = useMemo(() => {
    const salida: Record<string, string> = {};
    for (const [columna, mensaje] of Object.entries(errores)) {
      const input = PORCENTAJE_POR_CAMPO[columna];
      if (input) salida[input] = mensaje;
    }
    for (const input of INPUTS_DE_COSTO) {
      if (mensajesInvalidos[input]) salida[input] = mensajesInvalidos[input];
    }
    return salida;
  }, [errores, mensajesInvalidos]);

  const erroresDeFiscal = useMemo(() => {
    const salida: Record<string, string> = {};
    for (const [columna, mensaje] of Object.entries(errores)) {
      const input = FISCAL_POR_CAMPO[columna];
      if (input) salida[input] = mensaje;
    }
    for (const input of INPUTS_FISCALES) {
      if (mensajesInvalidos[input]) salida[input] = mensajesInvalidos[input];
    }
    return salida;
  }, [errores, mensajesInvalidos]);

  const disabledMessage = authLadderInvalid
    ? "El límite del gerente no puede superar el umbral de Dirección General."
    : invalidos.length
      ? `Corrige ${invalidos.length} ${invalidos.length === 1 ? "campo marcado" : "campos marcados"} antes de guardar.`
      : percentPairsInvalid
        ? "Corrige las inconsistencias en los objetivos de costo para guardar."
        : undefined;

  /** Primer control que impide guardar, para llevar el foco ahí. */
  function enfocarPrimerInvalido() {
    const input =
      Object.keys(mensajesInvalidos)[0] ??
      (authLadderInvalid ? "managerAuthLimit" : undefined) ??
      (foodPairInvalid ? "foodWarn" : undefined) ??
      (laborPairInvalid ? "laborWarn" : undefined) ??
      (marginPairInvalid ? "marginWarn" : undefined);
    if (!input) return;
    const control = document.getElementById(idDeInput(input));
    if (control instanceof HTMLElement) {
      control.focus();
      control.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  async function guardar(event: FormEvent) {
    event.preventDefault();
    if (!isDirty) return;
    if (percentPairsInvalid || invalidos.length || authLadderInvalid || loading) {
      enfocarPrimerInvalido();
      return;
    }
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
          const primerInput = Object.keys(porCampo)
            .map((columna) => UMBRAL_POR_CAMPO[columna] ?? PORCENTAJE_POR_CAMPO[columna] ?? FISCAL_POR_CAMPO[columna])
            .find(Boolean);
          if (primerInput) {
            const control = document.getElementById(idDeInput(primerInput));
            if (control instanceof HTMLElement) control.focus();
          }
          throw new Error(
            `Revisa ${Object.keys(porCampo).length === 1 ? "el campo marcado" : "los campos marcados"}: ${Object.values(porCampo)[0]}`
          );
        }
        throw new Error(data?.error?.message || data?.error || "Error al actualizar configuración.");
      }

      toast.success("Configuración actualizada", {
        description: "Los umbrales, objetivos y parámetros del grupo se guardaron.",
      });

      if (onSuccess) onSuccess();
    } catch (err) {
      toast.error("Error al guardar", {
        description: err instanceof Error ? err.message : "No se pudo actualizar la configuración.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-8 pb-24" noValidate>
      {/* Primero lo que cambia decisiones hoy. */}
      <section id="umbrales" aria-labelledby="umbrales-title" className="scroll-mt-24">
        <FinancialThresholdsSection
          values={thresholds}
          onChange={handleThresholdChange}
          errors={erroresDeUmbral}
          authLadderInvalid={authLadderInvalid}
        />
      </section>

      <section id="costos" aria-labelledby="costos-title" className="scroll-mt-24">
        <CostTargetsSection
          values={costTargets}
          onChange={handleCostTargetChange}
          foodPairInvalid={foodPairInvalid}
          laborPairInvalid={laborPairInvalid}
          marginPairInvalid={marginPairInvalid}
          errors={erroresDePorcentaje}
        />
      </section>

      {/* C14 — parámetros que los motores ya consumían */}
      <section id="fiscales" aria-labelledby="fiscales-title" className="scroll-mt-24">
        <FiscalParamsSection values={fiscal} onChange={handleFiscalChange} errors={erroresDeFiscal} />
      </section>

      {/* Lo descriptivo va al final, plegado: documenta, no decide. */}
      <section id="modelo" aria-label="Modelo operativo del grupo" className="scroll-mt-24 space-y-4">
        <OperatingConfigPresets onApplyPreset={handleApplyPreset} disabled={loading} />
        <OperatingDimensionsSection values={dimensions} onChange={handleDimensionChange} />
      </section>

      {/* Persistent Sticky Action Bar */}
      <OperatingConfigStickyBar
        isDirty={isDirty}
        loading={loading}
        disabled={percentPairsInvalid || invalidos.length > 0 || authLadderInvalid}
        disabledMessage={disabledMessage}
        onReset={handleReset}
      />
    </form>
  );
}
