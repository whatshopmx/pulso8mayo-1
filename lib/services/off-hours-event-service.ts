/**
 * Off-Hours Event Service (LFT Reform 2026 - Actividades Complementarias Fuera de Jornada)
 * 
 * Manages off-hours convocations (inventories, trainings, corporate events)
 * applying mandatory +50% extra rate / overtime computation and tracking 
 * compensatory rest days to be taken within 30 calendar days.
 */

export interface OffHoursEventRequest {
  id: string;
  companyId: string;
  branchId: string;
  userId: string;
  eventTitle: string; // "Inventario Mensual", "Capacitación NOM-251"
  eventDate: string; // ISO date
  hoursSpent: number;
  isRestDayEvent: boolean;
  extraSurchargeRate: number; // 1.5 (+50%) for rest days, plus double/triple OT rates
  compensatoryRestChosenDate?: string;
  compensatoryRestStatus: 'PENDING_SELECTION' | 'SCHEDULED' | 'TAKEN' | 'EXPIRED';
  justificationByEmployer: string;
  createdAt: string;
}

export class OffHoursEventService {
  /**
   * Schedule a mandatory off-hours activity and calculate required compensation.
   */
  static scheduleOffHoursEvent(input: {
    companyId: string;
    branchId: string;
    userId: string;
    eventTitle: string;
    eventDate: Date;
    hoursSpent: number;
    isRestDayEvent: boolean;
    justificationByEmployer: string;
  }): { success: boolean; event: OffHoursEventRequest; summaryMessage: string } {
    const eventDateStr = input.eventDate.toISOString().split('T')[0];
    const surcharge = input.isRestDayEvent ? 1.5 : 1.0;

    const event: OffHoursEventRequest = {
      id: crypto.randomUUID(),
      companyId: input.companyId,
      branchId: input.branchId,
      userId: input.userId,
      eventTitle: input.eventTitle,
      eventDate: eventDateStr,
      hoursSpent: input.hoursSpent,
      isRestDayEvent: input.isRestDayEvent,
      extraSurchargeRate: surcharge,
      compensatoryRestStatus: input.isRestDayEvent ? 'PENDING_SELECTION' : 'SCHEDULED',
      justificationByEmployer: input.justificationByEmployer,
      createdAt: new Date().toISOString(),
    };

    const summaryMessage = input.isRestDayEvent
      ? `Evento fuera de jornada convocado el día de descanso. Se aplica un sobreprecio del 50% extra (o tarifa extra LFT) y el colaborador tiene derecho a 1 día de descanso compensatorio elegible dentro de 30 días.`
      : `Actividad complementaria fuera de jornada registrada (${input.hoursSpent}h) como tiempo extraordinario.`;

    return {
      success: true,
      event,
      summaryMessage,
    };
  }

  /**
   * Select compensatory rest date for an off-hours event within 30 days window.
   */
  static selectCompensatoryRestDate(
    eventId: string,
    chosenDate: Date,
    eventDate: Date
  ): { success: boolean; message: string } {
    const diffTime = Math.abs(chosenDate.getTime() - eventDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 30) {
      return {
        success: false,
        message: 'El día de descanso compensatorio debe ser tomado dentro de los 30 días naturales posteriores al evento.',
      };
    }

    return {
      success: true,
      message: `Día de descanso compensatorio agendado con éxito para el ${chosenDate.toISOString().split('T')[0]}.`,
    };
  }
}
