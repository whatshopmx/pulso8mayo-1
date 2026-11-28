import { describe, expect, it } from "vitest";
import {
  ABSENCE_EXCEPTION_SUBJECT_TYPE,
  appendAbsenceHistory,
  buildAbsenceAuditReason,
  buildAbsenceExceptionInput,
  classifyShiftAbsenceState,
  resolveAbsenceOwnerId,
} from "../absence-exception-rules";
import { resolveAttendanceForPeriod } from "../payroll-service";

describe("EXC-04.ausencia — Reglas puras de ausencia y alineación NOM-02.a (V1)", () => {
  it("distingue falta aprobada de asistencia pendiente y de permiso/vacación aprobada", () => {
    // 1. Falta aprobada (NO_SHOW confirmado)
    const approvedAbsence = classifyShiftAbsenceState({
      status: "NO_SHOW",
      requiresApproval: false,
      approvedAt: new Date("2026-11-26T18:00:00Z"),
      sessionDate: "2026-11-26",
    });
    expect(approvedAbsence.classification).toBe("APPROVED_ABSENCE");
    expect(approvedAbsence.isApprovedAbsence).toBe(true);
    expect(approvedAbsence.isPendingAttendance).toBe(false);
    expect(approvedAbsence.shouldRaiseException).toBe(true);
    expect(approvedAbsence.payrollImpact).toBe("DEDUCT_UNPAID_ABSENCE");

    // 2. NO_SHOW pendiente de aprobación de manager (NO es falta aprobada aún)
    const pendingReview = classifyShiftAbsenceState({
      status: "NO_SHOW",
      requiresApproval: true,
      approvedAt: null,
      sessionDate: "2026-11-26",
    });
    expect(pendingReview.classification).toBe("PENDING_ABSENCE_REVIEW");
    expect(pendingReview.isApprovedAbsence).toBe(false);
    expect(pendingReview.isPendingAttendance).toBe(true);
    expect(pendingReview.shouldRaiseException).toBe(true);
    expect(pendingReview.payrollImpact).toBe("BLOCK_PENDING_ATTENDANCE");

    // 3. Asistencia pendiente (PENDING / ACTIVE / COMPLETED sin aprobar)
    for (const sample of [
      { status: "PENDING", requiresApproval: false, approvedAt: null },
      { status: "ACTIVE", requiresApproval: false, approvedAt: null },
      { status: "COMPLETED", requiresApproval: true, approvedAt: null },
    ]) {
      const res = classifyShiftAbsenceState({
        ...sample,
        sessionDate: "2026-11-26",
      });
      expect(res.classification).toBe("PENDING_ATTENDANCE");
      expect(res.isApprovedAbsence).toBe(false);
      expect(res.isPendingAttendance).toBe(true);
      expect(res.shouldRaiseException).toBe(false);
    }

    // 4. Día cubierto por permiso o vacación APPROVED no genera falta injustificada
    const covered = classifyShiftAbsenceState({
      status: "NO_SHOW",
      requiresApproval: false,
      approvedAt: null,
      sessionDate: "2026-11-26",
      approvedLeaveRanges: [
        { startDate: "2026-11-25", endDate: "2026-11-27", status: "APPROVED" },
      ],
    });
    expect(covered.classification).toBe("COVERED_BY_APPROVED_LEAVE");
    expect(covered.isApprovedAbsence).toBe(false);
    expect(covered.shouldRaiseException).toBe(false);
  });

  it("NOM-02.a distingue estrictamente falta aprobada vs NO_SHOW pendiente de aprobación", async () => {
    const res = await resolveAttendanceForPeriod({
      userId: "emp-1",
      companyId: "comp-1",
      startDate: "2026-05-01",
      endDate: "2026-05-15",
      sessions: [
        // Falta aprobada -> descuenta 1 día
        {
          id: "s-approved-absence",
          startedAt: "2026-05-04T15:00:00Z",
          status: "NO_SHOW",
          requiresApproval: false,
          approvedAt: new Date("2026-05-04T20:00:00Z"),
        },
        // NO_SHOW pendiente de confirmación -> bloquea como asistencia pendiente, NO descuenta todavía
        {
          id: "s-pending-absence",
          startedAt: "2026-05-05T15:00:00Z",
          status: "NO_SHOW",
          requiresApproval: true,
          approvedAt: null,
        },
        // Sesión PENDING normal -> asistencia pendiente
        {
          id: "s-pending-normal",
          startedAt: "2026-05-06T15:00:00Z",
          status: "PENDING",
          requiresApproval: false,
          approvedAt: null,
        },
      ],
      holidays: [],
      vacations: [],
      leaves: [],
    });

    expect(res.unpaidAbsenceDays).toBe(1);
    expect(res.payableDays).toBe(14);
    expect(res.hasPendingAttendance).toBe(true);
    expect(res.pendingAttendanceDetails).toHaveLength(2);
    expect(res.pendingAttendanceDetails.map((d) => d.sessionId)).toEqual([
      "s-pending-absence",
      "s-pending-normal",
    ]);
    expect(res.pendingAttendanceDetails[0].reason).toContain("pendiente de aprobación");
  });

  it("resolveAbsenceOwnerId prioriza supervisor -> gerente de sucursal -> rol operativo, nunca el empleado ausente", () => {
    const candidates = [
      { id: "emp-1", role: "GERENTE", branchId: "b1", active: true },
      { id: "sup-1", role: "SUPERVISOR", branchId: "b1", active: true },
      { id: "mgr-1", role: "GERENTE", branchId: "b1", active: true },
      { id: "adm-1", role: "ADMIN", branchId: null, active: true },
    ];

    expect(
      resolveAbsenceOwnerId(candidates, {
        branchId: "b1",
        employeeUserId: "emp-1",
        supervisorId: "sup-1",
        branchManagerId: "mgr-1",
      }),
    ).toBe("sup-1");

    // Si el supervisor es el mismo empleado ausente o inactivo, cae en gerente de sucursal
    expect(
      resolveAbsenceOwnerId(candidates, {
        branchId: "b1",
        employeeUserId: "emp-1",
        supervisorId: "emp-1",
        branchManagerId: "mgr-1",
      }),
    ).toBe("mgr-1");

    // Si tampoco hay gerente de sucursal, cae en ADMIN de empresa
    expect(
      resolveAbsenceOwnerId(
        [
          { id: "emp-1", role: "GERENTE", branchId: "b1", active: true },
          { id: "adm-1", role: "ADMIN", branchId: null, active: true },
        ],
        {
          branchId: "b1",
          employeeUserId: "emp-1",
          supervisorId: null,
          branchManagerId: "emp-1",
        },
      ),
    ).toBe("adm-1");
  });

  it("conserva responsable e historial append-only y deduplica detecciones repetidas", () => {
    const clsPending = classifyShiftAbsenceState({
      status: "NO_SHOW",
      requiresApproval: true,
      approvedAt: null,
      sessionDate: "2026-11-26",
    });

    const first = buildAbsenceExceptionInput({
      companyId: "c1",
      branchId: "b1",
      sessionId: "sess-1",
      employeeId: "emp-1",
      employeeName: "Ana López",
      shiftDate: "2026-11-26",
      sourceStatus: "NO_SHOW",
      classification: clsPending,
      ownerId: "sup-1",
      actorId: "sup-1",
      historyEntry: {
        at: "2026-11-26T15:00:00Z",
        event: "DETECTED",
        actorId: "sup-1",
        previousStatus: "PENDING",
        newStatus: "NO_SHOW",
        classification: "PENDING_ABSENCE_REVIEW",
        ownerId: "sup-1",
        reason: "No registró entrada",
      },
    });

    expect(first.subjectType).toBe(ABSENCE_EXCEPTION_SUBJECT_TYPE);
    expect(first.ownerId).toBe("sup-1");
    expect(((first.metadata as Record<string, unknown>).history as unknown[])).toHaveLength(1);

    // Repetir detección idéntica no duplica entrada de historial ni cambia owner
    const repeat = buildAbsenceExceptionInput({
      companyId: "c1",
      branchId: "b1",
      sessionId: "sess-1",
      employeeId: "emp-1",
      employeeName: "Ana López",
      shiftDate: "2026-11-26",
      sourceStatus: "NO_SHOW",
      classification: clsPending,
      ownerId: "other-mgr",
      historyEntry: {
        at: "2026-11-26T15:15:00Z",
        event: "DETECTED",
        actorId: null,
        previousStatus: "NO_SHOW",
        newStatus: "NO_SHOW",
        classification: "PENDING_ABSENCE_REVIEW",
        ownerId: "other-mgr",
        reason: "Barrido repetido",
      },
      existingMetadata: first.metadata as Record<string, unknown>,
      existingOwnerId: "sup-1",
    });

    expect(repeat.ownerId).toBe("sup-1");
    expect(((repeat.metadata as Record<string, unknown>).history as unknown[])).toHaveLength(1);

    // Confirmar falta aprobada agrega entrada al historial conservando el evento previo
    const nextHist = appendAbsenceHistory(
      (repeat.metadata as Record<string, unknown>).history,
      {
        at: "2026-11-26T18:00:00Z",
        event: "APPROVED_ABSENCE",
        actorId: "mgr-1",
        previousStatus: "NO_SHOW",
        newStatus: "NO_SHOW",
        classification: "APPROVED_ABSENCE",
        ownerId: "sup-1",
        reason: "Falta confirmada por gerente",
      },
    );
    expect(nextHist).toHaveLength(2);
    expect(nextHist.map((h) => h.event)).toEqual(["DETECTED", "APPROVED_ABSENCE"]);

    expect(
      buildAbsenceAuditReason({
        action: "REGULARIZE",
        mode: "ATTENDANCE_COMPLETED",
        notes: "",
        sessionId: "sess-1",
      }).length,
    ).toBeGreaterThanOrEqual(4);
  });
});
