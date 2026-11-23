import { vacationCivilDay } from './vacation-dates';

interface HistoryScope { companyId: string; userId: string }
export interface VacationHistoryCoverage extends HistoryScope {
  id: string; from: string; through: string; recordedAt: string; sourceReference: string;
}
export interface VacationHistoryGrant extends HistoryScope {
  id: string; days: number; validFrom: string; validThrough: string;
  recordedAt: string; sourceReference: string; revocationRecordedAt?: string;
}
/** Projection of immutable approval/cancellation events, never a mutable status. */
export interface VacationHistoryRequest extends HistoryScope {
  id: string; days: readonly string[]; approvalRecordedAt: string; cancellationRecordedAt?: string;
}
export interface VacationHistoryInput extends HistoryScope {
  periodStart: string; periodEnd: string; knownAt: string;
  coverage?: VacationHistoryCoverage;
  grants: readonly VacationHistoryGrant[];
  requests: readonly VacationHistoryRequest[];
}
export interface VacationHistoryAllocation {
  day: string; requestId: string; grantId: string;
}
export type VacationHistoryResult = {
  status: 'AVAILABLE'; knownAt: string; coverageId: string;
  balanceBeforePeriod: number; balanceAtClose: number;
  requestedDays: number; eligibleDays: number; unfundedDays: number;
  allocations: VacationHistoryAllocation[];
  unfundedDates: string[]; priorUnfundedDates: string[];
} | {
  status: 'MISSING'; reason: 'NO_COVERAGE' | 'INCOMPLETE_COVERAGE';
} | {
  status: 'CONFLICT'; reason: 'INVALID_INPUT' | 'SCOPE_MISMATCH' | 'UNVERIFIED_SOURCE'
    | 'DUPLICATE_ID' | 'OVERLAPPING_REQUESTS' | 'GRANT_BEFORE_COVERAGE';
};

type ConflictReason = Extract<VacationHistoryResult, { status: 'CONFLICT' }>['reason'];
class HistoryConflict extends Error {
  constructor(readonly reason: ConflictReason) { super(reason); }
}
function assertHistory(condition: unknown, reason: ConflictReason = 'INVALID_INPUT'): asserts condition {
  if (!condition) throw new HistoryConflict(reason);
}
function day(value: string): string {
  assertHistory(value === vacationCivilDay(value));
  return value;
}
function instant(value: string): number {
  const parsed = Date.parse(value);
  assertHistory(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value.slice(0, 10));
  return parsed;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Deterministic replay of a verified history projection. SQL admission and
 * immutable recording are separate gates; mutable balances are not inputs. */
export function resolveVacationHistory(input: VacationHistoryInput): VacationHistoryResult {
  try {
    const start = day(input.periodStart), end = day(input.periodEnd), knownAt = instant(input.knownAt);
    assertHistory(start <= end && input.companyId.trim() && input.userId.trim());
    const coverage = input.coverage;
    if (!coverage || instant(coverage.recordedAt) > knownAt) return { status: 'MISSING', reason: 'NO_COVERAGE' };
    const checkScope = (record: HistoryScope) => assertHistory(record.companyId === input.companyId
      && record.userId === input.userId, 'SCOPE_MISMATCH');
    checkScope(coverage);
    assertHistory(coverage.id.trim());
    assertHistory(coverage.sourceReference.trim(), 'UNVERIFIED_SOURCE');
    assertHistory(day(coverage.from) <= day(coverage.through));
    if (coverage.from > start || coverage.through < end) return { status: 'MISSING', reason: 'INCOMPLETE_COVERAGE' };

    const grantIds = new Set<string>(), requestIds = new Set<string>();
    const grants: VacationHistoryGrant[] = [];
    let totalGranted = 0;
    for (const grant of input.grants) {
      const recorded = instant(grant.recordedAt);
      if (recorded > knownAt) continue;
      checkScope(grant);
      assertHistory(grant.id.trim());
      assertHistory(!grantIds.has(grant.id), 'DUPLICATE_ID');
      grantIds.add(grant.id);
      assertHistory(grant.sourceReference.trim(), 'UNVERIFIED_SOURCE');
      assertHistory(Number.isSafeInteger(grant.days) && grant.days >= 0);
      assertHistory(day(grant.validFrom) <= day(grant.validThrough));
      assertHistory(grant.validFrom >= coverage.from, 'GRANT_BEFORE_COVERAGE');
      if (grant.revocationRecordedAt) {
        const revoked = instant(grant.revocationRecordedAt);
        assertHistory(revoked >= recorded);
        if (revoked <= knownAt) continue;
      }
      totalGranted += grant.days;
      assertHistory(Number.isSafeInteger(totalGranted));
      grants.push(grant);
    }
    grants.sort((a, b) => compare(a.validThrough, b.validThrough)
      || compare(a.validFrom, b.validFrom) || compare(a.id, b.id));

    const demand = new Map<string, string>();
    for (const request of input.requests) {
      const approved = instant(request.approvalRecordedAt);
      if (approved > knownAt) continue;
      checkScope(request);
      assertHistory(request.id.trim());
      assertHistory(!requestIds.has(request.id), 'DUPLICATE_ID');
      requestIds.add(request.id);
      if (request.cancellationRecordedAt) {
        const cancelled = instant(request.cancellationRecordedAt);
        assertHistory(cancelled >= approved);
        if (cancelled <= knownAt) continue;
      }
      for (const date of new Set(request.days.map(day))) {
        if (date < coverage.from || date > end) continue;
        assertHistory(!demand.has(date), 'OVERLAPPING_REQUESTS');
        demand.set(date, request.id);
      }
    }

    const remaining = new Map(grants.map(grant => [grant.id, grant.days]));
    const allocations: VacationHistoryAllocation[] = [];
    const unfundedDates: string[] = [], priorUnfundedDates: string[] = [];
    const consume = (date: string, requestId: string, unfunded: string[]) => {
      const grant = grants.find(candidate => candidate.validFrom <= date && candidate.validThrough >= date
        && remaining.get(candidate.id)! > 0);
      if (!grant) { unfunded.push(date); return; }
      remaining.set(grant.id, remaining.get(grant.id)! - 1);
      allocations.push({ day: date, requestId, grantId: grant.id });
    };
    const schedule = [...demand.entries()].sort(([a], [b]) => compare(a, b));
    for (const [date, requestId] of schedule) if (date < start) consume(date, requestId, priorUnfundedDates);
    const balanceOn = (date: string) => grants.reduce((sum, grant) => sum
      + (grant.validFrom <= date && grant.validThrough >= date ? remaining.get(grant.id)! : 0), 0);
    const balanceBeforePeriod = balanceOn(start);
    const current = schedule.filter(([date]) => date >= start);
    for (const [date, requestId] of current) consume(date, requestId, unfundedDates);
    return { status: 'AVAILABLE', knownAt: new Date(knownAt).toISOString(), coverageId: coverage.id,
      balanceBeforePeriod, balanceAtClose: balanceOn(end), requestedDays: current.length,
      eligibleDays: current.length - unfundedDates.length, unfundedDays: unfundedDates.length,
      allocations, unfundedDates, priorUnfundedDates };
  } catch (error) {
    if (error instanceof HistoryConflict) return { status: 'CONFLICT', reason: error.reason };
    if (error instanceof RangeError) return { status: 'CONFLICT', reason: 'INVALID_INPUT' };
    throw error;
  }
}
