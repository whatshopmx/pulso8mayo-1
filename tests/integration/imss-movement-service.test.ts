import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db', () => ({ get db() { return state.db; } }));
import { ImssMovementService } from '@/lib/services/compliance/imss-movement-service';
const session = vi.hoisted(() => ({ companyId: '10000000-0000-4000-8000-000000000001', role: 'ADMIN', branchId: null as string | null }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: async () => ({ user: { id: 'actor', role: session.role, branchId: session.branchId } }) } } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/tenant-context', () => ({ requireTenant: async () => ({ id: session.companyId }) }));
const storage = vi.hoisted(() => ({ configured: false, objects: new Map<string, Buffer>() }));
vi.mock('@/lib/storage/r2-client', () => ({
    isR2Configured: () => storage.configured,
    uploadToR2: async (bytes: Buffer, key: string) => { storage.objects.set(key, bytes); return key; },
    getFromR2: async (key: string) => storage.objects.get(key) ?? null,
    deleteFromR2: async (key: string) => { storage.objects.delete(key); },
}));
import { POST as idsePOST } from '@/app/api/imss/idse-generate/route';
import { POST as suaPOST } from '@/app/api/imss/sua-generate/route';
import { NextRequest } from 'next/server';
import { POST as filesPOST, GET as filesGET } from '@/app/api/imss/files/route';
import { PATCH as filePATCH, GET as fileGET } from '@/app/api/imss/files/[id]/route';
import { createHash } from 'node:crypto';
import { GET as candidatesGET } from '@/app/api/imss/sua-candidatos/route';
import { GET as summaryGET } from '@/app/api/imss/summary/route';
import { POST as adoptionPOST } from '@/app/api/imss/adoption/route';

// PostgreSQL real embebido: SQL, constraints, locks y rollback, sin tocar Neon.
const pg = new PGlite();
const companyId = '10000000-0000-4000-8000-000000000001';
const otherCompanyId = '10000000-0000-4000-8000-000000000002';
const branchId = '20000000-0000-4000-8000-000000000001';
const otherBranchId = '20000000-0000-4000-8000-000000000002';
const fileId = '30000000-0000-4000-8000-000000000001';
const database = drizzle(pg, { schema });

