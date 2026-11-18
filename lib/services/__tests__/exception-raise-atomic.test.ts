import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  committed: [] as unknown[],
  transactions: 0,
  failAudit: false,
  audit: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const executor = (rows: unknown[]) => ({
    insert: () => ({
      values: (input: Record<string, unknown>) => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            const row = { ...input, id: 'exception-1', status: 'OPEN', isNew: true };
            rows.push(row);
            return [row];
          },
        }),
      }),
    }),
  });
  const db = {
    ...executor(state.committed),
    transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      state.transactions++;
      const pending: unknown[] = [];
      const result = await work(executor(pending));
      state.committed.push(...pending);
      return result;
    },
  };
  return { db };
});
vi.mock('@/lib/services/audit-service', () => ({
  AuditService: {
    logEmployeeAction: (...args: unknown[]) => {
      state.audit(...args);
      if (state.failAudit) throw new Error('Auditoría no disponible');
      return Promise.resolve();
    },
  },
}));
vi.mock('@/lib/services/domain-event-service', () => ({ emitDomainEvent: vi.fn() }));

import { ExceptionService } from '@/lib/services/exception-service';
import { db } from '@/lib/db';

const input = {
  companyId: 'company-a', domain: 'operacion' as const, qsrCategory: 'INOCUIDAD' as const,
  severity: 'warning' as const, subjectType: 'TEST', subjectId: 'subject-1',
  reason: 'Temperatura requiere revisión', ownerId: 'owner-a', actorId: 'actor-a',
};

beforeEach(() => {
  state.committed.length = 0;
  state.transactions = 0;
  state.failAudit = false;
  state.audit.mockClear();
});

describe('EXC-01: atomicidad del alta humana con auditoría', () => {
  it('revierte el alta predeterminada si falla la auditoría', async () => {
    state.failAudit = true;
    await expect(ExceptionService.raise(input)).rejects.toThrow('Auditoría no disponible');
    expect(state.committed).toHaveLength(0);
    expect(state.transactions).toBe(1);
  });

  it('confirma el alta y usa el executor transaccional para la auditoría', async () => {
    const row = await ExceptionService.raise(input);
    expect(row.id).toBe('exception-1');
    expect(state.committed).toHaveLength(1);
    expect(state.transactions).toBe(1);
    expect(state.audit).toHaveBeenCalledOnce();
    expect(state.audit.mock.calls[0][1]).not.toBe(db);
    expect(state.audit.mock.calls[0][1]).toHaveProperty('insert');
  });
});
