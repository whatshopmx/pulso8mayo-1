import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { branches, companies, configChangeLogs, employeeProfiles, users } from '@/lib/db/schema';
import { GET as configGET, PATCH as configPATCH } from '@/app/api/imss/config/route';
import { POST as branchesPOST } from '@/app/api/branches/route';
import { PATCH as branchPATCH } from '@/app/api/branches/[id]/route';

/**
 * T1–T3 y T21 de `tasks/plan-imss-operacion.md` contra base Postgres real.
 *
 * La pregunta que resuelve el plan —"¿dónde capturo el registro patronal?"—
 * sólo tiene una respuesta verificable si el dato se puede escribir desde el
 * módulo IMSS y ese guardado queda auditado. Estas pruebas cubren:
 *
 *  - el conteo de empleados por sucursal excluye terminados y roles que el
 *    IMSS no registra (`ADMIN`);
 *  - `READONLY` consulta pero no escribe; `EMPLEADO` ni consulta;
 *  - `""` limpia el registro a `NULL` y el valor se normaliza a mayúsculas;
 *  - cada cambio deja fila en `config_change_logs` con actor y valores;
 *  - no se puede tocar la sucursal de otra empresa;
 *  - H4: `POST/PATCH /api/branches` rechazan roles sin permiso de escritura.
 */

const state = vi.hoisted(() => ({
  companyId: '',
  role: 'ADMIN' as string,
  branchId: null as string | null,
}));

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: { id: 'imss-config-tester', role: state.role, branchId: state.branchId },
      })),
    },
  },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/tenant-context', () => ({
  requireTenant: vi.fn(async () => ({ id: state.companyId })),
}));

const REGISTRO = 'A1234567890';

type Fixtures = {
  companyId: string;
  otherCompanyId: string;
  branchConfiguredId: string;
  branchMissingId: string;
  foreignBranchId: string;
  userIds: string[];
};