beforeAll(async () => {
    state.db = database;
    await pg.exec(`
        CREATE TABLE companies (id uuid PRIMARY KEY);
        CREATE TABLE branches (id uuid PRIMARY KEY, company_id uuid, name text);
        CREATE TABLE users (id text PRIMARY KEY, company_id uuid, branch_id uuid, role text, active boolean, name text, deleted_at timestamp);
        CREATE TABLE employee_profiles (user_id text, nss text, curp text, rfc text,
          hire_date timestamp, termination_date timestamp, employee_status text, employee_number text, position text);
        CREATE TABLE employee_contracts (user_id text, company_id uuid, base_salary integer, start_date timestamp, end_date timestamp, id uuid DEFAULT gen_random_uuid());
        CREATE TABLE employee_audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL,
          action text NOT NULL, entity_type text NOT NULL, entity_id text, field_name text, old_value jsonb, new_value jsonb,
          performed_by text NOT NULL, performed_at timestamp NOT NULL DEFAULT now(), ip_address text, user_agent text,
          reason text, is_sensitive boolean, requires_approval boolean, approved_by text, approved_at timestamp,
          retention_until timestamp, created_at timestamp NOT NULL DEFAULT now());
    `);
    const folder = `.tmp/imss-migration-${randomUUID()}`;
    mkdirSync(`${folder}/meta`, { recursive: true });
    writeFileSync(`${folder}/0121_imss_movimientos.sql`, readFileSync('drizzle/0121_imss_movimientos.sql', 'utf8'));
    writeFileSync(`${folder}/meta/_journal.json`, JSON.stringify({ version: '7', dialect: 'postgresql', entries: [
        { idx: 0, version: '7', when: 1792691071337, tag: '0121_imss_movimientos', breakpoints: true },
    ] }));
    // El runner de Drizzle registra la migración y omite su segunda aplicación.
    await migrate(database, { migrationsFolder: folder });
    await migrate(database, { migrationsFolder: folder });
    expect((await pg.query('SELECT * FROM drizzle.__drizzle_migrations')).rows).toHaveLength(1);
}, 60_000);
afterAll(async () => { await pg.close(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
beforeEach(async () => {
    session.companyId = companyId;
    session.role = 'ADMIN';
    session.branchId = null;
    storage.configured = false;
    storage.objects.clear();
    vi.stubEnv('BETTER_AUTH_SECRET', 'imss-preview-test-secret-32-characters-long');
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
    await pg.exec(`TRUNCATE imss_movements, imss_files, employee_audit_logs, employee_contracts, employee_profiles, users, branches, companies CASCADE;
        INSERT INTO companies (id) VALUES ('${companyId}'), ('${otherCompanyId}');
        INSERT INTO branches (id, company_id, name, imss_registro_patronal) VALUES
          ('${branchId}', '${companyId}', 'Centro', 'A1234567890'), ('${otherBranchId}', '${otherCompanyId}', 'Ajena', 'B1234567890');
        INSERT INTO users (id,company_id,branch_id,role,active) VALUES ('ana','${companyId}','${branchId}','EMPLEADO',true),
          ('beto','${companyId}','${branchId}','EMPLEADO',true), ('foreign','${otherCompanyId}','${otherBranchId}','EMPLEADO',true);
        INSERT INTO employee_profiles VALUES
          ('ana','12345678901','LOPM850101HDFPRR09','LOPM850101AB1','2026-10-01',NULL,'ACTIVE'),
          ('beto','22345678901','LOPM850101HDFPRR09','LOPM850101AB1','2026-10-01',NULL,'ACTIVE'),
          ('foreign','32345678901','LOPM850101HDFPRR09','LOPM850101AB1','2026-10-01',NULL,'ACTIVE');
        INSERT INTO employee_contracts VALUES ('ana','${companyId}',35000,'2026-01-01',NULL),
          ('foreign','${otherCompanyId}',99999,'2026-01-01',NULL);`);
});

describe('T11–T15 — candidatos, indicadores y adopción con preview', () => {
    const req = (path: string) => new NextRequest(`http://localhost${path}`);
    const adopt = (body: object) => adoptionPOST(new NextRequest('http://localhost/api/imss/adoption', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    it('candidatos SUA: salarios reales, SDI y contrato; no fabrica salario al faltarlo', async () => {
        const response = await candidatesGET(req('/api/imss/sua-candidatos?bimestre=2026-09&fechaMovimiento=2026-10-24'));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.window).toMatchObject({ start: '2026-09-01', end: '2026-10-31' });
        expect(body.candidates.find((row: { userId: string }) => row.userId === 'ana')).toMatchObject({ baseSalaryPesos: 350, sdiPesos: 367.26, contractId: expect.any(String), blockedReasons: [] });
        expect(body.candidates.find((row: { userId: string }) => row.userId === 'beto')).toMatchObject({ baseSalaryPesos: null, sdiPesos: null, blockedReasons: ['SIN_SALARIO_BASE'] });
        expect((await candidatesGET(req('/api/imss/sua-candidatos?bimestre=2026-09&fechaMovimiento=2026-11-01'))).status).toBe(400);
    });
    it('un solo denominador: confirmaciones reales, vacíos desconocidos y alcance por sucursal', async () => {
        let body = await (await summaryGET(req('/api/imss/summary'))).json();
        expect(body.stats).toMatchObject({ totalEmployees: 2, requiredMovements: 2, confirmedMovements: 0, complianceRate: 0, pendingAltas: 2 });
        await ImssMovementService.adoptAsRegistered(companyId, { userIds: ['ana'], effectiveDate: '2026-10-01', actorId: 'admin', nota: 'Registro preexistente', branchId, dryRun: false });
        body = await (await summaryGET(req('/api/imss/summary'))).json();
        expect(body.stats).toMatchObject({ requiredMovements: 2, confirmedMovements: 1, complianceRate: 50, pendingAltas: 1 });
        expect((await (await summaryGET(req(`/api/imss/summary?branchId=${otherBranchId}`))).json()).stats.complianceRate).toBeNull();
    });
    it('SUA no ofrece fechas anteriores a un movimiento salarial ya en archivo', async () => {
        const generated = await filesPOST(new NextRequest('http://localhost/api/imss/files', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeIds: ['ana'], layout: 'SUA',
                movementType: 'MOD_SALARIO', bimestre: '2026-09', fechaMovimiento: '2026-10-24' }) }));
        expect(generated.status).toBe(200);
        const body = await (await candidatesGET(req('/api/imss/sua-candidatos?bimestre=2026-09&fechaMovimiento=2026-10-23'))).json();
        expect(body.candidates.find((row: { userId: string }) => row.userId === 'ana').blockedReasons).toContain('MOVIMIENTO_EN_ARCHIVO');
    });
    it('adopción exige preview firmado, nota y alcance; modificar el lote invalida el preview', async () => {
        const input = { userIds: ['ana'], effectiveDate: '2026-10-01', nota: 'Verificado en IDSE', branchId, dryRun: true };
        const preview = await (await adopt(input)).json();
        expect(preview).toMatchObject({ adoptedCount: 1, previewToken: expect.any(String) });
        expect(await database.select().from(schema.imssMovements)).toHaveLength(0);
        expect((await adopt({ ...input, dryRun: false })).status).toBe(400);
        expect((await adopt({ ...input, userIds: ['beto'], dryRun: false, previewToken: preview.previewToken })).status).toBe(409);
        expect((await adopt({ ...input, dryRun: false, previewToken: preview.previewToken })).status).toBe(200);
        expect((await database.select().from(schema.imssMovements))[0].status).toBe('CONFIRMADO');
    });
    it('preview caducado no confirma movimientos y un gerente no puede adoptar', async () => {
        const input = { userIds: ['ana'], effectiveDate: '2026-10-01', nota: 'Registro histórico', branchId, dryRun: true };
        const preview = await (await adopt(input)).json();
        vi.setSystemTime(new Date('2026-10-24T12:16:00Z'));
        expect((await adopt({ ...input, dryRun: false, previewToken: preview.previewToken })).status).toBe(409);
        expect(await database.select().from(schema.imssMovements)).toHaveLength(0);
        session.role = 'GERENTE'; session.branchId = branchId;
        expect((await adopt(input)).status).toBe(403);
    });
    it('SUA exige fecha dentro del período también al generar', async () => {
        const response = await filesPOST(new NextRequest('http://localhost/api/imss/files', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ employeeIds: ['ana'], movementType: 'MOD_SALARIO', layout: 'SUA', bimestre: '2026-09', fechaMovimiento: '2026-11-01' }) }));
        expect(response.status).toBe(400);
        expect(await database.select().from(schema.imssFiles)).toHaveLength(0);
    });
});

