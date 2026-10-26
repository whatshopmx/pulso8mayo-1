import { randomUUID, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { branches, companies, employeeAuditLogs, employeeContracts, employeeProfiles, imssFiles, imssMovements, users } from '@/lib/db/schema';
import { GET as altasGET } from '@/app/api/imss/altas/route';
import { GET as bajasGET } from '@/app/api/imss/bajas/route';
import { GET as summaryGET } from '@/app/api/imss/summary/route';
import { POST as filesPOST, GET as filesGET } from '@/app/api/imss/files/route';
import { GET as downloadGET, PATCH as acusePATCH } from '@/app/api/imss/files/[id]/route';
import { todayInMx } from '@/lib/services/compliance/imss-rules';

const session = vi.hoisted(() => ({ companyId: '', actorId: '' }));
const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: async () => ({ user: { id: session.actorId, role: 'ADMIN' } }) } } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/tenant-context', () => ({ requireTenant: async () => ({ id: session.companyId }) }));
// Único límite externo sustituido: el servicio real persiste metadatos y movimientos en Postgres aislado.
vi.mock('@/lib/storage/r2-client', () => ({ isR2Configured: () => true,
    uploadToR2: async (bytes: Buffer, key: string) => { storage.objects.set(key, bytes); return key; },
    getFromR2: async (key: string) => storage.objects.get(key) ?? null,
    deleteFromR2: async (key: string) => { storage.objects.delete(key); },
}));

const req = (path: string, body?: object, method = 'POST') => new NextRequest(`http://localhost/api/imss/${path}`,
    body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
let userId: string;
let branchId: string;
let fecha: string;

beforeEach(async () => {
    session.companyId = randomUUID();
    userId = randomUUID(); branchId = randomUUID(); session.actorId = userId;
    fecha = todayInMx().toISOString().slice(0, 10);
    storage.objects.clear();
    await db.insert(companies).values({ id: session.companyId, name: 'ISO IMSS circuito' });
    await db.insert(branches).values({ id: branchId, companyId: session.companyId, name: 'Centro', imssRegistroPatronal: 'A1234567890' });
    await db.insert(users).values({ id: userId, companyId: session.companyId, branchId, role: 'EMPLEADO', active: true,
        name: 'Persona de circuito', email: `${userId}@imss.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(employeeProfiles).values({ userId, createdBy: userId, isActive: true, employeeStatus: 'ACTIVE', hireDate: new Date(`${fecha}T00:00:00Z`),
        nss: '12345678901', curp: 'LOPM850101HDFPRR09', rfc: 'LOPM850101AB1' });
    await db.insert(employeeContracts).values({ userId, companyId: session.companyId, branchId, contractNumber: `C-${userId}`,
        startDate: new Date('2026-01-01T00:00:00Z'), baseSalary: 35000, createdBy: userId });
});

afterEach(async () => {
    await db.delete(imssMovements).where(eq(imssMovements.companyId, session.companyId));
    await db.delete(imssFiles).where(eq(imssFiles.companyId, session.companyId));
    await db.delete(employeeAuditLogs).where(eq(employeeAuditLogs.userId, userId));
    await db.delete(employeeContracts).where(eq(employeeContracts.companyId, session.companyId));
    await db.delete(employeeProfiles).where(eq(employeeProfiles.userId, userId));
    await db.delete(users).where(eq(users.companyId, session.companyId));
    await db.delete(branches).where(eq(branches.companyId, session.companyId));
    await db.delete(companies).where(eq(companies.id, session.companyId));
    storage.objects.clear();
});

describe('circuito IMSS — rutas reales y Postgres aislado', () => {
    it('alta pendiente → archivo descargable → acuse → registrada; baja sigue el mismo circuito', async () => {
        for (const movementType of ['ALTA', 'BAJA'] as const) {
            if (movementType === 'BAJA') {
                await db.update(employeeProfiles).set({ employeeStatus: 'RESIGNED', terminationDate: new Date(`${fecha}T00:00:00Z`),
                    terminationReason: 'VOLUNTARY_RESIGNATION' }).where(eq(employeeProfiles.userId, userId));
                expect((await (await altasGET(req('altas'))).json()).altas).toHaveLength(0);
            }
            const list = movementType === 'ALTA' ? altasGET : bajasGET;
            const key = movementType === 'ALTA' ? 'altas' : 'bajas';
            let state = await (await list(req(key))).json();
            expect(state[key][0]).toMatchObject({ userId, status: 'READY', imssStatus: movementType === 'ALTA' ? 'SIN_ALTA' : 'SIN_BAJA' });
            const generated = await filesPOST(req('files', { employeeIds: [userId], movementType, fechaMovimiento: fecha }));
            expect(generated.status).toBe(200);
            const id = generated.headers.get('X-File-Id')!;
            const content = await generated.text();
            const sha256 = createHash('sha256').update(content).digest('hex');
            const download = await downloadGET(req(`files/${id}`), params(id));
            expect(download.status).toBe(200);
            expect(createHash('sha256').update(await download.text()).digest('hex')).toBe(sha256);
            const history = await (await filesGET(req('files'))).json();
            expect(history.files.find((file: { id: string }) => file.id === id)).toMatchObject({ contentSha256: sha256, status: 'GENERADO', downloadAvailable: true });
            state = await (await list(req(key))).json();
            expect(state.summary).toMatchObject({ ready: 0, inFile: 1, registered: 0 });
            expect(state[key][0].imssStatus).toBe('EN_ARCHIVO');
            expect((await (await summaryGET(req('summary'))).json()).stats.complianceRate).toBe(0);
            const acknowledged = await acusePATCH(req(`files/${id}`, { accepted: true, acuseFolio: `IDSE-${movementType}-1` }, 'PATCH'), params(id));
            expect(acknowledged.status).toBe(200);
            state = await (await list(req(key))).json();
            expect(state.summary).toMatchObject({ ready: 0, inFile: 0, registered: 1 });
            expect(state[key][0]).toMatchObject({ imssStatus: 'CONFIRMADO', overdue: false });
            expect((await (await summaryGET(req('summary'))).json()).stats).toMatchObject({ requiredMovements: 1, confirmedMovements: 1, complianceRate: 100 });
            expect((await filesPOST(req('files', { employeeIds: [userId], movementType, fechaMovimiento: fecha }))).status).toBe(409);
        }
        const logs = await db.select().from(employeeAuditLogs).where(eq(employeeAuditLogs.userId, userId));
        expect(logs.filter(log => (log.newValue as { status?: string })?.status === 'CONFIRMADO')).toHaveLength(2);
    });

    it('un rechazo devuelve el alta a seleccionable con motivo e historial conservado', async () => {
        const generated = await filesPOST(req('files', { employeeIds: [userId], movementType: 'ALTA', fechaMovimiento: fecha }));
        expect(generated.status).toBe(200);
        const id = generated.headers.get('X-File-Id')!;
        expect((await acusePATCH(req(`files/${id}`, { accepted: false, reason: 'Corregir identidad' }, 'PATCH'), params(id))).status).toBe(200);
        const state = await (await altasGET(req('altas'))).json();
        expect(state.altas[0]).toMatchObject({ status: 'READY', imssStatus: 'RECHAZADO' });
        const history = await (await filesGET(req('files'))).json();
        expect(history.files[0]).toMatchObject({ id, status: 'RECHAZADO', rejectionReason: 'Corregir identidad' });
        expect(history.stats.acceptanceRate).toBe(0);
    });
});
