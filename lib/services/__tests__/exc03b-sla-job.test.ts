import { describe, expect, it, vi } from "vitest";
import {
  SLA_ESCALATABLE_STATUSES,
  computeSlaDueAt,
  isEligibleForSlaEscalation,
} from "@/lib/services/exception-sla";
import { sweepCompanyExceptionSla } from "@/lib/services/exception-sla-job-service";
import { ExceptionService } from "@/lib/services/exception-service";
import { ApiError } from "@/lib/api/error";
import type { ExceptionStatus } from "@/lib/services/exception-types";

describe("EXC-03.b — Reglas puras y manejo recuperable del job de SLA (V1)", () => {
  const base = new Date("2026-11-26T12:00:00.000Z");

  it("reutiliza computeSlaDueAt/isSlaBreached y excluye estados terminales y ESCALATED", () => {
    const dueHigh = computeSlaDueAt("high", base); // +4h -> 16:00Z
    const beforeDue = new Date("2026-11-26T15:59:59.000Z");
    const afterDue = new Date("2026-11-26T16:00:01.000Z");

    for (const status of SLA_ESCALATABLE_STATUSES) {
      expect(isEligibleForSlaEscalation({ status, slaDueAt: dueHigh }, beforeDue)).toBe(false);
      expect(isEligibleForSlaEscalation({ status, slaDueAt: dueHigh }, afterDue)).toBe(true);
    }

    const nonEscalatable: ExceptionStatus[] = ["ESCALATED", "CLOSED", "CANCELLED"];
    for (const status of nonEscalatable) {
      expect(isEligibleForSlaEscalation({ status, slaDueAt: dueHigh }, afterDue)).toBe(false);
    }

    expect(isEligibleForSlaEscalation({ status: "OPEN", slaDueAt: null }, afterDue)).toBe(false);
  });

  it("maneja 409 concurrente como skippedAlreadyHandled sin abortar el resto del lote", async () => {
    const now = new Date("2026-11-26T18:00:00.000Z");
    const past = new Date("2026-11-26T17:00:00.000Z");

    const rows = [
      { id: "exc-1", companyId: "comp-1", status: "OPEN", slaDueAt: past },
      { id: "exc-2", companyId: "comp-1", status: "ASSIGNED", slaDueAt: past },
    ];

    const fakeExec = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(rows),
            }),
          }),
        }),
      }),
    };

    const escalateSpy = vi
      .spyOn(ExceptionService, "escalate")
      .mockRejectedValueOnce(ApiError.conflict("Conflicto concurrente"))
      .mockResolvedValueOnce({ ...rows[1], status: "ESCALATED" } as never);

    try {
      const result = await sweepCompanyExceptionSla({
        companyId: "comp-1",
        now,
        executor: fakeExec as never,
      });

      expect(result.scanned).toBe(2);
      expect(result.skippedAlreadyHandled).toBe(1);
      expect(result.escalated).toBe(1);
      expect(result.escalatedIds).toEqual(["exc-2"]);
      expect(result.failed).toBe(0);
    } finally {
      escalateSpy.mockRestore();
    }
  });
});