describe('T9–T10 — archivos persistidos y acuses', () => {
    const request = (body = {}) => new NextRequest('http://localhost/api/imss/files', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIds: ['ana'], movementType: 'ALTA', fechaMovimiento: '2026-10-24', ...body }) });
    const params = (id: string) => ({ params: Promise.resolve({ id }) });
    const acknowledge = (id: string, body: object) => filePATCH(new NextRequest(`http://localhost/api/imss/files/${id}`, { method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), params(id));
    it('genera, guarda hash, no confirma; duplicado y confirmado no se regeneran', async () => {
        const response = await filesPOST(request());
        expect(response.status).toBe(200);
        const id = response.headers.get('X-File-Id')!;
        const bytes = Buffer.from(await response.arrayBuffer());
        const [file] = await database.select().from(schema.imssFiles);
        expect(file).toMatchObject({ id, contentSha256: createHash('sha256').update(bytes).digest('hex'), status: 'GENERADO', contentUnavailable: true });
        expect((await database.select().from(schema.imssMovements))[0]).toMatchObject({ status: 'EN_ARCHIVO', fileId: id });
        expect((await filesPOST(request())).status).toBe(409);
        expect((await acknowledge(id, { accepted: true, acuseFolio: 'IDSE-123' })).status).toBe(200);
        expect((await filesPOST(request())).status).toBe(409);
        expect((await database.select().from(schema.imssMovements))[0].status).toBe('CONFIRMADO');
        const history = await (await filesGET(new NextRequest('http://localhost/api/imss/files'))).json();
        expect(history.files).toHaveLength(1);
        expect(history.files[0]).toMatchObject({ id, acuseFolio: 'IDSE-123', downloadAvailable: false });
        expect((await fileGET(new NextRequest('http://localhost/'), params(id))).status).toBe(410);
    });
    it('reporte de excluidos sin NSS y sin contrato; el válido se emite', async () => {
        await pg.exec("UPDATE employee_profiles SET nss=NULL WHERE user_id='beto'");
        const response = await filesPOST(request({ employeeIds: ['ana', 'beto'] }));
        expect(response.status).toBe(200);
        expect(response.headers.get('X-Imss-Excluded-Count')).toBe('1');
        expect(JSON.parse(decodeURIComponent(response.headers.get('X-Imss-Excluded')!))).toEqual([{ userId: 'beto', reason: 'SIN_NSS' }]);
        expect((await filesPOST(request({ employeeIds: ['beto'] }))).status).toBe(400);
    });
    it('403 sin rol de acuses y aislamiento por empresa en historial, descarga y confirmación', async () => {
        const response = await filesPOST(request());
        const id = response.headers.get('X-File-Id')!;
        session.role = 'GERENTE';
        expect((await acknowledge(id, { accepted: true, acuseFolio: 'sin-permiso' })).status).toBe(403);
        session.role = 'ADMIN';
        session.companyId = otherCompanyId;
        expect((await (await filesGET(new NextRequest('http://localhost/api/imss/files'))).json()).files).toHaveLength(0);
        expect((await acknowledge(id, { accepted: true, acuseFolio: 'ajeno' })).status).toBe(404);
        expect((await fileGET(new NextRequest('http://localhost/'), params(id))).status).toBe(404);
    });
    it('gerente solo genera y consulta su sucursal; el JSON no amplía su alcance', async () => {
        session.role = 'GERENTE';
        session.branchId = branchId;
        const generated = await filesPOST(request({ branchScope: otherBranchId }));
        expect(generated.status).toBe(200);
        const id = generated.headers.get('X-File-Id')!;
        expect((await (await filesGET(new NextRequest('http://localhost/api/imss/files'))).json()).files).toHaveLength(1);
        session.branchId = otherBranchId;
        expect((await filesPOST(request())).status).toBe(403);
        expect((await (await filesGET(new NextRequest('http://localhost/api/imss/files'))).json()).files).toHaveLength(0);
        expect((await fileGET(new NextRequest('http://localhost/'), params(id))).status).toBe(404);
    });
    it('rechazo conserva motivo y permite corregir y generar otro archivo', async () => {
        const first = await filesPOST(request());
        const id = first.headers.get('X-File-Id')!;
        expect((await acknowledge(id, { accepted: false, reason: 'Corregir identidad' })).status).toBe(200);
        expect((await database.select().from(schema.imssMovements))[0]).toMatchObject({ status: 'RECHAZADO', rejectionReason: 'Corregir identidad' });
        await pg.exec("UPDATE employee_profiles SET rfc='LOPM850101AB2' WHERE user_id='ana'");
        expect((await filesPOST(request())).status).toBe(200);
        expect(await database.select().from(schema.imssFiles)).toHaveLength(2);
    });
    it('descarga privada conserva los bytes y hash; no comparte almacenamiento entre empresas', async () => {
        storage.configured = true;
        const response = await filesPOST(request());
        const content = await response.text();
        const id = response.headers.get('X-File-Id')!;
        expect([...storage.objects.keys()][0]).toMatch(new RegExp(`^companies/${companyId}/imss/`));
        const download = await fileGET(new NextRequest('http://localhost/'), params(id));
        expect(download.status).toBe(200);
        expect(await download.text()).toBe(content);
    });
    it('reversión al fallar auditoría elimina el binario subido y no deja archivo ni movimientos', async () => {
        storage.configured = true;
        await pg.exec(`CREATE FUNCTION fail_imss_generation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          RAISE EXCEPTION 'audit unavailable'; END $$;
          CREATE TRIGGER fail_imss_generation BEFORE INSERT ON employee_audit_logs FOR EACH ROW EXECUTE FUNCTION fail_imss_generation();`);
        try {
            expect((await filesPOST(request())).status).toBe(500);
            expect(await database.select().from(schema.imssFiles)).toHaveLength(0);
            expect(await database.select().from(schema.imssMovements)).toHaveLength(0);
            expect(storage.objects.size).toBe(0);
        } finally { await pg.exec('DROP TRIGGER fail_imss_generation ON employee_audit_logs; DROP FUNCTION fail_imss_generation();'); }
    });
    it('retención: no ofrece descarga vencida y el borrado es idempotente sin perder hash', async () => {
        storage.configured = true;
        const response = await filesPOST(request());
        const id = response.headers.get('X-File-Id')!;
        const [file] = await database.select().from(schema.imssFiles);
        await database.update(schema.imssFiles).set({ createdAt: new Date('2025-01-01T00:00:00Z') }).where(eq(schema.imssFiles.id, id));
        expect((await fileGET(new NextRequest('http://localhost/'), params(id))).status).toBe(410);
        expect(await ImssMovementService.purgeExpiredFiles(otherCompanyId)).toBe(0);
        expect(await ImssMovementService.purgeExpiredFiles(companyId)).toBe(1);
        expect(await ImssMovementService.purgeExpiredFiles(companyId)).toBe(0);
        expect(storage.objects.size).toBe(0);
        expect((await database.select().from(schema.imssFiles))[0]).toMatchObject({ contentUnavailable: true, storageKey: null, contentSha256: file.contentSha256 });
    });
});