async function seed(companyId: string): Promise<Fixtures> {
  const otherCompanyId = randomUUID();
  const branchConfiguredId = randomUUID();
  const branchMissingId = randomUUID();
  const foreignBranchId = randomUUID();

  await db.insert(companies).values([
    { id: companyId, name: `IMSS config ${companyId.slice(0, 8)}` },
    { id: otherCompanyId, name: `IMSS config otra ${otherCompanyId.slice(0, 8)}` },
  ]);

  await db.insert(branches).values([
    { id: branchConfiguredId, companyId, name: 'Sucursal Norte', imssRegistroPatronal: REGISTRO },
    { id: branchMissingId, companyId, name: 'Sucursal Sur' },
    { id: foreignBranchId, companyId: otherCompanyId, name: 'Sucursal ajena' },
  ]);

  const userIds = {
    empleado: randomUUID(),
    gerente: randomUUID(),
    terminado: randomUUID(),
    adminPulso: randomUUID(),
    sur: randomUUID(),
    ajeno: randomUUID(),
  };

  const userRow = (
    id: string,
    role: 'EMPLEADO' | 'GERENTE' | 'ADMIN',
    opts: { branchId?: string; company?: string; active?: boolean } = {},
  ) => ({
    id,
    name: `Persona ${id.slice(0, 6)}`,
    email: `${id.slice(0, 8)}@imss-config.test`,
    companyId: opts.company ?? companyId,
    branchId: opts.branchId ?? branchConfiguredId,
    role,
    active: opts.active ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.insert(users).values([
    userRow(userIds.empleado, 'EMPLEADO'),
    userRow(userIds.gerente, 'GERENTE'),
    userRow(userIds.terminado, 'EMPLEADO'),
    // Roles administrativos no se registran ante el IMSS: no deben sumar.
    userRow(userIds.adminPulso, 'ADMIN'),
    userRow(userIds.sur, 'EMPLEADO', { branchId: branchMissingId }),
    userRow(userIds.ajeno, 'EMPLEADO', { company: otherCompanyId, branchId: foreignBranchId }),
  ]);

  const profile = (userId: string, status: 'ACTIVE' | 'TERMINATED', overrides: Partial<typeof employeeProfiles.$inferInsert> = {}) => ({
    userId,
    employeeStatus: status,
    isActive: status === 'ACTIVE',
    createdBy: 'imss-config-tester',
    ...overrides,
  });

  await db.insert(employeeProfiles).values([
    profile(userIds.empleado, 'ACTIVE'),
    profile(userIds.gerente, 'ACTIVE'),
    profile(userIds.terminado, 'TERMINATED', { terminationDate: new Date(), terminationReason: 'VOLUNTARY_RESIGNATION' }),
    profile(userIds.sur, 'ACTIVE'),
    profile(userIds.ajeno, 'ACTIVE'),
  ]);

  return {
    companyId,
    otherCompanyId,
    branchConfiguredId,
    branchMissingId,
    foreignBranchId,
    userIds: Object.values(userIds),
  };
}

async function cleanup(fixtures: Fixtures) {
  await db.delete(configChangeLogs).where(eq(configChangeLogs.companyId, fixtures.companyId));
  await db.delete(employeeProfiles).where(inArray(employeeProfiles.userId, fixtures.userIds));
  await db.delete(users).where(inArray(users.id, fixtures.userIds));
  // Las pruebas de T21 crean sucursales extra: se borran por empresa, no por id.
  await db.delete(branches).where(eq(branches.companyId, fixtures.companyId));
  await db.delete(branches).where(eq(branches.companyId, fixtures.otherCompanyId));
  await db.delete(companies).where(inArray(companies.id, [fixtures.companyId, fixtures.otherCompanyId]));
}

const get = (path: string) => configGET(new NextRequest(`http://localhost${path}`));
const patch = (path: string, body: unknown) => configPATCH(new NextRequest(`http://localhost${path}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

let fixtures: Fixtures;

beforeEach(async () => {
  const companyId = randomUUID();
  fixtures = await seed(companyId);
  state.companyId = companyId;
  state.role = 'ADMIN';
  state.branchId = null;
});

afterEach(async () => {
  await cleanup(fixtures);
});

describe('GET /api/imss/config', () => {
  it('devuelve las sucursales de la empresa con su conteo de plantilla registrable', async () => {
    const res = await get('/api/imss/config');
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.branches.map((branch: { name: string }) => branch.name)).toEqual(['Sucursal Norte', 'Sucursal Sur']);
    const norte = body.branches.find((branch: { id: string }) => branch.id === fixtures.branchConfiguredId);
    const sur = body.branches.find((branch: { id: string }) => branch.id === fixtures.branchMissingId);

    // EMPLEADO + GERENTE activos; el ADMIN y la persona terminada no cuentan.
    expect(norte.employees).toBe(2);
    expect(sur.employees).toBe(1);
    expect(norte.configured).toBe(true);
    expect(sur.configured).toBe(false);
    expect(body.configuredCount).toBe(1);
    expect(body.canConfigure).toBe(true);
    expect(body.mode).toBe('POR_CONFIGURAR');
  });

  it('no filtra sucursales de otra empresa', async () => {
    const body = await (await get('/api/imss/config')).json();
    const ids = body.branches.map((branch: { id: string }) => branch.id);
    expect(ids).not.toContain(fixtures.foreignBranchId);
  });

  it('READONLY puede consultar; EMPLEADO recibe 403', async () => {
    state.role = 'READONLY';
    const readonly = await get('/api/imss/config');
    expect(readonly.status).toBe(200);
    expect((await readonly.json()).canConfigure).toBe(false);

    state.role = 'EMPLEADO';
    expect((await get('/api/imss/config')).status).toBe(403);
  });

  it('GERENTE ve sólo su sucursal y sin permiso de captura (Q2)', async () => {
    state.role = 'GERENTE';
    state.branchId = fixtures.branchMissingId;

    const res = await get(`/api/imss/config?branchId=${fixtures.branchMissingId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branches.map((branch: { id: string }) => branch.id)).toEqual([fixtures.branchMissingId]);
    expect(body.canConfigure).toBe(false);
  });
});

