"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Info, Calculator, Receipt, AlertCircle, TrendingDown, Plus } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { calcularAguinaldoAnual, diasCalendarioEntre } from "@/lib/services/aguinaldo-service";
import { resolveEffectiveSalary } from "@/lib/services/employee-service";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface SettlementCalculatorProps {
  employee: any;
  lastWorkingDay: string;
  reason: string;
  onCalculationChange: (data: any) => void;
}

export function SettlementCalculator({
  employee,
  lastWorkingDay,
  reason,
  onCalculationChange,
}: SettlementCalculatorProps) {
  const [calculation, setCalculation] = useState({
    accruedVacationDays: 0,
    vacationPay: 0,
    vacationPremium: 0,
    aguinaldo: 0,
    calculadoSobre: "REGISTRO" as "REGISTRO" | "EFECTIVO",
    salarioRegistroDiario: 0,
    salarioEfectivoDiario: 0,
    aguinaldoSobreRegistro: null as number | null,
    seniorityBonus: 0,
    severancePay: 0,
    deductions: 0,
    total: 0,
  });

  const [formConfig, setFormConfig] = useState({
    manualVacationDays: 0,
    manualDeductions: 0,
    manualBonuses: 0,
  });

  useEffect(() => {
    if (!employee || !lastWorkingDay) return;

    // --- LFT Calculation Logic ---
    const hireDate = new Date(employee.hireDate || employee.seniorityDate || new Date());
    const lastDay = new Date(lastWorkingDay);

    // Task 12: en juicio las prestaciones se calculan sobre el salario REAL
    // recibido (J. 1a./J. 24/2023). Sin dato efectivo, el cálculo es idéntico
    // al de siempre (regresión cero); con gap, ambos números se ven y la
    // fuente de cada uno queda declarada en la UI.
    const efectivo = resolveEffectiveSalary(
      employee.baseSalary || 0,
      employee.effectiveSalaryCents ?? employee.contracts?.[0]?.effectiveSalaryCents ?? null,
    );
    const dailySalary = efectivo.salarioEfectivoCents / 100;
    const salaryBase = efectivo.baseRegistradaCents / 100;

    // 1. Aguinaldo proporcional — servicio compartido (Art. 87: 15/365 × días
    //    trabajados del año hasta el último día, restando altas en año).
    //    Semántica equivalente a la formula inline previa para altas previas
    //    a ENE 1; correcta (menor) para altas DENTRO del año: antes contaba
    //    días anteriores a la alta.
    const anioFiniquito = lastDay.getFullYear();
    const altaISO = (employee.seniorityDate || employee.hireDate)?.slice(0, 10);
    const inicioAnoISO = `${anioFiniquito}-01-01`;
    const desdeISO = altaISO && altaISO > inicioAnoISO ? altaISO : inicioAnoISO;
    const lastDayISO = lastDay.toISOString().slice(0, 10);
    const diasHastaBaja = desdeISO <= lastDayISO
      ? diasCalendarioEntre(desdeISO, lastDayISO)
      : 0;
    const aguinaldo = calcularAguinaldoAnual({
      anioFiscal: anioFiniquito,
      salarioDiarioCents: efectivo.salarioEfectivoCents, // centavos: no convertir dos veces
      diasLaborados: diasHastaBaja || undefined,
    });
    const aguinaldoAmount = aguinaldo.brutoCents / 100;
    // La parte del aguinaldo cubierta por el salario de registro (lo timbrable).
    const aguinaldoRegistrado = efectivo.esFormal
      ? null
      : calcularAguinaldoAnual({
          anioFiscal: anioFiniquito,
          salarioDiarioCents: efectivo.baseRegistradaCents,
          diasLaborados: diasHastaBaja || undefined,
        }).brutoCents / 100;

    // 2. Pro-rata Vacation & Premium (Prima Vacacional 25%)
    // Mexican LFT Vacation Table (Simplified)
    // 1 yr: 12 days, 2 yrs: 14 days, 3 yrs: 16 days, 4 yrs: 18 days, 5 yrs: 20 days, then +2 every 5 years
    const yearsOfService = Math.floor((lastDay.getTime() - hireDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
    let yearlyEntitlement = 12;
    if (yearsOfService >= 1) yearlyEntitlement = 12 + (yearsOfService - 1) * 2;
    if (yearsOfService >= 5) {
      const fiveYearPeriods = Math.floor(yearsOfService / 5);
      yearlyEntitlement = 20 + (fiveYearPeriods - 1) * 2;
    }

    // Days since last anniversary
    const lastAnniversary = new Date(hireDate.getFullYear() + yearsOfService, hireDate.getMonth(), hireDate.getDate());
    const daysSinceAnniversary = Math.ceil((lastDay.getTime() - lastAnniversary.getTime()) / (1000 * 60 * 60 * 24));
    const accruedVacation = (daysSinceAnniversary / 365) * yearlyEntitlement;
    const vacationPay = accruedVacation * dailySalary;
    const vacationPremium = vacationPay * 0.25;

    // 3. Seniority Bonus (Prima de Antigüedad) - 12 days per year (capped at 2x min wage)
    // Simplified: Using current salary for estimate
    const seniorityBonus = (yearsOfService + daysSinceAnniversary / 365) * dailySalary * 12;

    // 4. Severance (Indemnización) - 3 months + 20 days per year
    let severancePay = 0;
    if (reason === "TERMINATION_WITHOUT_CAUSE") {
      severancePay = (dailySalary * 90) + (yearsOfService * dailySalary * 20);
    }

    const totalSettlement = aguinaldoAmount + vacationPay + vacationPremium + 
                          (reason.includes("TERMINATION") ? seniorityBonus : 0) + 
                          severancePay + formConfig.manualBonuses - formConfig.manualDeductions;

    const newCalc = {
      accruedVacationDays: Math.round(accruedVacation * 100) / 100,
      vacationPay: Math.round(vacationPay * 100) / 100,
      vacationPremium: Math.round(vacationPremium * 100) / 100,
      aguinaldo: Math.round(aguinaldoAmount * 100) / 100,
      // Task 12: fuente declarada del cálculo (efectivo vs registro).
      calculadoSobre: (efectivo.esFormal ? "REGISTRO" : "EFECTIVO") as "REGISTRO" | "EFECTIVO",
      salarioRegistroDiario: salaryBase,
      salarioEfectivoDiario: Math.round(efectivo.salarioEfectivoCents) / 100,
      aguinaldoSobreRegistro: aguinaldoRegistrado,
      seniorityBonus: (reason.includes("TERMINATION") || yearsOfService >= 15) ? Math.round(seniorityBonus * 100) / 100 : 0,
      severancePay: Math.round(severancePay * 100) / 100,
      deductions: formConfig.manualDeductions,
      total: Math.max(0, Math.round(totalSettlement * 100) / 100),
    };

    setCalculation(newCalc);
    onCalculationChange(newCalc);
  }, [employee, lastWorkingDay, reason, formConfig]);

  return (
    <Card className="border-primary/20 shadow-lg">
      <CardHeader className="bg-primary/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            <CardTitle>Calculadora de Finiquito / Liquidación</CardTitle>
          </div>
          <Badge variant="outline" className="bg-white">Estándar LFT 2026</Badge>
        </div>
        <CardDescription>Cálculo estimado basado en salario diario e historial laboral</CardDescription>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        {/* Info Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-500" /> Datos de Referencia
            </h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="text-muted-foreground">Salario Diario (registro):</div>
              <div className="font-medium text-right">${((employee?.baseSalary || 0) / 100).toFixed(2)}</div>
              {calculation.salarioEfectivoDiario > (employee?.baseSalary || 0) / 100 && (
                <>
                  <div className="text-amber-700 dark:text-amber-400">Salario Diario (efectivo):</div>
                  <div className="font-medium text-right text-amber-700 dark:text-amber-400">
                    ${calculation.salarioEfectivoDiario.toFixed(2)}
                  </div>
                </>
              )}
              <div className="text-muted-foreground">Fecha de Alta:</div>
              <div className="font-medium text-right">
                {employee?.hireDate ? format(new Date(employee.hireDate), "dd MMM yyyy", { locale: es }) : "—"}
              </div>
              <div className="text-muted-foreground">Último Día:</div>
              <div className="font-medium text-right text-primary">
                {lastWorkingDay ? format(new Date(lastWorkingDay), "dd MMM yyyy", { locale: es }) : "No seleccionada"}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              < TrendingDown className="h-4 w-4 text-red-500" /> Ajustes Manuales
            </h4>
            <div className="space-y-3">
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <Label htmlFor="deductions">Otras Deducciones (ej. Préstamos)</Label>
                <Input
                  id="deductions"
                  type="number"
                  className="h-8"
                  value={formConfig.manualDeductions}
                  onChange={(e) => setFormConfig(f => ({ ...f, manualDeductions: Number(e.target.value) }))}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <Label htmlFor="bonuses">Otros Bonos / Ajustes (+)</Label>
                <Input 
                  id="bonuses" 
                  type="number"
                  className="h-8"
                  value={formConfig.manualBonuses}
                  onChange={(e) => setFormConfig(f => ({ ...f, manualBonuses: Number(e.target.value) }))}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Results */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Receipt className="h-4 w-4 text-green-500" /> Desglose de Pago
          </h4>
          {calculation.calculadoSobre === "EFECTIVO" && (
            <p className="text-xs rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-800 dark:text-amber-200">
              <strong>Base real:</strong> este cálculo usa el salario efectivo realmente recibido
              ($ {calculation.salarioEfectivoDiario.toFixed(2)}/día), no el de registro
              (${calculation.salarioRegistroDiario.toFixed(2)}/día). En juicio las prestaciones se
              calculan sobre el real (J. 1a./J. 24/2023, prescripción 1 año: LFT art. 516); el
              aguinaldo timbrado con salario de registro sería ${calculation.aguinaldoSobreRegistro?.toLocaleString() ?? "—"}.
              Diferencias no reportadas al IMSS pueden implicar recargos (LSS art. 280-B).
            </p>
          )}
          
          <div className="space-y-2.5">
            <div className="flex justify-between text-sm">
              <span>Aguinaldo Prop. ({calculation.aguinaldo > 0 ? "En curso" : "0"})</span>
              <span className="font-medium">${calculation.aguinaldo.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Vacaciones Prop. ({calculation.accruedVacationDays} días)</span>
              <span className="font-medium">${calculation.vacationPay.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Prima Vacacional (25%)</span>
              <span className="font-medium">${calculation.vacationPremium.toLocaleString()}</span>
            </div>
            
            {(calculation.seniorityBonus > 0 || calculation.severancePay > 0) && (
              <div className="pt-2 mt-2 border-t border-dashed space-y-2.5">
                <div className="flex justify-between text-sm text-primary font-medium">
                  <span>Prima de Antigüedad (LFT)</span>
                  <span>${calculation.seniorityBonus.toLocaleString()}</span>
                </div>
                {calculation.severancePay > 0 && (
                  <div className="flex justify-between text-sm text-primary font-medium">
                    <span>Indemnización (90 días + 20/año)</span>
                    <span>${calculation.severancePay.toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}

            {calculation.deductions > 0 && (
              <div className="flex justify-between text-sm text-red-600 font-medium">
                <span>Deducciones</span>
                <span>-${calculation.deductions.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Summary Footer */}
        <div className="pt-4 mt-2 border-t-2">
          <div className="flex items-center justify-between text-lg font-bold">
            <span className="flex items-center gap-2 text-primary">
              Total Estimado
              <Info className="h-4 w-4 text-muted-foreground cursor-help" />
            </span>
            <span className="text-2xl text-primary">${calculation.total.toLocaleString()} MXN</span>
          </div>
          <p className="text-xs text-muted-foreground mt-4 italic">
            * Este cálculo es informativo y proporcional a la fecha seleccionada. El monto final puede variar según IMSS/ISR y horas extra pendientes.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
