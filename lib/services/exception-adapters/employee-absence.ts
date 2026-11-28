/**
 * EXC-04.ausencia — Adaptador de excepciones de ausencia laboral
 * (`shift_sessions.status = 'NO_SHOW'` → `exceptions`, subjectType `employee_absence`).
 *
 * - Distingue falta aprobada (`APPROVED_ABSENCE`) de ausencia pendiente de revisión
 *   (`PENDING_ABSENCE_REVIEW`) y excluye días cubiertos por vacación/permiso aprobado.
 * - Conserva `ownerId` e historial append-only sin duplicar excepciones.
 * - Autorreconcilia sesiones regularizadas (`COMPLETED`/`CANCELLED`) sin reabrir terminales.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { branches, shiftSessions } from "@/lib/db/schema";
import { allowedEvents, isTerminal } from "../exception-lifecycle";
import { ExceptionService } from "../exception-service";
import { ABSENCE_EXCEPTION_SUBJECT_TYPE } from "../absence-exception-rules";
import { detectAbsenceException } from "../absence-exception-service";
import type { AdapterScope, ExceptionAdapter } from "./types";

export const employeeAbsenceAdapter: ExceptionAdapter = {
  subjectType: ABSENCE_EXCEPTION_SUBJECT_TYPE,
  async run({ companyId, branchId }: AdapterScope): Promise<number> {
    const noShowRows = await db
      .select({
        id: shiftSessions.id,
        branchId: shiftSessions.branchId,
      })
      .from(shiftSessions)
      .innerJoin(branches, eq(shiftSessions.branchId, branches.id))
      .where(
        and(
          eq(branches.companyId, companyId),
          eq(shiftSessions.status, "NO_SHOW"),
          branchId ? eq(shiftSessions.branchId, branchId) : undefined,
        ),
      );

    let raised = 0;
    for (const r of noShowRows) {
      const outcome = await detectAbsenceException({
        companyId,
        sessionId: r.id,
      });
      if (outcome.classification.shouldRaiseException && outcome.exception) {
        raised++;
      } else if (
        outcome.classification.classification === "COVERED_BY_APPROVED_LEAVE" &&
        outcome.exception &&
        !isTerminal(outcome.exception.status) &&
        allowedEvents(outcome.exception.status).includes("CANCEL")
      ) {
        await ExceptionService.cancel(
          outcome.exception.id,
          companyId,
          null,
          "Ausencia cubierta por permiso o vacación aprobada.",
          db,
          { expectedStatus: outcome.exception.status },
        ).catch(() => {
          /* ya cerrada concurrentemente */
        });
      }
    }

    // Autorreconciliación: sesiones regularizadas a COMPLETED o CANCELLED
    const regularizedRows = await db
      .select({
        id: shiftSessions.id,
        status: shiftSessions.status,
      })
      .from(shiftSessions)
      .innerJoin(branches, eq(shiftSessions.branchId, branches.id))
      .where(
        and(
          eq(branches.companyId, companyId),
          inArray(shiftSessions.status, ["COMPLETED", "CANCELLED"]),
          branchId ? eq(shiftSessions.branchId, branchId) : undefined,
        ),
      );

    for (const r of regularizedRows) {
      const existing = await ExceptionService.getBySubject(
        companyId,
        ABSENCE_EXCEPTION_SUBJECT_TYPE,
        r.id,
      );
      if (!existing || isTerminal(existing.status)) continue;
      if (!allowedEvents(existing.status).includes("CANCEL")) continue;
      await ExceptionService.cancel(
        existing.id,
        companyId,
        null,
        `Sesión de asistencia regularizada en estado ${r.status}.`,
        db,
        { expectedStatus: existing.status },
      ).catch(() => {
        /* ya cerrada concurrentemente */
      });
    }

    return raised;
  },
};