describe('PATCH /api/imss/config', () => {
  it('guarda, normaliza a mayúsculas y audita con actor y valores', async () => {
    const res = await patch('/api/imss/config', {
      branchUpdates: [{ branchId: fixtures.branchMissingId, imssRegistroPatronal: 'b1234567890' }],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const sur = body.branches.find((branch: { id: string }) => branch.id === fixtures.branchMissingId);
    expect(sur.imssRegistroPatronal).toBe('B1234567890');
    expect(sur.configured).toBe(true);
    expect(body.configuredCount).toBe(2);

    const [stored] = await db.select({ registro: branches.imssRegistroPatronal })
      .from(branches).where(eq(branches.id, fixtures.branchMissingId));
    expect(stored.registro).toBe('B1234567890');

    const audit = await db.select().from(configChangeLogs).where(eq(configChangeLogs.companyId, fixtures.companyId));
    expect(audit).toHaveLength(1);
    expect(audit[0].fieldName).toBe('branches.imssRegistroPatronal');
    expect(audit[0].userId).toBe('imss-config-tester');
    expect(audit[0].oldValue).toMatchObject({ branchId: fixtures.branchMissingId, registroPatronal: null });
    expect(audit[0].newValue).toMatchObject({ branchId: fixtures.branchMissingId, registroPatronal: 'B1234567890' });
  });

  it('un string vacío limpia el registro a NULL', async () => {
    const res = await patch('/api/imss/config', {
      branchUpdates: [{ branchId: fixtures.branchConfiguredId, imssRegistroPatronal: '' }],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const norte = body.branches.find((branch: { id: string }) => branch.id === fixtures.branchConfiguredId);
    expect(norte.imssRegistroPatronal).toBeNull();
    expect(norte.configured).toBe(false);
    expect(body.configuredCount).toBe(0);
  });

  it('un valor inválido responde 400 y no toca la fila', async () => {
    const res = await patch('/api/imss/config', {
      branchUpdates: [{ branchId: fixtures.branchConfiguredId, imssRegistroPatronal: 'ABC' }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/11 caracteres/);

    const [stored] = await db.select({ registro: branches.imssRegistroPatronal })
      .from(branches).where(eq(branches.id, fixtures.branchConfiguredId));
    expect(stored.registro).toBe(REGISTRO);
  });

  it('no permite configurar la sucursal de otra empresa', async () => {
    const res = await patch('/api/imss/config', {
      branchUpdates: [{ branchId: fixtures.foreignBranchId, imssRegistroPatronal: REGISTRO }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no pertenece/);
  });

  it('un cambio sin diferencia no genera fila de auditoría', async () => {
    const res = await patch('/api/imss/config', {
      branchUpdates: [{ branchId: fixtures.branchConfiguredId, imssRegistroPatronal: REGISTRO }],
    });
    expect(res.status).toBe(200);
    expect(await db.select().from(configChangeLogs).where(eq(configChangeLogs.companyId, fixtures.companyId))).toHaveLength(0);
  });

  it('GERENTE y READONLY reciben 403; EMPLEADO también', async () => {
    state.role = 'GERENTE';
    state.branchId = fixtures.branchMissingId;
    expect((await patch('/api/imss/config', {
      branchUpdates: [{ branchId: fixtures.branchMissingId, imssRegistroPatronal: REGISTRO }],
    })).status).toBe(403);

    state.role = 'READONLY';
    expect((await patch('/api/imss/config', {
      branchUpdates: [{ branchId: fixtures.branchMissingId, imssRegistroPatronal: REGISTRO }],
    })).status).toBe(403);

    state.role = 'EMPLEADO';
    expect((await patch('/api/imss/config', {
      branchUpdates: [{ branchId: fixtures.branchMissingId, imssRegistroPatronal: REGISTRO }],
    })).status).toBe(403);
  });
});

describe('T21 — escritura de sucursales con guard de rol (H4)', () => {
  const create = (body: unknown) => branchesPOST(new NextRequest('http://localhost/api/branches', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const update = (id: string, body: unknown) => branchPATCH(new NextRequest(`http://localhost/api/branches/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });

  it('EMPLEADO y READONLY no pueden crear sucursales', async () => {
    state.role = 'EMPLEADO';
    expect((await create({ name: 'Intentona empleado' })).status).toBe(403);
    state.role = 'READONLY';
    expect((await create({ name: 'Intentona readonly' })).status).toBe(403);

    const creadas = await db.select({ id: branches.id }).from(branches)
      .where(eq(branches.companyId, fixtures.companyId));
    expect(creadas).toHaveLength(2); // sólo las dos de la semilla
  });

  it('ADMIN crea la sucursal con su registro patronal y sin él', async () => {
    const conRegistro = await create({ name: 'Sucursal con registro', imssRegistroPatronal: 'c1234567890' });
    expect(conRegistro.status).toBe(201);
    const { data } = await conRegistro.json();
    expect(data.imssRegistroPatronal).toBe('C1234567890');

    const sinRegistro = await create({ name: 'Sucursal en trámite' });
    expect(sinRegistro.status).toBe(201);
    expect((await sinRegistro.json()).data.imssRegistroPatronal).toBeNull();
  });

  it('EMPLEADO no puede editar el registro patronal de una sucursal; ADMIN sí', async () => {
    state.role = 'EMPLEADO';
    expect((await update(fixtures.branchMissingId, { imssRegistroPatronal: REGISTRO })).status).toBe(403);

    state.role = 'ADMIN';
    const res = await update(fixtures.branchMissingId, { imssRegistroPatronal: REGISTRO });
    expect(res.status).toBe(200);
    expect((await res.json()).data.imssRegistroPatronal).toBe(REGISTRO);
  });
});
