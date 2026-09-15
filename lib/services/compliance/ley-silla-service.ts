/**
 * Ley Silla Compliance Service
 * 
 * Manages STPS Ley Silla compliance verification (bipedestación risk evaluation,
 * seat with backrest verification, and RIT pause compliance for HORECA workers).
 */

export interface LeySillaEvaluationInput {
  companyId: string;
  branchId?: string;
  jobRole: string; // Cocinero, Mesero, Cajero, Hostess, Barman, Limpieza
  standingRiskType: 'ESTATICA' | 'DINAMICA' | 'PROLONGADA';
  hoursStandingPerShift: number;
  hasBackrestChair: boolean;
  seatLocation: 'WORKSTATION' | 'ADJACENT_ZONE' | 'REST_ROOM';
  ritPausesConfigured: boolean;
  pauseIntervalMinutes: number;
}

export interface LeySillaAssessmentResult {
  isCompliant: boolean;
  riskScore: number; // 0 (Low Risk) to 100 (High Risk)
  status: 'COMPLIANT' | 'NEEDS_ATTENTION' | 'NON_COMPLIANT';
  violations: string[];
  recommendations: string[];
}

export class LeySillaService {
  /**
   * Evaluate a specific HORECA role for Ley Silla compliance according to STPS guidelines.
   */
  static evaluateRoleCompliance(input: LeySillaEvaluationInput): LeySillaAssessmentResult {
    const violations: string[] = [];
    const recommendations: string[] = [];
    let riskScore = 0;

    // 1. Asiento con respaldo obligatorio
    if (!input.hasBackrestChair) {
      violations.push('Falta de asiento con respaldo en estación o zona cercana (Artículo 132 LFT - Ley Silla)');
      riskScore += 40;
      recommendations.push('Proporcionar sillas altas ergonómicas con respaldo ajustable o apoyos tipo perchero con soporte lumbar.');
    }

    // 2. Evaluación del tipo de bipedestación
    if (input.standingRiskType === 'PROLONGADA' && input.hoursStandingPerShift >= 6) {
      riskScore += 30;
      if (input.pauseIntervalMinutes > 120 || !input.ritPausesConfigured) {
        violations.push('Bipedestación prolongada (>6h) sin pausas RIT configuradas cada 120 min o menos');
        recommendations.push('Actualizar el Reglamento Interior de Trabajo (RIT) registrando pausas activas de 10 min por cada 2h de trabajo continuo.');
      }
    } else if (input.standingRiskType === 'ESTATICA' && input.hoursStandingPerShift >= 4) {
      riskScore += 25;
      recommendations.push('Instalar tapetes antifatiga en estaciones estáticas (Caja / Plancha).');
    }

    // 3. Ubicación del asiento
    if (input.seatLocation === 'REST_ROOM' && input.standingRiskType !== 'DINAMICA') {
      recommendations.push('Ubicar asientos en la misma estación de trabajo si la naturaleza del puesto permite atención sentado alternada.');
    }

    // 4. Estatus final
    let status: 'COMPLIANT' | 'NEEDS_ATTENTION' | 'NON_COMPLIANT' = 'COMPLIANT';
    if (violations.length > 0) {
      status = 'NON_COMPLIANT';
    } else if (riskScore > 20) {
      status = 'NEEDS_ATTENTION';
    }

    return {
      isCompliant: violations.length === 0,
      riskScore,
      status,
      violations,
      recommendations,
    };
  }

  /**
   * Generate STPS Plan Anual de Inspección 2026 readiness summary.
   */
  static generateSTPSAuditSummary(evaluations: LeySillaEvaluationInput[]) {
    const total = evaluations.length;
    const results = evaluations.map(ev => ({ role: ev.jobRole, ...this.evaluateRoleCompliance(ev) }));
    const compliantCount = results.filter(r => r.isCompliant).length;
    const nonCompliantCount = results.filter(r => !r.isCompliant).length;

    return {
      generatedAt: new Date().toISOString(),
      totalRolesEvaluated: total,
      compliantRolesCount: compliantCount,
      nonCompliantRolesCount: nonCompliantCount,
      stpsInspectionReadinessScore: total > 0 ? Math.round((compliantCount / total) * 100) : 100,
      roleResults: results,
    };
  }
}
