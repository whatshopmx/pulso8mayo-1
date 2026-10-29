import { seedRandom } from "./seed-scenarios";
import "dotenv/config";
import { db } from "@/lib/db";
import {
  shiftTemplates, plannedShifts, shiftSessions,
  breakLogs, shiftChangeRequests, shiftApprovals, breakReminderLogs,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  COMPANY_ID, BRANCH_CONDESA,
  USER_ADMIN, USER_GERENTE, USER_SUPERVISOR,
  USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3,
  branchForUser,
} from "./seed-constants";
import { seedDate, seedWorkday } from "./seed-scenarios";

function randomDate(daysAgo: number, base?: Date): Date {
  const d = base ? new Date(base) : new Date();
  d.setDate(d.getDate() - Math.floor(seedRandom("06-labor") * daysAgo));
  return d;
}

function randomInt(min: number, max: number): number {
  return Math.floor(seedRandom("06-labor") * (max - min + 1)) + min;
}

const EMPLOYEES = [USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3, USER_SUPERVISOR];

const SHIFT_TEMPLATES_DATA = [
  { name: "Turno Matutino", role: "EMPLEADO", startTime: "07:00", endTime: "15:00", daysOfWeek: [1, 2, 3, 4, 5, 6] },
  { name: "Turno Vespertino", role: "EMPLEADO", startTime: "15:00", endTime: "23:00", daysOfWeek: [1, 2, 3, 4, 5, 6] },
  { name: "Turno Nocturno", role: "EMPLEADO", startTime: "23:00", endTime: "07:00", daysOfWeek: [1, 2, 3, 4, 5, 6] },
  { name: "Turno Supervisor", role: "SUPERVISOR", startTime: "08:00", endTime: "17:00", daysOfWeek: [1, 2, 3, 4, 5, 6] },
];

