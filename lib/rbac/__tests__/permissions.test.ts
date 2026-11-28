import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    ROUTE_PERMISSIONS,
    getDefaultDashboard,
    getAccessibleRoutes,
    hasAccess,
    type UserRole,
} from '../permissions';

/**
 * Suite de Task 7 (plan.md): RBAC de rutas sobre `lib/rbac/permissions.ts`.
 *
 * Contratos:
 * - `hasAccess` barre ROUTE_PERMISSIONS ordenando por longitud de path
 *   descendente y gana la entrada MÁS ESPECÍFICA que haga match (exacta o
 *   por prefijo `path + '/'`). Si ninguna hace match → false con warning
 *   (fail-cerrado).
 * - Los dashboards default por rol deben ser SIEMPRE accesibles para ese rol:
 *   ningún redirect puede aterrizar en una ruta prohibida.
 * - OWNER tiene acceso explícito a inicio y autoservicio de vacaciones;
 *   no hereda implícitamente las rutas administrativas.
 */

const ROLES: UserRole[] = [
    'SUPER_ADMIN',
    'OWNER',
    'ADMIN',
    'GERENTE',
    'SUPERVISOR',
    'EMPLEADO',
    'READONLY',
];

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ROUTE_PERMISSIONS (sanidad del catálogo)', () => {
    it('cada ruta tiene al menos un rol permitido y path absoluto', () => {
        for (const route of ROUTE_PERMISSIONS) {
            expect(route.path.startsWith('/'), route.path).toBe(true);
            expect(route.allowedRoles.length, route.path).toBeGreaterThan(0);
            for (const role of route.allowedRoles) {
                expect(ROLES, `${route.path}:${role}`).toContain(role);
            }
        }
    });

    it('no hay rutas duplicadas (la más específica debe existir una sola vez)', () => {
        const paths = ROUTE_PERMISSIONS.map((r) => r.path);
        expect(new Set(paths).size).toBe(paths.length);
    });
});

describe('hasAccess — barrido completo rol × ruta', () => {
    // El catálogo es finito (~40 rutas): se barre completo, sin muestrear.
    it.each(ROLES)('rol %s coincide exactamente con allowedRoles', (role) => {
        for (const route of ROUTE_PERMISSIONS) {
            const esperado = route.allowedRoles.includes(role);
            expect(hasAccess(role, route.path), `${role} → ${route.path}`).toBe(esperado);
        }
    });
});

describe('hasAccess — sub-rutas heredan la entrada más específica', () => {
    it('EMPLEADO accede a autoservicio laboral (vacaciones, cambios de turno, permisos) sin abrir gestión', () => {
        for (const role of ['OWNER', 'EMPLEADO'] as UserRole[]) {
            expect(hasAccess(role, '/dashboard/labor/vacations'), role).toBe(true);
            expect(hasAccess(role, '/dashboard/labor/shift-changes'), role).toBe(true);
            expect(hasAccess(role, '/dashboard/labor/shift-changes/req-1'), role).toBe(true);
            expect(hasAccess(role, '/dashboard/labor/leave'), role).toBe(true);
        }
        expect(hasAccess('EMPLEADO', '/dashboard/labor/approvals')).toBe(false);
        expect(hasAccess('EMPLEADO', '/dashboard/labor/payroll')).toBe(false);
        expect(hasAccess('READONLY', '/dashboard/labor/vacations')).toBe(false);
        expect(hasAccess('READONLY', '/dashboard/labor/shift-changes')).toBe(false);
    });

    it('SUPERVISOR accede solo a Caja Chica y Cortes de Ventas, no a Finanzas corporativas', () => {
        expect(hasAccess('SUPERVISOR', '/dashboard/finance/petty-cash')).toBe(true);
        expect(hasAccess('SUPERVISOR', '/dashboard/sales')).toBe(true);
        expect(hasAccess('SUPERVISOR', '/dashboard/finance')).toBe(false);
        expect(hasAccess('SUPERVISOR', '/dashboard/finance/expenses')).toBe(false);
        expect(hasAccess('SUPERVISOR', '/dashboard/finance/settings/bank-accounts')).toBe(false);
        expect(hasAccess('GERENTE', '/dashboard/finance/expenses')).toBe(true);
    });
    it('EMPLEADO accede a sub-ruta de workflows (su entrada específica lo permite)', () => {
        expect(hasAccess('EMPLEADO', '/dashboard/workflows')).toBe(true);
        expect(hasAccess('EMPLEADO', '/dashboard/workflows/paso-1')).toBe(true);
    });

    it('EMPLEADO NO accede a sub-rutas de labor aunque /dashboard sí le permita', () => {
        // La entrada exacta '/dashboard/labor/violations' (más larga) vence al
        // comodín '/dashboard' — así funciona la resolución por longitud.
        expect(hasAccess('EMPLEADO', '/dashboard/labor/violations')).toBe(false);
        expect(hasAccess('SUPERVISOR', '/dashboard/labor/violations')).toBe(true);
    });

    it('EMPLEADO y READONLY NO acceden a sub-rutas de finance ni sales', () => {
        // Regresión documentada en el propio catálogo: sin estas entradas,
        // caían al comodín '/dashboard' y cualquier empleado leía tesorería.
        for (const role of ['EMPLEADO', 'READONLY'] as UserRole[]) {
            expect(hasAccess(role, '/dashboard/finance/autorizaciones'), role).toBe(false);
            expect(hasAccess(role, '/dashboard/sales/cortes'), role).toBe(false);
        }
    });

    it('executive y nómina quedan restringidos exclusivamente a SUPER_ADMIN, OWNER y ADMIN', () => {
        const restrictedPaths = [
            '/dashboard/executive',
            '/dashboard/executive/subruta',
            '/dashboard/labor/payroll',
            '/dashboard/compliance/payroll',
        ];
        for (const path of restrictedPaths) {
            for (const role of ['SUPER_ADMIN', 'OWNER', 'ADMIN'] as UserRole[]) {
                expect(hasAccess(role, path), `${role} → ${path}`).toBe(true);
            }
            for (const role of ['GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'] as UserRole[]) {
                expect(hasAccess(role, path), `${role} → ${path}`).toBe(false);
            }
        }
    });

    it('EMPLEADO NO accede a budgets, exceptions ni civil-protection, pero sí a my-tasks y notifications', () => {
        expect(hasAccess('EMPLEADO', '/dashboard/budgets')).toBe(false);
        expect(hasAccess('EMPLEADO', '/dashboard/exceptions')).toBe(false);
        expect(hasAccess('EMPLEADO', '/dashboard/civil-protection')).toBe(false);
        expect(hasAccess('EMPLEADO', '/dashboard/my-tasks')).toBe(true);
        expect(hasAccess('EMPLEADO', '/dashboard/notifications')).toBe(true);
    });

    it('sub-ruta desconocida bajo /dashboard falla cerrada (sin heredar el comodín)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        for (const role of ROLES) {
            expect(hasAccess(role, '/dashboard/ruta-no-registrada'), role).toBe(false);
        }
        expect(warn).toHaveBeenCalled();
    });
});

