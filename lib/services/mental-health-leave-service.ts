/**
 * Mental Health Leave Service
 * 
 * Manages paid mental health leave requests (up to 7 days per year)
 * with strict privacy protection for medical diagnostic details under Mexican LFT 2026.
 */

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
  }): { success: boolean; request?: MentalHealthLeaveRequest; message: string } {
    const priorUsed = input.priorDaysUsedThisYear || 0;
    const available = this.MAX_ANNUAL_PAID_MENTAL_DAYS - priorUsed;

    if (input.daysRequested <= 0) {
      return { success: false, message: 'El número de días solicitados debe ser mayor a 0.' };
    }

    if (input.daysRequested > available) {
      return {
        success: false,
        message: `La solicitud de ${input.daysRequested} días excede los días disponibles (${available} días de los ${this.MAX_ANNUAL_PAID_MENTAL_DAYS} permitidos al año).`,
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

    return {
      success: true,
      request,
      message: `Permiso remunerado por salud mental aprobado por ${input.daysRequested} día(s). Protegido bajo cláusula de privacidad de diagnóstico LFT.`,
    };
  }
}
