import { inngest } from "@/lib/inngest/client";
import { ShiftService } from "@/lib/services/shift-service";
import { ShiftWorkflowService } from "@/lib/services/shift-workflow-service";
import { WorkflowExecutionService } from "@/lib/services/workflow-execution-service";
import { SmartLinkService } from "@/lib/services/smart-link-service";
import { WhatsAppService } from "@/lib/services/whatsapp-service";
import { db } from "@/lib/db";
import { shiftSessions, breakLogs } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";

export const handleClockInWorkflowFn = inngest.createFunction(
  {
    id: "handle-clock-in",
    triggers: [{ event: "shift/clock-in.requested" }],
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId, branchId, phoneNumber, geolocation } = event.data;

    const shiftContext = await step.run("get-shift-workflow", async () => {
      return await ShiftWorkflowService.getTodayShiftWorkflow(userId, branchId);
    });

    const clockInResult = await step.run("register-clock-in", async () => {
      const context = shiftContext;
      if (context?.plannedShift) {
        const session = await ShiftWorkflowService.createShiftSessionFromPlannedShift(
          context.plannedShift.id,
          userId,
          branchId
        );

        if (session && geolocation) {
          await db.update(shiftSessions)
            .set({
              checkInGeolocation: {
                latitude: geolocation.latitude,
                longitude: geolocation.longitude,
                accuracy: geolocation.accuracy,
                timestamp: Date.now(),
              },
              checkInTime: new Date(),
            })
            .where(eq(shiftSessions.id, session.id));
        }

        return { session, plannedShift: context.plannedShift, workflowTemplate: context.workflowTemplate };
      } else {
        const session = await ShiftService.clockInV2(userId, branchId, new Date());
        return { session, plannedShift: null, workflowTemplate: null };
      }
    });

    if (!clockInResult.session) {
      await step.run("send-error", async () => {
        await WhatsAppService.sendMessage(
          phoneNumber,
          "⚠️ Error al registrar entrada. Ya tienes una sesión activa o no hay turno planificado."
        );
      });
      return;
    }

    const session = clockInResult.session;
    const startTime = new Date(session.checkInTime || session.startedAt);
    const workflowTemplate = clockInResult.workflowTemplate || shiftContext?.workflowTemplate;

    if (workflowTemplate) {
      const instance = await step.run("create-workflow-instance", async () => {
        return await WorkflowExecutionService.createExecution(
          workflowTemplate.id,
          branchId,
          userId,
          session.id
        );
      });

      if (instance) {
        const link = await step.run("generate-smart-link", async () => {
          return await SmartLinkService.createSmartLink(instance.id, workflowTemplate.id, session.id);
        });

        if (link) {
          await step.run("send-whatsapp", async () => {
            const message =
              `✅ *Entrada Registrada*\n\n` +
              `⏰ Hora: ${startTime.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}\n` +
              `📋 Turno: ${shiftContext?.plannedShift?.startTime || "N/A"} - ${shiftContext?.plannedShift?.endTime || "N/A"}\n\n` +
              `Tu workflow de turno es: *${workflowTemplate.name}*\n\n` +
              `Completa tu workflow aquí:\n${link.url}`;
            await WhatsAppService.sendMessage(phoneNumber, message);
          });
          return;
        }
      }
    }

    await step.run("send-confirmation", async () => {
      const message =
        `✅ *Entrada Registrada*\n\n` +
        `⏰ Hora: ${startTime.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}\n` +
        `📋 Turno: ${shiftContext?.plannedShift?.startTime || "N/A"} - ${shiftContext?.plannedShift?.endTime || "N/A"}\n\n` +
        `No hay workflow asignado para este turno.`;
      await WhatsAppService.sendMessage(phoneNumber, message);
    });
  }
);

export const handleClockOutWorkflowFn = inngest.createFunction(
  {
    id: "handle-clock-out",
    triggers: [{ event: "shift/clock-out.requested" }],
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId, phoneNumber, geolocation } = event.data;

    const result = await step.run("end-session", async () => {
      try {
        const session = await ShiftWorkflowService.getActiveSession(userId);

        if (!session) {
          return { success: false, error: "No active session found" };
        }

        if (geolocation) {
          await db.update(shiftSessions)
            .set({
              checkOutGeolocation: {
                latitude: geolocation.latitude,
                longitude: geolocation.longitude,
                accuracy: geolocation.accuracy,
                timestamp: Date.now(),
              },
              checkOutTime: new Date(),
            })
            .where(eq(shiftSessions.id, session.id));
        }

        const updatedSession = await ShiftService.endSession(userId);
        return { success: true, session: updatedSession };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });

    if (!result.success) {
      await step.run("send-error", async () => {
        await WhatsAppService.sendMessage(phoneNumber, `⚠️ No se pudo registrar salida: ${(result as any).error}`);
      });
      return;
    }

    await step.run("send-summary", async () => {
      const session = (result as any).session;
      const workHours = Math.floor((session.totalWorkMinutes || 0) / 60);
      const workMins = (session.totalWorkMinutes || 0) % 60;

      let message = `✅ *Salida Registrada*\n\n`;
      message += `⏱️ Tiempo total: ${workHours}h ${workMins}m\n`;

      if (session.overtimeMinutes && session.overtimeMinutes > 0) {
        const otHours = Math.floor(session.overtimeMinutes / 60);
        const otMins = session.overtimeMinutes % 60;
        message += `⚡ Horas extras: ${otHours}h ${otMins}m\n`;
      }

      if (session.totalBreakMinutes && session.totalBreakMinutes > 0) {
        const breakHours = Math.floor(session.totalBreakMinutes / 60);
        const breakMins = session.totalBreakMinutes % 60;
        message += `☕ Pausas: ${breakHours}h ${breakMins}m\n`;
      }

      if (session.complianceFlags) {
        const flags = session.complianceFlags as any;
        if (flags.lateCheckIn) message += `⚠️ Llegada tarde\n`;
        if (flags.earlyCheckOut) message += `⚠️ Salida temprana\n`;
        if (flags.missedBreak) message += `⚠️ No tomó pausa\n`;
      }

      message += `\n¡Gracias por tu esfuerzo! 👏`;
      await WhatsAppService.sendMessage(phoneNumber, message);
    });
  }
);

