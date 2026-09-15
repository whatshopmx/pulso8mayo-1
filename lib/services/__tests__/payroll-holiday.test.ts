import { describe, it, expect } from "vitest";
import { construirDesgloseNomina } from "../payroll-service";

describe("Nómina & Pago de Días Festivos Obligatorios (Art. 74/75 LFT y LISR Art. 93)", () => {
  it("generates standard base payroll without holiday pay when no holidays are worked", () => {
    const payroll = {
      baseSalaryCents: 500000, // $5,000.00 MXN
      propinasCents: 100000, // $1,000.00 MXN
      holidayPayCents: 0,
    };

    const { desglosePercepciones } = construirDesgloseNomina(payroll);

    expect(desglosePercepciones).toHaveLength(2);
    expect(desglosePercepciones[0]).toEqual({
      earningTypeCode: "001",
      code: "001",
      concept: "Sueldo nominal",
      taxedAmount: 500000,
      exemptAmount: 0,
    });
    expect(desglosePercepciones[1]).toEqual({
      earningTypeCode: "038",
      code: "038",
      concept: "Propinas asignadas",
      taxedAmount: 0,
      exemptAmount: 100000,
    });
  });

  it("calculates holiday pay extra (2x adicional / 3x total LFT Art. 75) with SAT perception code 025", () => {
    const dailySalaryCents = 50000; // $500.00 MXN al día
    const daysInPeriod = 15; // Quincena
    const baseSalaryCents = dailySalaryCents * daysInPeriod; // $7,500.00 MXN (750,000¢)
    
    // Trabajó 1 día festivo oficial (ej. 1 de mayo)
    // El sueldo base de ese día ya está en baseSalaryCents (1x).
    // La prima adicional obligatoria es 2x el salario diario:
    const holidayDaysWorked = 1;
    const holidayPayCents = holidayDaysWorked * dailySalaryCents * 2; // $1,000.00 MXN (100,000¢)

    const payroll = {
      baseSalaryCents,
      propinasCents: 0,
      holidayPayCents,
    };

    const { desglosePercepciones } = construirDesgloseNomina(payroll);

    expect(desglosePercepciones).toHaveLength(2);
    
    // Percepción 001: Sueldo base
    expect(desglosePercepciones[0].code).toBe("001");
    expect(desglosePercepciones[0].taxedAmount).toBe(750000);

    // Percepción 025: Prima de festivo trabajado
    const holidayPerception = desglosePercepciones.find(p => p.earningTypeCode === "025");
    expect(holidayPerception).toBeDefined();
    expect(holidayPerception?.concept).toContain("festivo trabajado");

    // LISR Art. 93: 50% exento topado a 5 UMAs diarias (~56,570 centavos)
    // 50% de 100,000¢ = 50,000¢ (< 56,570¢), por ende los 50,000¢ quedan exentos y 50,000¢ gravados
    expect(holidayPerception?.exemptAmount).toBe(50000);
    expect(holidayPerception?.taxedAmount).toBe(50000);
    expect(holidayPerception!.exemptAmount + holidayPerception!.taxedAmount).toBe(holidayPayCents);
  });

  it("caps the tax-exempt portion at 5 UMAs per LISR Art. 93 Fracc. I when holiday pay is high", () => {
    // Empleado con salario diario de $2,000.00 MXN (200,000¢)
    // Prima de festivo trabajado (2x) = $4,000.00 MXN (400,000¢)
    const holidayPayCents = 400000;
    const UMA_DIARIA_CENTS_2026 = 11314;
    const maxExemptExpected = 5 * UMA_DIARIA_CENTS_2026; // 56,570¢

    const payroll = {
      baseSalaryCents: 3000000,
      propinasCents: 0,
      holidayPayCents,
    };

    const { desglosePercepciones } = construirDesgloseNomina(payroll);
    const holidayPerception = desglosePercepciones.find(p => p.earningTypeCode === "025");

    expect(holidayPerception).toBeDefined();
    // La mitad de 400,000¢ es 200,000¢, pero debe toparse a 5 UMAs (56,570¢)
    expect(holidayPerception?.exemptAmount).toBe(maxExemptExpected);
    expect(holidayPerception?.taxedAmount).toBe(holidayPayCents - maxExemptExpected);
  });
});