async function stageFile() {
    await ImssMovementService.ensurePendingMovements(companyId, 'ALTA', 'actor');
    await database.insert(schema.imssFiles).values({ id: fileId, companyId, branchId, layout: 'IDSE',
        layoutVersion: 'IDSE_2025_v1', movementType: 'ALTA', fechaMovimiento: '2026-10-01',
        fileName: 'alta.txt', contentSha256: 'a'.repeat(64), lineCount: 2, generatedBy: 'actor', contentUnavailable: true });
    await database.update(schema.imssMovements).set({ fileId, status: 'EN_ARCHIVO' }).where(eq(schema.imssMovements.companyId, companyId));
}

describe('IMSS Foundation — servicio transaccional', () => {
    it('permite adoptar el alta de una recontratación sin reutilizar la confirmación anterior', async () => {
        await database.insert(schema.imssMovements).values({ companyId, userId: 'ana', movementType: 'ALTA',
            movementCode: '08', effectiveDate: '2025-01-01', status: 'CONFIRMADO' });
        const input = { userIds: ['ana'], effectiveDate: '2026-10-01', actorId: 'admin',
            nota: 'Alta de recontratación verificada', branchId, dryRun: true };
        expect(await ImssMovementService.adoptAsRegistered(companyId, input)).toMatchObject({ adoptedCount: 1 });
        await ImssMovementService.adoptAsRegistered(companyId, { ...input, dryRun: false });
        expect((await ImssMovementService.getAfiliacionState(companyId, ['ana'])).get('ana')?.ALTA)
            .toMatchObject({ status: 'CONFIRMADO', effectiveDate: '2026-10-01' });
        expect((await ImssMovementService.getDashboardSummary(companyId)).confirmedMovements).toBe(1);
    });
    it('rechaza adoptar una fecha anterior al ingreso porque no confirmaría el alta vigente', async () => {
        await expect(ImssMovementService.adoptAsRegistered(companyId, { userIds: ['ana'], effectiveDate: '2026-09-30',
            actorId: 'admin', nota: 'Registro histórico', branchId, dryRun: true })).rejects.toMatchObject({ statusCode: 400 });
        expect(await database.select().from(schema.imssMovements)).toHaveLength(0);
    });
    it('una baja conserva la fecha del offboard y no genera bajas de activos', async () => {
        await pg.exec(`UPDATE employee_profiles SET employee_status='TERMINATED', termination_date='2026-10-20' WHERE user_id='ana'`);
        await ImssMovementService.ensurePendingMovements(companyId, 'BAJA', 'actor');
        await ImssMovementService.ensurePendingMovements(companyId, 'BAJA', 'actor');
        expect(await database.select().from(schema.imssMovements)).toMatchObject([
            { userId: 'ana', movementType: 'BAJA', movementCode: '02', effectiveDate: '2026-10-20', status: 'PENDIENTE' },
        ]);
    });
    it('lee el último por tipo en lote, por fecha efectiva y no por orden de inserción', async () => {
        await database.insert(schema.imssMovements).values([
            { companyId, userId: 'ana', movementType: 'ALTA', movementCode: '08', effectiveDate: '2026-09-01', status: 'CONFIRMADO' },
            { companyId, userId: 'ana', movementType: 'ALTA', movementCode: '08', effectiveDate: '2026-08-01', status: 'RECHAZADO' },
            { companyId, userId: 'ana', movementType: 'BAJA', movementCode: '02', effectiveDate: '2026-09-15' },
        ]);
        const result = await ImssMovementService.getAfiliacionState(companyId, ['ana', 'beto']);
        expect(result.get('ana')?.ALTA?.effectiveDate).toBe('2026-09-01');
        expect(result.get('ana')?.BAJA?.effectiveDate).toBe('2026-09-15');
        expect(result.get('beto')).toEqual({});
    });
    it('crea pendientes idempotentes con salarios reales, bloqueos y auditoría', async () => {
        await ImssMovementService.ensurePendingMovements(companyId, 'ALTA', 'actor');
        await ImssMovementService.ensurePendingMovements(companyId, 'ALTA', 'actor');
        const rows = await database.select().from(schema.imssMovements);
        expect(rows).toHaveLength(2);
        expect(rows.find(r => r.userId === 'ana')).toMatchObject({ status: 'PENDIENTE', baseSalaryCents: 35000, sdiCents: 36726, blockedReason: null });
        expect(rows.find(r => r.userId === 'beto')).toMatchObject({ blockedReason: 'SIN_SALARIO_BASE', sdiCents: null });
        expect(await database.select().from(schema.employeeAuditLogs)).toHaveLength(2);
    });
    it('refresca pendiente al corregir los datos sin duplicarlo', async () => {
        await ImssMovementService.ensurePendingMovements(companyId, 'ALTA', 'actor');
        await pg.exec(`INSERT INTO employee_contracts VALUES ('beto','${companyId}',40000,'2026-01-01',NULL)`);
        await ImssMovementService.ensurePendingMovements(companyId, 'ALTA', 'actor');
        const rows = await database.select().from(schema.imssMovements);
        expect(rows).toHaveLength(2);
        expect(rows.find(r => r.userId === 'beto')).toMatchObject({ blockedReason: null, baseSalaryCents: 40000 });
    });
    it('confirma N movimientos, conserva snapshots y rechaza volver a pendiente', async () => {
        await stageFile();
        await ImssMovementService.confirmFile(companyId, fileId, { accepted: true, acuseFolio: 'IDSE-123' }, 'admin');
        expect((await database.select().from(schema.imssMovements)).every(r => r.status === 'CONFIRMADO')).toBe(true);
        await ImssMovementService.ensurePendingMovements(companyId, 'ALTA', 'actor');
        expect((await database.select().from(schema.imssMovements)).every(r => r.status === 'CONFIRMADO')).toBe(true);
        await expect(ImssMovementService.confirmFile(companyId, fileId, { accepted: false, reason: 'volver' }, 'admin')).rejects.toMatchObject({ statusCode: 409 });
        expect((await ImssMovementService.getAfiliacionState(companyId, ['ana'])).get('ana')?.ALTA?.status).toBe('CONFIRMADO');
    });
    it('aísla lecturas y acuses por empresa', async () => {
        await stageFile();
        expect((await ImssMovementService.getAfiliacionState(otherCompanyId, ['ana'])).get('ana')?.ALTA).toBeUndefined();
        await expect(ImssMovementService.confirmFile(otherCompanyId, fileId, { accepted: true, acuseFolio: 'ajeno' }, 'admin')).rejects.toMatchObject({ statusCode: 404 });
    });
    it('rechaza sin motivo/folio, permite rechazo con motivo y no confirma por generar', async () => {
        await stageFile();
        await expect(ImssMovementService.confirmFile(companyId, fileId, { accepted: true }, 'admin')).rejects.toMatchObject({ statusCode: 400 });
        await expect(ImssMovementService.confirmFile(companyId, fileId, { accepted: false }, 'admin')).rejects.toMatchObject({ statusCode: 400 });
        await ImssMovementService.confirmFile(companyId, fileId, { accepted: false, reason: 'NSS incorrecto' }, 'admin');
        expect((await database.select().from(schema.imssMovements)).every(r => r.status === 'RECHAZADO')).toBe(true);
    });
    it('rollback del archivo y TODOS sus movimientos si falla auditoría', async () => {
        await stageFile();
        await pg.exec(`CREATE FUNCTION fail_imss_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.performed_by = 'fail' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER fail_imss BEFORE INSERT ON employee_audit_logs FOR EACH ROW EXECUTE FUNCTION fail_imss_audit();`);
        try {
            await expect(ImssMovementService.confirmFile(companyId, fileId, { accepted: true, acuseFolio: 'folio' }, 'fail')).rejects.toThrow();
            expect((await database.select().from(schema.imssFiles))[0].status).toBe('GENERADO');
            expect((await database.select().from(schema.imssMovements)).every(r => r.status === 'EN_ARCHIVO')).toBe(true);
        } finally { await pg.exec('DROP TRIGGER fail_imss ON employee_audit_logs; DROP FUNCTION fail_imss_audit();'); }
    });
    it('adopta solo explícitamente con nota, sucursal y dry-run, sin salario inventado', async () => {
        const input = { userIds: ['ana', 'beto'], effectiveDate: '2026-10-01', actorId: 'admin', nota: 'Carga de plantilla registrada', branchId, dryRun: true };
        expect(await ImssMovementService.adoptAsRegistered(companyId, input)).toMatchObject({ adoptedCount: 2, dryRun: true });
        expect(await database.select().from(schema.imssMovements)).toHaveLength(0);
        await expect(ImssMovementService.adoptAsRegistered(companyId, { ...input, nota: '' })).rejects.toMatchObject({ statusCode: 400 });
        await expect(ImssMovementService.adoptAsRegistered(companyId, { ...input, userIds: ['foreign'] })).rejects.toMatchObject({ statusCode: 400 });
        await ImssMovementService.adoptAsRegistered(companyId, { ...input, dryRun: false });
        const files = await database.select().from(schema.imssFiles);
        expect(files).toHaveLength(0);
        const logs = await database.select().from(schema.employeeAuditLogs);
        expect(logs.every(log => (log.newValue as { acuseFolio: string }).acuseFolio === 'MIGRACION')).toBe(true);
        expect((await database.select().from(schema.imssMovements)).every(r => r.status === 'CONFIRMADO')).toBe(true);
        expect(await ImssMovementService.adoptAsRegistered(companyId, { ...input, dryRun: false })).toMatchObject({ adoptedCount: 0 });
    });
    it('adopta plantilla con pendientes previos a la fecha de carga y no vuelve a pedir altas', async () => {
        await ImssMovementService.ensurePendingMovements(companyId, 'ALTA', 'actor');
        await ImssMovementService.adoptAsRegistered(companyId, { userIds: ['ana', 'beto'], effectiveDate: '2026-10-22',
            actorId: 'admin', nota: 'Verificado en IDSE antes de la implantación', branchId, dryRun: false });
        expect((await ImssMovementService.ensurePendingMovements(companyId, 'ALTA', 'actor')).movements).toHaveLength(0);
        const states = await ImssMovementService.getAfiliacionState(companyId, ['ana', 'beto']);
        expect(states.get('ana')?.ALTA?.status).toBe('CONFIRMADO');
        expect(states.get('beto')?.ALTA?.status).toBe('CONFIRMADO');
    });
});

