import { describe, it, expect } from "vitest";
import { resolveVacationsForPeriod, resolveLeavesForPeriod } from "../payroll-service";

const base = {
  userId: "usr-balance-status",
  companyId: "cmp-balance-status",
  startDate: "2026-05-01",
  endDate: "2026-05-15",
  dailySalaryCents: 50000,
};

const approvedVacation = {
  id: "vac-1",
  startDate: "2026-05-04",
  endDate: "2026-05-09",
  totalDays: 6,
  status: "APPROVED",
};

/** dbInstance que devuelve filas vacías (dato ausente). */
function emptyDb() {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = async () => [];
  return { select: () => chain };
}

/** dbInstance cuya consulta falla (fallo de lectura). */
function failingDb() {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = async () => {
    throw new Error("consulta de nómina caída");
  };
  return { select: () => chain };
}

describe("NOM-02.c1: saldo de vacaciones distingue ausente de fallo de consulta", () => {
  it("saldo 0 explícito (precargado) es AVAILABLE y produce EXCEEDED", async () => {
    const res = await resolveVacationsForPeriod({
      ...base,
      vacationRequests: [approvedVacation],
      vacationAccruals: [{ year: 2026, daysBalance: 0, daysAccrued: 12, daysTaken: 12 }],
    });
    expect(res.vacationBalanceStatus).toBe("AVAILABLE");
    expect(res.hasVacations).toBe(true);
    expect(res.vacationDaysEligible).toBe(0);
    expect(res.vacationDaysExceeded).toBe(6);
    expect(res.justification).toBe("EXCEEDED_VACATION_BALANCE");
  });

  it("sin registro de saldo (dato ausente) es MISSING, no EXCEEDED silencioso", async () => {
    const res = await resolveVacationsForPeriod({
      ...base,
      vacationRequests: [approvedVacation],
      dbInstance: emptyDb(),
    });
    expect(res.vacationBalanceStatus).toBe("MISSING");
    expect(res.hasVacations).toBe(true);
    expect(res.vacationDaysEligible).toBe(0);
    expect(res.vacationPrimeCents).toBe(0);
    expect(res.justification).toBe("VACATION_BALANCE_MISSING");
    expect(res.justification).not.toBe("EXCEEDED_VACATION_BALANCE");
  });

  it("fallo al leer el saldo es QUERY_ERROR, no saldo 0 confirmado", async () => {
    const res = await resolveVacationsForPeriod({
      ...base,
      vacationRequests: [approvedVacation],
      dbInstance: failingDb(),
    });
    expect(res.vacationBalanceStatus).toBe("QUERY_ERROR");
    expect(res.vacationPrimeCents).toBe(0);
    expect(res.justification).toBe("VACATION_BALANCE_QUERY_ERROR");
    expect(res.justification).not.toBe("EXCEEDED_VACATION_BALANCE");
  });

  it("fallo al leer las solicitudes es QUERY_ERROR, no 'sin vacaciones'", async () => {
    const res = await resolveVacationsForPeriod({
      ...base,
      dbInstance: failingDb(),
    });
    expect(res.vacationRequestsStatus).toBe("QUERY_ERROR");
    expect(res.justification).toBe("VACATION_REQUESTS_QUERY_ERROR");
    expect(res.justification).not.toBe("SIN_VACACIONES");
  });

  it("sin solicitudes legibles (vacío real) sigue siendo SIN_VACACIONES", async () => {
    const res = await resolveVacationsForPeriod({
      ...base,
      vacationRequests: [],
      vacationAccruals: [],
    });
    expect(res.vacationRequestsStatus).toBe("AVAILABLE");
    expect(res.hasVacations).toBe(false);
    expect(res.justification).toBe("SIN_VACACIONES");
  });

  it("un fallo al leer permisos no se lee como 'sin permisos'", async () => {
    const res = await resolveLeavesForPeriod({ ...base, dbInstance: failingDb() });
    expect(res.leavesStatus).toBe("QUERY_ERROR");
    expect(res.paidLeaveDays).toBe(0);
    expect(res.hasPaidLeave).toBe(false);
  });

  it("permisos precargados conservan leavesStatus AVAILABLE", async () => {
    const res = await resolveLeavesForPeriod({
      ...base,
      leaveRequests: [
        {
          id: "leave-1",
          leaveTypeName: "PATERNITY",
          startDate: "2026-05-02",
          endDate: "2026-05-11",
          totalDays: 10,
          status: "APPROVED",
          isPaid: true,
        },
      ],
    });
    expect(res.leavesStatus).toBe("AVAILABLE");
    expect(res.paidLeaveDays).toBe(10);
  });
});