export const handleBreakStartWorkflowFn = inngest.createFunction(
  {
    id: "handle-break-start",
    triggers: [{ event: "shift/break.start.requested" }],
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId, phoneNumber, geolocation } = event.data;

    const result = await step.run("start-break", async () => {
      try {
        const session = await ShiftWorkflowService.getActiveSession(userId);

        if (!session) {
          return { success: false, error: "No hay sesión activa. Registra tu entrada primero." };
        }

        const activeBreak = await db.query.breakLogs.findFirst({
          where: and(eq(breakLogs.sessionId, session.id), isNull(breakLogs.endTime)),
        });

        if (activeBreak) {
          return {
            success: false,
            error: "Ya estás en pausa. Para terminar la pausa, envía: fin pausa",
          };
        }

        const [log] = await db.insert(breakLogs).values({
          sessionId: session.id,
          startTime: new Date(),
          type: "MEAL",
        }).returning();

        return { success: true, log };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });

    if (!result.success) {
      await step.run("send-error", async () => {
        await WhatsAppService.sendMessage(phoneNumber, `⚠️ No se pudo iniciar pausa: ${(result as any).error}`);
      });
      return;
    }

    const breakStartTime = (result as any).log.startTime.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });

    await step.run("send-confirmation", async () => {
      await WhatsAppService.sendMessage(
        phoneNumber,
        `☕ *Pausa Iniciada*\n\n` +
          `⏰ Hora: ${breakStartTime}\n` +
          `⏱️ Duración máxima: 30 minutos\n\n` +
          `Envía *fin pausa* cuando regreses.`
      );
    });

    await step.sleep("wait-30m", "30m");

    const stillOnBreak = await step.run("check-break-status", async () => {
      const session = await ShiftWorkflowService.getActiveSession(userId);
      if (!session) return false;

      const activeBreak = await db.query.breakLogs.findFirst({
        where: and(eq(breakLogs.sessionId, session.id), isNull(breakLogs.endTime)),
      });

      return !!activeBreak;
    });

    if (stillOnBreak) {
      await step.run("send-reminder", async () => {
        await WhatsAppService.sendMessage(
          phoneNumber,
          `⚠️ *Recordatorio*: Ya pasaron 30 minutos de tu pausa.\n\nEnvía *fin pausa* para regresar.`
        );
      });
    }
  }
);

export const handleBreakEndWorkflowFn = inngest.createFunction(
  {
    id: "handle-break-end",
    triggers: [{ event: "shift/break.end.requested" }],
    retries: 2,
  },
  async ({ event, step }) => {
    const { userId, phoneNumber, geolocation } = event.data;

    const result = await step.run("end-break", async () => {
      try {
        const session = await ShiftWorkflowService.getActiveSession(userId);

        if (!session) {
          return { success: false, error: "No hay sesión activa" };
        }

        const activeBreak = await db.query.breakLogs.findFirst({
          where: and(eq(breakLogs.sessionId, session.id), isNull(breakLogs.endTime)),
        });

        if (!activeBreak) {
          return {
            success: false,
            error: "No hay una pausa activa. Para iniciar una pausa, envía: inicio pausa",
          };
        }

        const endTime = new Date();
        const durationMs = endTime.getTime() - activeBreak.startTime.getTime();
        const durationMinutes = Math.floor(durationMs / 60000);

        const [log] = await db.update(breakLogs)
          .set({ endTime, durationMinutes })
          .where(eq(breakLogs.id, activeBreak.id))
          .returning();

        const currentBreakTotal = session.totalBreakMinutes || 0;
        await db.update(shiftSessions)
          .set({ totalBreakMinutes: currentBreakTotal + durationMinutes })
          .where(eq(shiftSessions.id, session.id));

        return { success: true, log, durationMinutes };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });

    if (!result.success) {
      await step.run("send-error", async () => {
        await WhatsAppService.sendMessage(phoneNumber, `⚠️ No se pudo finalizar pausa: ${(result as any).error}`);
      });
      return;
    }

    await step.run("send-confirmation", async () => {
      const endTimeStr = new Date().toLocaleTimeString("es-MX", {
        hour: "2-digit",
        minute: "2-digit",
      });

      await WhatsAppService.sendMessage(
        phoneNumber,
        `✅ *Pausa Finalizada*\n\n` +
          `⏰ Hora: ${endTimeStr}\n` +
          `⏱️ Duración: ${(result as any).durationMinutes} minutos\n\n` +
          `¡A trabajar! 💪`
      );
    });
  }
);
