import { expect, it } from 'vitest';
import { resolveVacationHistory, type VacationHistoryInput, type VacationHistoryGrant, type VacationHistoryRequest } from '@/lib/services/vacation-history';

const scope = { companyId: 'company-a', userId: 'worker-a' };
const grant = (id: string, days: number, extra: Partial<VacationHistoryGrant> = {}): VacationHistoryGrant => ({
  ...scope, id, days, validFrom: '2026-01-01', validThrough: '2026-12-31',
  recordedAt: '2026-01-01T00:00:00Z', sourceReference: `verified:${id}`, ...extra,
});
const request = (id: string, days: string[], extra: Partial<VacationHistoryRequest> = {}): VacationHistoryRequest => ({
  ...scope, id, days, approvalRecordedAt: '2026-01-02T00:00:00Z', ...extra,
});
const input = (extra: Partial<VacationHistoryInput> = {}): VacationHistoryInput => ({
  ...scope, periodStart: '2026-05-01', periodEnd: '2026-05-15', knownAt: '2026-05-16T12:00:00Z',
  coverage: { ...scope, id: 'coverage', from: '2026-01-01', through: '2026-12-31',
    recordedAt: '2026-01-01T00:00:00Z', sourceReference: 'verified:opening' },
  grants: [grant('annual', 12)], requests: [request('may', ['2026-05-01', '2026-05-02'])], ...extra,
});

it('el saldo anterior se reconstruye con consumo previo; el consumo del período no se descuenta dos veces', () => {
  const result = resolveVacationHistory(input({ grants: [grant('annual', 4)], requests: [
    request('april', ['2026-04-29', '2026-04-30']), request('may', ['2026-05-01', '2026-05-02']),
    request('future', ['2026-06-01']),
  ] }));
  expect(result).toMatchObject({ status: 'AVAILABLE', balanceBeforePeriod: 2, eligibleDays: 2, unfundedDays: 0, balanceAtClose: 0 });
});

it('un crédito futuro no financia días anteriores y un remanente vencido no se arrastra', () => {
  const result = resolveVacationHistory(input({ grants: [
    grant('expired', 10, { validThrough: '2026-04-30' }), grant('future', 10, { validFrom: '2026-05-02' }),
  ] }));
  expect(result).toMatchObject({ status: 'AVAILABLE', balanceBeforePeriod: 0, requestedDays: 2, eligibleDays: 1,
    unfundedDays: 1, unfundedDates: ['2026-05-01'], balanceAtClose: 9 });
});

it('usa primero el crédito que vence antes y conserva el vínculo solicitud/día/crédito', () => {
  const result = resolveVacationHistory(input({ grants: [grant('later', 3), grant('sooner', 1, { validThrough: '2026-05-01' })] }));
  expect(result).toMatchObject({ status: 'AVAILABLE', allocations: [
    { day: '2026-05-01', requestId: 'may', grantId: 'sooner' }, { day: '2026-05-02', requestId: 'may', grantId: 'later' },
  ], balanceAtClose: 2 });
});

it('cancelación y revocación registradas después del corte no alteran el pasado conocido', () => {
  const args = input({ grants: [grant('annual', 2, { revocationRecordedAt: '2026-06-01T00:00:00Z' })],
    requests: [request('may', ['2026-05-01', '2026-05-02'], { cancellationRecordedAt: '2026-06-02T00:00:00Z' })] });
  expect(resolveVacationHistory(args)).toMatchObject({ status: 'AVAILABLE', eligibleDays: 2 });
  expect(resolveVacationHistory({ ...args, knownAt: '2026-06-03T00:00:00Z' })).toMatchObject({ status: 'AVAILABLE', requestedDays: 0, balanceAtClose: 0 });
});

it('eventos registrados después del corte no cambian el resultado aunque tengan efecto retroactivo', () => {
  const before = input({ grants: [grant('annual', 1)] });
  const after = { ...before, grants: [...before.grants, grant('backdated', 10, { recordedAt: '2026-05-17T00:00:00Z' })] };
  expect(resolveVacationHistory(after)).toEqual(resolveVacationHistory(before));
  expect(resolveVacationHistory(after)).toMatchObject({ status: 'AVAILABLE', eligibleDays: 1, unfundedDays: 1 });
});

