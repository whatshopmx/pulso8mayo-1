import { describe, it, expect } from "vitest";
import { OffHoursEventService } from "../services/off-hours-event-service";
import { calculateLFT2026Benefits, DEFAULT_LFT2026_BENEFITS } from "../services/payroll-service";
import { AISeveranceCalculator } from "../services/ai-severance-calculator";
import { AIService } from "../services/ai-service";

describe("Batch 3: Task 7 - Off-Hours Event Service & Desconexión Digital", () => {
  it("schedules mandatory off-hours activity on rest day with +50% surcharge and compensatory rest", () => {
    const result = OffHoursEventService.scheduleOffHoursEvent({
      companyId: "comp-1",
      branchId: "branch-1",
      userId: "user-1",
      eventTitle: "Inventario Mensual de Cierre",
      eventDate: new Date("2026-09-25"),
      hoursSpent: 6,
      isRestDayEvent: true,
      justificationByEmployer: "Cierre anual de inventarios físicos auditoría",
    });

    expect(result.success).toBe(true);
    expect(result.event.extraSurchargeRate).toBe(1.5);
    expect(result.event.compensatoryRestStatus).toBe("PENDING_SELECTION");
    expect(result.summaryMessage).toContain("sobreprecio del 50% extra");
  });

  it("validates compensatory rest date selection within the 30-day window", () => {
    const eventDate = new Date("2026-09-25");
    const validRestDate = new Date("2026-10-10"); // 15 days later
    const invalidRestDate = new Date("2026-11-15"); // 51 days later (> 30 days)

    const validSelection = OffHoursEventService.selectCompensatoryRestDate("evt-1", validRestDate, eventDate);
    expect(validSelection.success).toBe(true);

    const invalidSelection = OffHoursEventService.selectCompensatoryRestDate("evt-1", invalidRestDate, eventDate);
    expect(invalidSelection.success).toBe(false);
    expect(invalidSelection.message).toContain("30 días naturales");
  });
});

describe("Batch 3: Task 8 - LFT 2026 Benefits Calculator (Aguinaldo 30d, Prima Vacacional 50%)", () => {
  it("calculates statutory benefits under LFT 2026 progressive reform guidelines", () => {
    const dailySalary = 500; // $500 MXN / day
    const tenureYears = 3;

    const benefits = calculateLFT2026Benefits(dailySalary, tenureYears, DEFAULT_LFT2026_BENEFITS);

    expect(benefits.aguinaldoAmount).toBe(15000); // 30 days * $500
    expect(benefits.vacationDays).toBe(16); // 12 + 2*2 = 16 days for year 3
    expect(benefits.vacationBonusAmount).toBe(4000); // (16 * $500) * 50% = $4000
    expect(benefits.totalAnnualBenefitsCost).toBe(19000);
  });
});

describe("Batch 3: Task 9 - AI Severance Calculator & AI Transparency Log", () => {
  it("calculates statutory severance with 5 months total indemnity when position is substituted by AI", () => {
    const calculation = AISeveranceCalculator.calculateSeverance({
      dailyIntegratedSalaryMXN: 600,
      tenureYears: 2,
      isAiReplacement: true,
    });

    expect(calculation.constitutionalIndemnityMXN).toBe(54000); // 90 days * $600
    expect(calculation.aiReplacementPremiumMXN).toBe(36000); // 60 days * $600 (2 extra months)
    expect(calculation.breakdown.baseMonthsIndemnity).toBe(5);
    expect(calculation.breakdown.legalNote).toContain("Inteligencia Artificial");
  });

  it("calculates standard 3-month severance when termination is not AI replacement", () => {
    const calculation = AISeveranceCalculator.calculateSeverance({
      dailyIntegratedSalaryMXN: 600,
      tenureYears: 2,
      isAiReplacement: false,
    });

    expect(calculation.constitutionalIndemnityMXN).toBe(54000);
    expect(calculation.aiReplacementPremiumMXN).toBe(0);
    expect(calculation.breakdown.baseMonthsIndemnity).toBe(3);
  });

  it("logs transparent disclosure event for AI-driven decisions", () => {
    const log = AIService.logAiTransparencyEvent({
      action: "WORKFLOW_IMAGE_VERIFICATION",
      modelUsed: "moondream",
      confidenceScore: 92,
      userId: "user-789",
    });

    expect(log.transparentDisclosure).toBe(true);
    expect(log.legalCompliance).toBe("LFT-2026-AI-TRANSPARENCY");
  });
});
