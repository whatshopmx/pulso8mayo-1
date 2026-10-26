import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  branches,
  companies,
  employeeAuditLogs,
  employeeContracts,
  employeeProfiles,
  imssFiles,
  imssMovements,
  users,
} from "@/lib/db/schema";
import { GET as altasGET } from "@/app/api/imss/altas/route";
import { GET as bajasGET } from "@/app/api/imss/bajas/route";
import { EmployeeService } from "@/lib/services/employee-service";
import { POST as filesPOST } from '@/app/api/imss/files/route';
import { PATCH as filePATCH } from '@/app/api/imss/files/[id]/route';
import { NextRequest } from 'next/server';
import { todayInMx } from '@/lib/services/compliance/imss-rules';

/**
 * Phase 0 del `plan-imss` contra base Postgres real (`.env.test`).
 *
 * Sustituye la "prueba manual con 1 alta + 1 baja + 1 activo" por un test
 * repetible que corre las rutas REALES (`GET /api/imss/altas|bajas`). Cubre los
 * hallazgos que el plan marca como bloqueantes:
 *
 *  - H1: RFC de persona física (13) alcanza `READY` — antes exigía 12 y nadie
 *    llegaba nunca. Se incluye el caso espejo (RFC 12 de persona moral) para
 *    probar que la regla no se relajó a "cualquier RFC".
 *  - H2: vencido es un FLAG; el estatus sigue siendo `READY` (seleccionable).
 *  - H3: la lista de bajas sale poblada (el `select` no traía `employeeStatus`).
 *  - H4: la baja real escribe `termination_date` + `termination_reason` por el
 *    camino que usa la UI (`EmployeeService.updateEmployee`), no por el
 *    servicio `offboard*` que hoy no tiene callers.
 *  - H10: `baseSalaryCents` viene del contrato VIGENTE, no de un `0` de relleno.
 *  - H13: terminados/renunciados e inactivos no entran a "altas".
 *  - Decisión 5: sin contrato vigente la fila es `PENDIENTE` con
 *    `SIN_SALARIO_BASE` (no se ofrece una descarga que el generador rechaza).
 *  - Aislamiento multi-tenant: ni empleados ni nombres de sucursal de otra
 *    empresa se cuelan en la respuesta.
 */

const tenant = vi.hoisted(() => ({ companyId: "" }));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({ user: { id: "imss-phase0-tester", role: 'ADMIN' } })),
    },
  },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/storage/r2-client', () => ({ isR2Configured: () => false }));

vi.mock("@/lib/tenant-context", () => ({
  requireTenant: vi.fn(async () => ({ id: tenant.companyId, name: "ISO IMSS" })),
}));

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Fecha civil UTC de hace `days` días (independiente de la hora del test). */
function daysAgo(days: number): Date {
    const now = todayInMx();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
}

/** "YYYY-MM-DD" de hace `days` días — formato que manda el formulario de la UI. */
function daysAgoIso(days: number): string {
    return daysAgo(days).toISOString().slice(0, 10);
}

/**
 * Contador de días hábiles INDEPENDIENTE del módulo bajo prueba: si `imss-rules`
 * cambia su definición, este test lo nota en vez de repetirla.
 */
function businessDaysSince(from: Date): number {
    const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
    const part = (type: string) => Number(parts.find(value => value.type === type)?.value);
    const end = Date.UTC(part('year'), part('month') - 1, part('day'));
    let count = 0;
    for (let t = start + MS_PER_DAY; t <= end; t += MS_PER_DAY) {
        const dow = new Date(t).getUTCDay();
        if (dow !== 0 && dow !== 6) count++;
    }
    return count;
}

const IDENTITY_VALID = {
    nss: "12345678901",
    curp: "LOPM850101HDFPRR09",
    rfc: "LOPM850101AB1", // 13 = persona física (H1)
};

const IDENTITY_MORAL_RFC = {
    nss: "22345678901",
    curp: "MABC900202MDFRRR08",
    rfc: "MAB900202AB1", // 12 = persona moral: 3 letras + 6 dígitos + homoclave de 3
};

type Fixtures = {
    companyId: string;
    otherCompanyId: string;
    branchId: string;
    otherBranchId: string;
    /** Activo, identidad completa, contrato vigente $350/día, alta hace 30 días. */
    altaOverdueId: string;
    /** Activo, RFC 12 (moral), contrato vigente, alta hace 2 días. */
    altaRecentId: string;
    /** Activo, identidad completa, SIN contrato vigente. */
    altaNoContractId: string;
    /** Activo=false: no debe aparecer en altas (H13). */
    inactiveId: string;
    /** Baja real con fecha + motivo, hace 3 días. */
    bajaId: string;
    /** Empleado de OTRA empresa. */
    foreignId: string;
};