it('cobertura explícita sin créditos es cero conocido; ausencia o corte incompleto no entregan saldos', () => {
  expect(resolveVacationHistory(input({ grants: [] }))).toMatchObject({ status: 'AVAILABLE', balanceBeforePeriod: 0, unfundedDays: 2 });
  expect(resolveVacationHistory(input({ coverage: undefined }))).toEqual({ status: 'MISSING', reason: 'NO_COVERAGE' });
  const args = input();
  expect(resolveVacationHistory({ ...args, coverage: { ...args.coverage!, through: '2026-05-14' } }))
    .toEqual({ status: 'MISSING', reason: 'INCOMPLETE_COVERAGE' });
});

it('días repetidos dentro de una solicitud no consumen dos veces; dos solicitudes solapadas son conflicto', () => {
  expect(resolveVacationHistory(input({ requests: [request('one', ['2026-05-01', '2026-05-01'])] })))
    .toMatchObject({ status: 'AVAILABLE', requestedDays: 1, eligibleDays: 1 });
  expect(resolveVacationHistory(input({ requests: [request('one', ['2026-05-01']), request('two', ['2026-05-01'])] })))
    .toEqual({ status: 'CONFLICT', reason: 'OVERLAPPING_REQUESTS' });
});

it('rechaza otra empresa/empleado, identificadores duplicados y fuentes sin verificar', () => {
  expect(resolveVacationHistory(input({ grants: [grant('foreign', 12, { companyId: 'company-b' })] })))
    .toEqual({ status: 'CONFLICT', reason: 'SCOPE_MISMATCH' });
  expect(resolveVacationHistory(input({ requests: [request('foreign', ['2026-05-01'], { userId: 'worker-b' })] })))
    .toEqual({ status: 'CONFLICT', reason: 'SCOPE_MISMATCH' });
  expect(resolveVacationHistory(input({ grants: [grant('same', 1), grant('same', 2)] })))
    .toEqual({ status: 'CONFLICT', reason: 'DUPLICATE_ID' });
  expect(resolveVacationHistory(input({ grants: [grant('unknown', 12, { sourceReference: ' ' })] })))
    .toEqual({ status: 'CONFLICT', reason: 'UNVERIFIED_SOURCE' });
});

it('no inventa cobertura anterior a la apertura ni una cobertura registrada después del corte', () => {
  const args = input();
  expect(resolveVacationHistory({ ...args, coverage: { ...args.coverage!, from: '2026-05-02' } }))
    .toEqual({ status: 'MISSING', reason: 'INCOMPLETE_COVERAGE' });
  expect(resolveVacationHistory({ ...args, coverage: { ...args.coverage!, recordedAt: '2026-05-17T00:00:00Z' } }))
    .toEqual({ status: 'MISSING', reason: 'NO_COVERAGE' });
  expect(resolveVacationHistory({ ...args, coverage: { ...args.coverage!, sourceReference: '' } }))
    .toEqual({ status: 'CONFLICT', reason: 'UNVERIFIED_SOURCE' });
});

it('un consumo previo sin fondos no se cobra automáticamente a un crédito posterior', () => {
  const result = resolveVacationHistory(input({ grants: [grant('may', 2, { validFrom: '2026-05-01' })],
    requests: [request('april', ['2026-04-30']), request('may', ['2026-05-01', '2026-05-02'])] }));
  expect(result).toMatchObject({ status: 'AVAILABLE', balanceBeforePeriod: 2, eligibleDays: 2,
    priorUnfundedDates: ['2026-04-30'], balanceAtClose: 0 });
});

it('el vencimiento es inclusivo y se excluyen remanentes que ya vencieron al cierre', () => {
  const result = resolveVacationHistory(input({ grants: [grant('ending', 5, { validThrough: '2026-05-01' })] }));
  expect(result).toMatchObject({ status: 'AVAILABLE', eligibleDays: 1, unfundedDays: 1, balanceAtClose: 0 });
});

