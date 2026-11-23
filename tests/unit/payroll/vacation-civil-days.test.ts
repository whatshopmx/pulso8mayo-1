import { expect, it } from 'vitest';
import { resolveVacationsForPeriod } from '@/lib/services/payroll-service';

for (const timezone of ['America/Mexico_City', 'Pacific/Honolulu', 'Pacific/Kiritimati']) {
  it.each(['civil string', 'database timestamp'])(`vacaciones conserva el primer día civil en ${timezone} (%s)`, async representation => {
    const startDate = representation === 'civil string' ? '2026-05-01' : new Date('2026-05-01T00:00:00Z');
    const endDate = representation === 'civil string' ? '2026-05-02' : new Date('2026-05-02T00:00:00Z');
    const result = await resolveVacationsForPeriod({
      userId: 'civil-worker', companyId: 'civil-company', startDate: '2026-05-01', endDate: '2026-05-02',
      dailySalaryCents: 50000, timezone,
      vacationRequests: [{ startDate, endDate, status: 'APPROVED', totalDays: 2 }],
      vacationAccruals: [{ year: 2026, daysBalance: 10 }],
    });
    expect(result.vacationDaysTaken).toBe(2);
    expect(result.vacationDaysEligible).toBe(2);
    expect(result.vacationPrimeCents).toBe(25000);
  });
}
