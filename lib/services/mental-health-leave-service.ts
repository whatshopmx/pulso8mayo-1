/**
 * Mental Health Leave Service
 * 
 * Manages paid mental health leave requests (up to 7 days per year)
 * with strict privacy protection for medical diagnostic details under Mexican LFT 2026.
 *
 * ESTATUS LEGAL (Task 4 — catálogo LICENCIAS_SALUD_MENTAL): la licencia
 * remunerada de 7 días/año NO es ley a oct-2026 (12+ iniciativas en el
 * Congreso, ninguna aprobada). El servicio opera como PROYECCIÓN con
 * legalStatus en su output: nunca desembolsar como obligación.
 */

import { getReformStatus } from '@/lib/company/labor-reform-status-catalog';

export interface MentalHealthLeaveRequest {
  id: string;
  userId: string;
  companyId: string;
  daysRequested: number; // 1 to 7 days
  startDate: string; // ISO date
  endDate: string; // ISO date
  hasMedicalCertificate: boolean;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  privacyShielded: boolean; // Employer prohibited from inquiring diagnosis
  createdAt: string;
}

export class MentalHealthLeaveService {
  private static MAX_ANNUAL_PAID_MENTAL_DAYS = 7;

  /**
   * Validate and submit a mental health leave request.
   */
  static requestMentalHealthLeave(input: {
    userId: string;
    companyId: string;
    daysRequested: number;
    startDate: Date;
    hasMedicalCertificate: boolean;
    priorDaysUsedThisYear?: number;
  }): { success: boolean; request?: MentalHealthLeaveRequest; message: string; legalStatus: string; legalBasisNote: string } {
    const priorUsed = input.priorDaysUsedThisYear || 0;
    const available = this.MAX_ANNUAL_PAID_MENTAL_DAYS - priorUsed;
    const reformStatus = getReformStatus('LICENCIAS_SALUD_MENTAL');
    // Proyección: la licencia 7d/año NO es ley (iniciativas pendientes).
    const legalStatus = reformStatus?.status ?? 'PENDING_INITIATIVE';
    const legalBasisNote =
      reformStatus?.basis ?? 'Iniciativas en el Congreso; NO vigente a oct-2026.';

    if (input.daysRequested <= 0) {
      return {
        success: false,
        message: 'El número de días solicitados debe ser mayor a 0.',
        legalStatus,
        legalBasisNote,
      };
    }

    if (input.daysRequested > available) {
      return {
        success: false,
        message: `La solicitud de ${input.daysRequested} días excede los días disponibles (${available} días de los ${this.MAX_ANNUAL_PAID_MENTAL_DAYS} permitidos al año).`,
        legalStatus,
        legalBasisNote,
      };
    }

    const startDate = new Date(input.startDate);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + input.daysRequested - 1);

    const request: MentalHealthLeaveRequest = {
      id: crypto.randomUUID(),
      userId: input.userId,
      companyId: input.companyId,
      daysRequested: input.daysRequested,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      hasMedicalCertificate: input.hasMedicalCertificate,
      status: 'APPROVED', // Auto-approved upon valid certificate / LFT entitlement
      privacyShielded: true,
      createdAt: new Date().toISOString(),
    };

    const originalMessage = `Permiso remunerado por salud mental aprobado por ${input.daysRequested} día(s). Protegido bajo cláusula de privacidad de diagnóstico LFT.`;
    return {
      success: true,
      request,
      message: originalMessage,
      legalStatus,
      legalBasisNote,
    };
  }
}