it('una revocación conocida elimina el crédito; una cancelación posterior no se aplica anticipadamente', () => {
  const args = input({ grants: [grant('annual', 2, { revocationRecordedAt: '2026-05-15T12:00:00Z' })],
    requests: [request('may', ['2026-05-01', '2026-05-02'], { cancellationRecordedAt: '2026-05-17T00:00:00Z' })] });
  expect(resolveVacationHistory(args)).toMatchObject({ status: 'AVAILABLE', requestedDays: 2, eligibleDays: 0, unfundedDays: 2 });
  expect(resolveVacationHistory({ ...args, knownAt: '2026-05-17T00:00:00Z' }))
    .toMatchObject({ status: 'AVAILABLE', requestedDays: 0, eligibleDays: 0 });
});

it('una aprobación aún no registrada no consume derechos ni crea un falso solapamiento', () => {
  const args = input();
  expect(resolveVacationHistory({ ...args, requests: [...args.requests,
    request('future-approval', ['2026-05-01'], { approvalRecordedAt: '2026-05-17T00:00:00Z' })] })).toEqual(resolveVacationHistory(args));
});

it('la reconstrucción no depende del orden de entrada ni modifica los registros del caller', () => {
  const args = input({ grants: [grant('b', 2), grant('a', 1)], requests: [
    request('may', ['2026-05-02', '2026-05-01']), request('april', ['2026-04-30']),
  ] });
  const before = JSON.stringify(args);
  const result = resolveVacationHistory(args);
  expect(resolveVacationHistory({ ...args, grants: [...args.grants].reverse(), requests: [...args.requests].reverse() })).toEqual(result);
  expect(JSON.stringify(args)).toBe(before);
  expect(result).toMatchObject({ status: 'AVAILABLE', balanceBeforePeriod: 2, eligibleDays: 2, balanceAtClose: 0 });
});

it('el desempate por ID usa orden binario estable, sin depender de la configuración regional del servidor', () => {
  expect(resolveVacationHistory(input({ grants: [grant('a', 1), grant('A', 1)],
    requests: [request('may', ['2026-05-01'])] }))).toMatchObject({ status: 'AVAILABLE', allocations: [
    { day: '2026-05-01', requestId: 'may', grantId: 'A' },
  ] });
});

it('un crédito anterior a la apertura exige evidencia de saldo inicial, no omitir consumos previos', () => {
  expect(resolveVacationHistory(input({ grants: [grant('unreconciled', 12, { validFrom: '2025-01-01' })] })))
    .toEqual({ status: 'CONFLICT', reason: 'GRANT_BEFORE_COVERAGE' });
});

it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rechaza derechos no enteros o inseguros: %s', days => {
  expect(resolveVacationHistory(input({ grants: [grant('invalid', days)] })))
    .toEqual({ status: 'CONFLICT', reason: 'INVALID_INPUT' });
});

it('rechaza hechos imposibles y conserva el 29 de febrero como día civil válido', () => {
  expect(resolveVacationHistory(input({ requests: [request('invalid', ['2026-02-30'])] })))
    .toEqual({ status: 'CONFLICT', reason: 'INVALID_INPUT' });
  expect(resolveVacationHistory(input({ requests: [request('invalid', ['2026-05-01'], { cancellationRecordedAt: '2025-12-31T00:00:00Z' })] })))
    .toEqual({ status: 'CONFLICT', reason: 'INVALID_INPUT' });
  expect(resolveVacationHistory(input({ grants: [grant('leap', 1, { validFrom: '2028-02-29', validThrough: '2028-02-29' })],
    periodStart: '2028-02-29', periodEnd: '2028-02-29', knownAt: '2028-03-01T00:00:00Z',
    coverage: { ...input().coverage!, through: '2028-12-31' }, requests: [request('leap', ['2028-02-29'])] })))
    .toMatchObject({ status: 'AVAILABLE', eligibleDays: 1, balanceAtClose: 0 });
});