describe('IMSS Foundation — generadores reales', () => {
    const request = () => new NextRequest('http://localhost/api/imss/generate', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeIds: ['ana'], movementType: '08', fechaMovimiento: '2026-10-20' }) });
    it('rechaza sucursal sin registro en ambos endpoints con lista accionable', async () => {
        await pg.exec(`UPDATE branches SET imss_registro_patronal=NULL WHERE id='${branchId}'`);
        for (const route of [idsePOST, suaPOST]) {
            const res = await route(request());
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error).toContain('Centro');
            expect(body.details).toEqual({ branches: [{ branchId, branchName: 'Centro' }] });
        }
    });
    it('emite registro real y rechaza mezclar registros de la misma empresa', async () => {
        for (const route of [idsePOST, suaPOST]) {
            const res = await route(request());
            expect(res.status).toBe(200);
            expect(await res.text()).toContain('A1234567890');
        }
        await pg.exec(`INSERT INTO branches (id,company_id,name,imss_registro_patronal) VALUES ('20000000-0000-4000-8000-000000000003','${companyId}','Sur','C1234567890');
          UPDATE users SET branch_id='20000000-0000-4000-8000-000000000003' WHERE id='beto'`);
        const res = await idsePOST(new NextRequest('http://localhost/api/imss/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeIds: ['ana', 'beto'], movementType: '08' }) }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain('distintos');
    });
});