async function seed(companyId: string): Promise<Fixtures> {
    const otherCompanyId = randomUUID();
    const branchId = randomUUID();
    const otherBranchId = randomUUID();

    await db.insert(companies).values([
        { id: companyId, name: `ISO IMSS ${companyId.slice(0, 8)}` },
        { id: otherCompanyId, name: `ISO IMSS otra ${otherCompanyId.slice(0, 8)}` },
    ]);
    await db.insert(branches).values([
        { id: branchId, companyId, name: "Sucursal IMSS", imssRegistroPatronal: 'A1234567890' },
        { id: otherBranchId, companyId: otherCompanyId, name: "Sucursal ajena" },
    ]);

    const ids = {
        altaOverdueId: randomUUID(),
        altaRecentId: randomUUID(),
        altaNoContractId: randomUUID(),
        inactiveId: randomUUID(),
        bajaId: randomUUID(),
        foreignId: randomUUID(),
    };

    const userRow = (id: string, name: string, opts: { active?: boolean; company?: string; branch?: string } = {}) => ({
        id,
        name,
        email: `${id.slice(0, 8)}@imss.test`,
        companyId: opts.company ?? companyId,
        branchId: opts.branch ?? branchId,
        role: "EMPLEADO" as const,
        active: opts.active ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    await db.insert(users).values([
        userRow(ids.altaOverdueId, "Ana Alta Vencida"),
        userRow(ids.altaRecentId, "Beto Alta Reciente"),
        userRow(ids.altaNoContractId, "Caro Sin Contrato"),
        userRow(ids.inactiveId, "Dani Inactiva", { active: false }),
        userRow(ids.bajaId, "Elena Baja Real"),
        userRow(ids.foreignId, "Fabi Ajeno", { company: otherCompanyId, branch: otherBranchId }),
    ]);

    const profile = (
        userId: string,
        overrides: Partial<typeof employeeProfiles.$inferInsert> = {},
    ) => ({
        userId,
        employeeStatus: "ACTIVE" as const,
        isActive: true,
        createdBy: "imss-phase0-tester",
        ...overrides,
    });

    await db.insert(employeeProfiles).values([
        profile(ids.altaOverdueId, {
            ...IDENTITY_VALID,
            hireDate: daysAgo(30),
            employeeNumber: "IMSS-001",
        }),
        profile(ids.altaRecentId, {
            ...IDENTITY_MORAL_RFC,
            hireDate: daysAgo(2),
            employeeNumber: "IMSS-002",
        }),
        profile(ids.altaNoContractId, {
            ...IDENTITY_VALID,
            nss: "32345678901",
            rfc: "PERE870303CD2",
            hireDate: daysAgo(4),
            employeeNumber: "IMSS-003",
        }),
        profile(ids.inactiveId, {
            ...IDENTITY_VALID,
            nss: "42345678901",
            rfc: "GARC910404EF3",
            hireDate: daysAgo(6),
            isActive: false,
        }),
        profile(ids.bajaId, {
            nss: "52345678901",
            curp: "RUIZ880505HDFXXX07",
            rfc: "RUIZ880505GH4",
            hireDate: daysAgo(400),
            employeeStatus: "TERMINATED",
            isActive: false,
            terminationDate: daysAgo(3),
            terminationReason: "TERMINATION_WITHOUT_CAUSE",
            employeeNumber: "IMSS-005",
        }),
        profile(ids.foreignId, {
            nss: "62345678901",
            curp: "SOTO920606MDFYYY06",
            rfc: "SOTO920606IJ5",
            hireDate: daysAgo(20),
            employeeNumber: "IMSS-006",
        }),
    ]);

    // Contratos: 350.00 MXN/día = 35_000 centavos. El que no tiene contrato es
    // `altaNoContractId` a propósito.
    const contract = (userId: string, overrides: Partial<typeof employeeContracts.$inferInsert> = {}) => ({
        userId,
        companyId,
        branchId,
        contractNumber: `C-${userId.slice(0, 8)}`,
        startDate: daysAgo(60),
        baseSalary: 35_000,
        createdBy: "imss-phase0-tester",
        ...overrides,
    });

    await db.insert(employeeContracts).values([
        contract(ids.altaOverdueId),
        contract(ids.altaRecentId),
        contract(ids.inactiveId),
        contract(ids.bajaId, { startDate: daysAgo(400) }),
        // Contrato de OTRA empresa para el empleado ajeno.
        contract(ids.foreignId, { companyId: otherCompanyId, branchId: otherBranchId, startDate: daysAgo(20) }),
    ]);

    return { companyId, otherCompanyId, branchId, otherBranchId, ...ids };
}

async function cleanup(f: Fixtures) {
    await db.delete(imssMovements).where(eq(imssMovements.companyId, f.companyId));
    await db.delete(imssFiles).where(eq(imssFiles.companyId, f.companyId));
    const userIds = [
        f.altaOverdueId, f.altaRecentId, f.altaNoContractId,
        f.inactiveId, f.bajaId, f.foreignId,
    ];
    await db.delete(employeeContracts).where(inArray(employeeContracts.userId, userIds));
    await db.delete(employeeAuditLogs).where(inArray(employeeAuditLogs.userId, userIds));
    await db.delete(employeeProfiles).where(inArray(employeeProfiles.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await db.delete(branches).where(inArray(branches.id, [f.branchId, f.otherBranchId]));
    await db.delete(companies).where(inArray(companies.id, [f.companyId, f.otherCompanyId]));
}

function makeRequest(path: string): Request {
    return new Request(`http://localhost${path}`);
}

let fixtures: Fixtures;

beforeEach(async () => {
    const companyId = randomUUID();
    fixtures = await seed(companyId);
    tenant.companyId = companyId;
});

afterEach(async () => {
    await cleanup(fixtures);
});

describe("GET /api/imss/altas (Phase 0)", () => {
    it("clasifica con RFC 13, cuenta días hábiles y marca vencido sin degradar el estatus", async () => {
        const res = await altasGET(makeRequest("/api/imss/altas") as never);
        expect(res.status).toBe(200);

        const body = await res.json();
        const fila = body.altas.find((a: { userId: string }) => a.userId === fixtures.altaOverdueId);

        expect(fila).toBeDefined();
        // H1: RFC de 13 caracteres es VÁLIDO → nadie llega a `PENDING` por RFC.
        expect(fila.blockedReasons).toEqual([]);
        expect(fila.status).toBe("READY");
        // H2: vencida Y seleccionable a la vez.
        expect(fila.overdue).toBe(true);
        // H10: salario real del contrato vigente en centavos.
        expect(fila.baseSalaryCents).toBe(35_000);
        // H11: 30 días de calendario NO son 30 días hábiles.
        expect(fila.daysSinceHire).toBe(businessDaysSince(daysAgo(30)));
        expect(fila.daysSinceHire).toBeGreaterThan(5);
        expect(fila.daysSinceHire).toBeLessThan(30);
    });

    it("acepta RFC de persona moral (12) sin relajar la validación", async () => {
        const body = await (await altasGET(makeRequest("/api/imss/altas") as never)).json();
        const fila = body.altas.find((a: { userId: string }) => a.userId === fixtures.altaRecentId);

        expect(fila.blockedReasons).toEqual([]);
        expect(fila.status).toBe("READY");
        expect(fila.overdue).toBe(false);
    });

    it("sin contrato vigente queda PENDIENTE con SIN_SALARIO_BASE (decisión 5)", async () => {
        const body = await (await altasGET(makeRequest("/api/imss/altas") as never)).json();
        const fila = body.altas.find((a: { userId: string }) => a.userId === fixtures.altaNoContractId);

        expect(fila.baseSalaryCents).toBeNull();
        expect(fila.status).toBe("PENDING");
        expect(fila.blockedReasons).toContain("SIN_SALARIO_BASE");
    });

    it("excluye terminados, inactivos y empleados de otra empresa (H13 + tenant)", async () => {
        const body = await (await altasGET(makeRequest("/api/imss/altas") as never)).json();
        const ids = body.altas.map((a: { userId: string }) => a.userId);

        expect(ids).not.toContain(fixtures.bajaId);
        expect(ids).not.toContain(fixtures.inactiveId);
        expect(ids).not.toContain(fixtures.foreignId);
        expect(ids.sort()).toEqual(
            [fixtures.altaOverdueId, fixtures.altaRecentId, fixtures.altaNoContractId].sort(),
        );
    });

    it("el summary cuadra con las filas devueltas y branches no fuga otras empresas", async () => {
        const body = await (await altasGET(makeRequest("/api/imss/altas") as never)).json();

        expect(body.summary.ready + body.summary.pending + body.summary.registered)
            .toBe(body.altas.length);
        expect(body.summary).toMatchObject({ ready: 2, pending: 1, overdue: 1, registered: 0 });

        const branchNames = body.branches.map((b: { name: string }) => b.name);
        expect(branchNames).toContain("Sucursal IMSS");
        expect(branchNames).not.toContain("Sucursal ajena");
    });

    it("aísla por empresa cuando la sesión apunta a otro tenant", async () => {
        tenant.companyId = fixtures.otherCompanyId;
        const body = await (await altasGET(makeRequest("/api/imss/altas") as never)).json();

        expect(body.altas.map((a: { userId: string }) => a.userId)).toEqual([fixtures.foreignId]);
    });
});

describe("GET /api/imss/bajas (Phase 0)", () => {
    it("devuelve la baja real con fecha, motivo y plazo en días hábiles (H3, H4)", async () => {
        const res = await bajasGET(makeRequest("/api/imss/bajas") as never);
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.bajas).toHaveLength(1);

        const fila = body.bajas[0];
        expect(fila.userId).toBe(fixtures.bajaId);
        expect(fila.status).toBe("READY");
        // H4: el motivo es el capturado, no un "Voluntary Resignation" inventado.
        expect(fila.terminationReason).toBe("TERMINATION_WITHOUT_CAUSE");
        expect(fila.terminationDate).toBe(daysAgo(3).toISOString());
        expect(fila.daysSinceTermination).toBe(businessDaysSince(daysAgo(3)));
        expect(fila.overdue).toBe(false);
        expect(body.summary).toMatchObject({ ready: 1, pending: 0, overdue: 0 });
    });
});

describe('T9–T10 — ciclo real contra Neon aislado', () => {
    const post = (id: string, movementType: 'ALTA' | 'BAJA') => filesPOST(new NextRequest('http://localhost/api/imss/files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeIds: [id], movementType, fechaMovimiento: daysAgoIso(0) }),
    }));
    const acknowledge = (id: string, accepted: boolean) => filePATCH(new NextRequest(`http://localhost/api/imss/files/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(accepted ? { accepted, acuseFolio: 'IDSE-TEST-123' } : { accepted, reason: 'Corregir identidad' }),
    }), { params: Promise.resolve({ id }) });
    it('alta: generar deja EN_ARCHIVO; acuse aceptado quita el pendiente y actualiza contador', async () => {
        const generated = await post(fixtures.altaRecentId, 'ALTA');
        expect(generated.status).toBe(200);
        const before = await (await altasGET(makeRequest('/api/imss/altas') as never)).json();
        expect(before.altas.find((row: { userId: string }) => row.userId === fixtures.altaRecentId)).toMatchObject({ status: 'PENDING', imssStatus: 'EN_ARCHIVO' });
        expect((await acknowledge(generated.headers.get('X-File-Id')!, true)).status).toBe(200);
        const after = await (await altasGET(makeRequest('/api/imss/altas') as never)).json();
        expect(after.altas.find((row: { userId: string }) => row.userId === fixtures.altaRecentId)).toMatchObject({ status: 'REGISTERED', imssStatus: 'CONFIRMADO' });
        expect(after.summary.registered).toBe(1);
    });
    it('baja: archivo y acuse cambian el estado real y el contador', async () => {
        const generated = await post(fixtures.bajaId, 'BAJA');
        expect(generated.status).toBe(200);
        expect((await acknowledge(generated.headers.get('X-File-Id')!, true)).status).toBe(200);
        const after = await (await bajasGET(makeRequest('/api/imss/bajas') as never)).json();
        expect(after.bajas[0]).toMatchObject({ status: 'DEREGISTERED', imssStatus: 'CONFIRMADO' });
        expect(after.summary.registered).toBe(1);
    });
    it('acuse rechazado devuelve el alta a seleccionable', async () => {
        const generated = await post(fixtures.altaRecentId, 'ALTA');
        expect(generated.status).toBe(200);
        expect((await acknowledge(generated.headers.get('X-File-Id')!, false)).status).toBe(200);
        const after = await (await altasGET(makeRequest('/api/imss/altas') as never)).json();
        expect(after.altas.find((row: { userId: string }) => row.userId === fixtures.altaRecentId)).toMatchObject({ status: 'READY', imssStatus: 'RECHAZADO' });
    });
    it('T18: un empleado recorre alta pendiente → archivo → acuse → baja → archivo → acuse', async () => {
        const employeeId = fixtures.altaRecentId;
        const alta = async () => (await (await altasGET(makeRequest('/api/imss/altas') as never)).json()).altas
            .find((row: { userId: string }) => row.userId === employeeId);
        const baja = async () => (await (await bajasGET(makeRequest('/api/imss/bajas') as never)).json()).bajas
            .find((row: { userId: string }) => row.userId === employeeId);
        expect(await alta()).toMatchObject({ status: 'READY', imssStatus: 'SIN_ALTA' });
        const altaFile = await post(employeeId, 'ALTA');
        expect(altaFile.status).toBe(200);
        expect(await alta()).toMatchObject({ status: 'PENDING', imssStatus: 'EN_ARCHIVO' });
        expect((await acknowledge(altaFile.headers.get('X-File-Id')!, true)).status).toBe(200);
        expect(await alta()).toMatchObject({ status: 'REGISTERED', imssStatus: 'CONFIRMADO' });

        await EmployeeService.updateEmployee(employeeId, fixtures.companyId, { employeeStatus: 'RESIGNED', isActive: false,
            terminationDate: daysAgoIso(0), terminationReason: 'VOLUNTARY_RESIGNATION' }, 'imss-phase0-tester');
        expect(await alta()).toBeUndefined();
        expect(await baja()).toMatchObject({ status: 'READY', imssStatus: 'SIN_BAJA', terminationReason: 'VOLUNTARY_RESIGNATION' });
        const bajaFile = await post(employeeId, 'BAJA');
        expect(bajaFile.status).toBe(200);
        expect(bajaFile.headers.get('X-File-Id')).not.toBe(altaFile.headers.get('X-File-Id'));
        expect(await baja()).toMatchObject({ status: 'PENDING', imssStatus: 'EN_ARCHIVO' });
        expect((await acknowledge(bajaFile.headers.get('X-File-Id')!, true)).status).toBe(200);
        expect(await baja()).toMatchObject({ status: 'DEREGISTERED', imssStatus: 'CONFIRMADO' });
        expect((await post(employeeId, 'BAJA')).status).toBe(409);
    });
});

describe("ciclo alta → baja por el camino de la UI (H4)", () => {
    it("persiste terminationDate/terminationReason y la baja aparece en el aviso", async () => {
        const effectiveDate = daysAgoIso(1);

        await EmployeeService.updateEmployee(
            fixtures.altaRecentId,
            fixtures.companyId,
            {
                employeeStatus: "TERMINATED",
                isActive: false,
                terminationDate: effectiveDate,
                terminationReason: "VOLUNTARY_RESIGNATION",
            },
            "imss-phase0-tester",
        );

        const [profile] = await db
            .select({
                employeeStatus: employeeProfiles.employeeStatus,
                terminationDate: employeeProfiles.terminationDate,
                terminationReason: employeeProfiles.terminationReason,
            })
            .from(employeeProfiles)
            .where(eq(employeeProfiles.userId, fixtures.altaRecentId));

        expect(profile.employeeStatus).toBe("TERMINATED");
        expect(profile.terminationReason).toBe("VOLUNTARY_RESIGNATION");
        expect(profile.terminationDate?.toISOString().slice(0, 10)).toBe(effectiveDate);

        // La baja recién creada ya se puede avisar al IMSS…
        const bajas = await (await bajasGET(makeRequest("/api/imss/bajas") as never)).json();
        const nueva = bajas.bajas.find((b: { userId: string }) => b.userId === fixtures.altaRecentId);
        expect(nueva).toBeDefined();
        expect(nueva.terminationReason).toBe("VOLUNTARY_RESIGNATION");
        expect(nueva.status).toBe("READY");

        // …y deja de estar pendiente de alta.
        const altas = await (await altasGET(makeRequest("/api/imss/altas") as never)).json();
        expect(altas.altas.map((a: { userId: string }) => a.userId))
            .not.toContain(fixtures.altaRecentId);
    });

    it("una fecha vacía del formulario limpia el campo en vez de reventar", async () => {
        // El diálogo manda `""` cuando el campo está en blanco: Drizzle hacía
        // `"".toISOString()` y la petición terminaba en 500.
        await expect(
            EmployeeService.updateEmployee(
                fixtures.altaOverdueId,
                fixtures.companyId,
                { terminationDate: "", seniorityDate: "" },
                "imss-phase0-tester",
            ),
        ).resolves.toBeDefined();

        const [profile] = await db
            .select({ terminationDate: employeeProfiles.terminationDate })
            .from(employeeProfiles)
            .where(eq(employeeProfiles.userId, fixtures.altaOverdueId));
        expect(profile.terminationDate).toBeNull();
    });

    it("rechaza en el borde una fecha de baja imposible", async () => {
        await expect(
            EmployeeService.updateEmployee(
                fixtures.altaOverdueId,
                fixtures.companyId,
                { terminationDate: "no-es-una-fecha" },
                "imss-phase0-tester",
            ),
        ).rejects.toThrow(/Fecha inválida/);
    });
});