export async function main() {
  console.log("=== Phase 6: Labor ===");
  console.log("Cleaning up...");

  await db.delete(breakReminderLogs).where(sql`1=1`);
  await db.delete(breakLogs).where(sql`1=1`);
  await db.delete(shiftChangeRequests).where(sql`1=1`);
  await db.delete(shiftApprovals).where(sql`1=1`);
  await db.delete(shiftSessions).where(sql`1=1`);
  await db.delete(plannedShifts).where(eq(plannedShifts.companyId, COMPANY_ID));
  await db.delete(shiftTemplates).where(eq(shiftTemplates.companyId, COMPANY_ID));

  console.log("Inserting shift templates...");
  const tmplRows: { id: string }[] = [];
  for (const st of SHIFT_TEMPLATES_DATA) {
    const [row] = await db.insert(shiftTemplates).values({
      name: st.name,
      companyId: COMPANY_ID,
      role: st.role,
      startTime: st.startTime,
      endTime: st.endTime,
      daysOfWeek: st.daysOfWeek,
      validFrom: "2026-01-01",
      createdBy: USER_ADMIN,
      isActive: true,
    }).returning({ id: shiftTemplates.id });
    tmplRows.push(row);
  }

  console.log("Creating planned shifts (4 employees, 30 days)...");
  const now = new Date();
  const lateDate = seedWorkday(2, now);
  const missedBreakDate = seedWorkday(3, now);
  const overtimeDate = seedWorkday(5, now);
  const noShowDate = seedWorkday(10, now);
  const shiftValues: any[] = [];

  for (let day = 1; day <= 30; day++) {
    const date = seedDate(-day, now);
    const dateStr = date.toISOString().split("T")[0];
    const dayOfWeek = date.getUTCDay();

    for (let e = 0; e < EMPLOYEES.length; e++) {
      const isLateCase = dateStr === lateDate && e === 0;
      const role = EMPLOYEES[e] === USER_SUPERVISOR ? "SUPERVISOR" : "EMPLEADO";
      const templateIdx = EMPLOYEES[e] === USER_SUPERVISOR ? 3 : e % 3;
      const tmpl = SHIFT_TEMPLATES_DATA[templateIdx];

      if (dayOfWeek === 0) continue;
      if (!tmpl.daysOfWeek.includes(dayOfWeek)) continue;

      const start = isLateCase ? "08:30" : tmpl.startTime;
      const end = tmpl.endTime;

      shiftValues.push({
        companyId: COMPANY_ID,
        userId: EMPLOYEES[e],
        branchId: branchForUser(EMPLOYEES[e]),
        shiftDate: dateStr,
        startTime: start,
        endTime: end,
        templateId: tmplRows[templateIdx]?.id,
        role,
        status: "PUBLISHED",
        createdBy: USER_ADMIN,
      });
    }
  }

  const insertedShifts = await db.insert(plannedShifts).values(shiftValues).returning({
    id: plannedShifts.id,
    userId: plannedShifts.userId,
    branchId: plannedShifts.branchId,
    startTime: plannedShifts.startTime,
    endTime: plannedShifts.endTime,
    shiftDate: plannedShifts.shiftDate,
  });
  console.log(`  Created ${insertedShifts.length} planned shifts`);

  console.log("Creating shift sessions with check-in/out...");
  const sessionRows: { id: string; userId: string; branchId: string }[] = [];
  const sessionValues: any[] = [];
  const breakValues: any[] = [];

  const nowMs = now.getTime();
  for (const ps of insertedShifts) {
    const isLateCase = ps.shiftDate === lateDate && ps.userId === USER_EMPLEADO_1;
    const isOvertimeCase = ps.shiftDate === overtimeDate && ps.userId === USER_EMPLEADO_2;
    const isNoShow = ps.shiftDate === noShowDate && ps.userId === USER_EMPLEADO_3;
    const isMissedBreak = ps.shiftDate === missedBreakDate && ps.userId === USER_EMPLEADO_1;

    if (isNoShow) {
      sessionValues.push({
        plannedShiftId: ps.id,
        userId: ps.userId,
        branchId: ps.branchId,
        status: "NO_SHOW",
        scheduledStartTime: ps.startTime,
        scheduledEndTime: ps.endTime,
        startedAt: new Date(ps.shiftDate + "T" + ps.startTime + ":00-06:00"),
        notes: "Falta sin justificación",
      });
      continue;
    }

    const [hours] = ps.startTime.split(":").map(Number);
    const [endHours] = ps.endTime.split(":").map(Number);

    const scheduledStart = new Date(ps.shiftDate + "T" + ps.startTime + ":00-06:00");
    const checkInTime = new Date(scheduledStart.getTime() + (isLateCase ? 5 : 0) * 60000);
    let checkOutTime = new Date(ps.shiftDate + "T" + ps.endTime + ":00-06:00");
    if (endHours < hours) checkOutTime = new Date(checkOutTime.getTime() + 86400000);

    if (isOvertimeCase) {
      checkOutTime = new Date(checkOutTime.getTime() + 2 * 3600000);
    }

    const totalMinutes = (checkOutTime.getTime() - checkInTime.getTime()) / 60000;
    const breakMinutes = isMissedBreak ? 0 : randomInt(30, 60);
    const overtimeMinutes = isOvertimeCase ? 120 : 0;
    const lateMinutes = Math.max(0, Math.round((checkInTime.getTime() - scheduledStart.getTime()) / 60000));

    sessionValues.push({
      plannedShiftId: ps.id,
      userId: ps.userId,
      branchId: ps.branchId,
      status: "COMPLETED",
      scheduledStartTime: ps.startTime,
      scheduledEndTime: ps.endTime,
      checkInTime,
      checkOutTime,
      startedAt: checkInTime,
      endedAt: checkOutTime,
      totalBreakMinutes: breakMinutes,
      totalWorkMinutes: Math.round(totalMinutes - breakMinutes),
      overtimeMinutes,
      lateMinutes,
      complianceFlags: {
        lateCheckIn: isLateCase,
        missedBreak: isMissedBreak,
        overtime: isOvertimeCase,
      } as unknown as Record<string, unknown>,
      requiresApproval: isOvertimeCase || isLateCase,
      approvedBy: isLateCase ? USER_GERENTE : null,
      approvedAt: isLateCase ? new Date() : null,
      notes: isOvertimeCase ? "Horas extra por evento especial" : isLateCase ? "Retraso justificado - tráfico" : null,
    });
  }

  const insertedSessions = await db.insert(shiftSessions).values(sessionValues).returning({
    id: shiftSessions.id,
    userId: shiftSessions.userId,
    branchId: shiftSessions.branchId,
  });

  for (let i = 0; i < insertedSessions.length; i++) {
    sessionRows.push(insertedSessions[i]);
    const ps = insertedShifts[i];
    if (!ps) continue;
    if (sessionValues[i].status === "NO_SHOW") continue;
    const checkInTime = sessionValues[i].checkInTime as Date;
    const breakMinutes = sessionValues[i].totalBreakMinutes as number;
    if (breakMinutes > 0) {
      const breakStart = new Date(checkInTime.getTime() + 4 * 3600000);
      breakValues.push({
        sessionId: insertedSessions[i].id,
        startTime: breakStart,
        endTime: new Date(breakStart.getTime() + breakMinutes * 60000),
        durationMinutes: breakMinutes,
        type: "MEAL",
        isCompliant: true,
      });
    } else {
      breakValues.push({
        sessionId: insertedSessions[i].id,
        startTime: new Date(checkInTime.getTime() + 4 * 3600000),
        endTime: new Date(checkInTime.getTime() + 4 * 3600000),
        durationMinutes: 0,
        type: "MEAL",
        isCompliant: false,
        complianceNotes: "No se tomó descanso reglamentario",
      });
    }
  }

  if (breakValues.length > 0) {
    await db.insert(breakLogs).values(breakValues);
  }
  console.log(`  Created ${sessionRows.length} sessions with breaks`);

  console.log("Creating shift change requests...");
  const pendingReqDate = new Date(nowMs - 1 * 86400000).toISOString().split("T")[0];
  const pendingShift = insertedShifts.find(s => s.shiftDate === pendingReqDate && s.userId === USER_EMPLEADO_1);
  const targetShift = insertedShifts.find(s => s.shiftDate === pendingReqDate && s.userId === USER_EMPLEADO_2);

  if (pendingShift && targetShift) {
    await db.insert(shiftChangeRequests).values({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_EMPLEADO_1,
      requestedShiftId: pendingShift.id,
      targetShiftId: targetShift.id,
      counterpartyId: USER_EMPLEADO_2,
      counterpartyShiftId: targetShift.id,
      reason: "Cita médica familiar",
      status: "PENDING",
      notes: "Solicito intercambio para el turno del día siguiente",
    });
  }

  const approvedReqDate = new Date(nowMs - 7 * 86400000).toISOString().split("T")[0];
  const approvedShift1 = insertedShifts.find(s => s.shiftDate === approvedReqDate && s.userId === USER_EMPLEADO_1);
  const approvedShift2 = insertedShifts.find(s => s.shiftDate === approvedReqDate && s.userId === USER_EMPLEADO_3);

  if (approvedShift1 && approvedShift2) {
    await db.insert(shiftChangeRequests).values({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      requestedBy: USER_EMPLEADO_1,
      requestedShiftId: approvedShift1.id,
      targetShiftId: approvedShift2.id,
      counterpartyId: USER_EMPLEADO_3,
      counterpartyShiftId: approvedShift2.id,
      reason: "Evento escolar",
      status: "APPROVED",
      approvedBy: USER_GERENTE,
      approvedAt: randomDate(8),
      counterpartyAccepted: true,
      counterpartyResponseAt: randomDate(8),
      notes: "Aprobado - intercambio autorizado",
    });
  }

  console.log("Creating shift approvals (overtime)...");
  const overtimeIndex = insertedShifts.findIndex(s => s.userId === USER_EMPLEADO_2 && s.shiftDate === overtimeDate);
  const overtimeSession = sessionRows[overtimeIndex];
  const overtimeShift = insertedShifts[overtimeIndex];

  if (overtimeSession && overtimeShift) {
    await db.insert(shiftApprovals).values({
      companyId: COMPANY_ID,
      branchId: overtimeSession.branchId,
      approvalType: "OVERTIME",
      requestedBy: USER_EMPLEADO_2,
      requestedFor: USER_EMPLEADO_2,
      shiftSessionId: overtimeSession.id,
      plannedShiftId: overtimeShift.id,
      title: "Horas extra - Evento especial",
      description: "Se requirieron 2 horas adicionales para cubrir evento de cena privada",
      reason: "Cubrir evento especial",
      overtimeMinutes: 120,
      status: "APPROVED",
      approvedBy: USER_GERENTE,
      approvedAt: new Date(sessionValues[overtimeIndex].checkOutTime.getTime() + 3600000),
    });
  }

  const lateIndex = insertedShifts.findIndex(s => s.userId === USER_EMPLEADO_1 && s.shiftDate === lateDate);
  const lateSession = sessionRows[lateIndex];
  const lateShift = insertedShifts[lateIndex];

  if (lateSession && lateShift) {
    await db.insert(shiftApprovals).values({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      approvalType: "SCHEDULE_CHANGE",
      requestedBy: USER_EMPLEADO_1,
      requestedFor: USER_EMPLEADO_1,
      shiftSessionId: lateSession.id,
      plannedShiftId: lateShift.id,
      title: "Retraso - Tráfico",
      description: "Llegué 5 minutos tarde por accidente en Periférico",
      reason: "Accidente vial",
      durationMinutes: 5,
      status: "APPROVED",
      approvedBy: USER_GERENTE,
      approvedAt: new Date(sessionValues[lateIndex].checkOutTime.getTime() + 3600000),
    });
  }

  console.log("Creating break reminder logs...");
  const reminderValues: any[] = [];
  const missedBreakIndex = insertedShifts.findIndex(s => s.userId === USER_EMPLEADO_1 && s.shiftDate === missedBreakDate);
  const missedBreakSession = sessionRows[missedBreakIndex];
  if (missedBreakSession) {
    reminderValues.push({
      sessionId: missedBreakSession.id,
      userId: USER_EMPLEADO_1,
      branchId: BRANCH_CONDESA,
      reminderType: "BREAK_DUE",
      message: "Recordatorio: Debes tomar tu descanso reglamentario de 30 minutos",
      channel: "WHATSAPP",
      sentAt: randomDate(3),
      acknowledged: false,
    });
  }

  for (let r = 0; r < 3; r++) {
    const sess = sessionRows[r];
    if (!sess) continue;
    reminderValues.push({
      sessionId: sess.id,
      userId: sess.userId,
      branchId: sess.branchId,
      reminderType: "MEAL_BREAK",
      message: "Recordatorio: Tiempo de comida - 30 minutos mínimo",
      channel: "IN_APP",
      sentAt: randomDate(5),
      acknowledged: true,
      acknowledgedAt: randomDate(4),
    });
  }
  if (reminderValues.length > 0) {
    await db.insert(breakReminderLogs).values(reminderValues);
  }

  console.log("Phase 6 complete!");
}

if (process.argv[1]?.includes("seed-06-labor")) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error("Labor seed failed:", err);
    process.exit(1);
  });
}