describe('hasAccess — rutas desconocidas denegadas (fail-cerrado)', () => {
    it('un path sin entrada devuelve false y emite warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(hasAccess('SUPER_ADMIN', '/panel-secreto')).toBe(false);
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0][0]).toContain('/panel-secreto');
    });

    it('un path que sólo COMPART prefijo textual no hereda permisos', () => {
        // '/dashboardxyz' NO empieza con '/dashboard/' ni es igual: debe caer
        // al caso desconocido aunque '/dashboard' admita a todos los roles.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        for (const role of ROLES) {
            expect(hasAccess(role, '/dashboardxyz'), role).toBe(false);
        }
        expect(warn).toHaveBeenCalled();
    });

    it('trailing slash cuenta como sub-ruta, no como desconocida', () => {
        expect(hasAccess('EMPLEADO', '/dashboard/')).toBe(true);
    });
});

describe('getDefaultDashboard', () => {
    it('valores explícitos por rol', () => {
        expect(getDefaultDashboard('SUPER_ADMIN')).toBe('/dashboard');
        expect(getDefaultDashboard('ADMIN')).toBe('/dashboard');
        expect(getDefaultDashboard('GERENTE')).toBe('/dashboard');
        expect(getDefaultDashboard('SUPERVISOR')).toBe('/dashboard');
        expect(getDefaultDashboard('EMPLEADO')).toBe('/dashboard/workflows');
        expect(getDefaultDashboard('READONLY')).toBe('/dashboard/analytics');
    });

    it('INVARIANTE: el dashboard default de cada rol es accesible para ese rol', () => {
        // Ningún redirect de login puede aterrizar en una ruta prohibida.
        for (const role of ROLES) {
            const destino = getDefaultDashboard(role);
            expect(hasAccess(role, destino), `${role} → ${destino}`).toBe(true);
        }
    });
});

describe('getAccessibleRoutes', () => {
    it.each(ROLES)('%s: devuelve exactamente las rutas cuyo hasAccess es true', (role) => {
        const rutas = getAccessibleRoutes(role);
        const esperadas = ROUTE_PERMISSIONS.filter((r) =>
            r.allowedRoles.includes(role)
        );
        expect(rutas).toEqual(esperadas);
        for (const ruta of rutas) {
            expect(hasAccess(role, ruta.path)).toBe(true);
        }
    });

    it('ningún rol obtiene un catálogo vacío', () => {
        for (const role of ROLES) {
            expect(getAccessibleRoutes(role).length, role).toBeGreaterThan(0);
        }
    });
});
