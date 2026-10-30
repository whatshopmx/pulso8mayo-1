import { describe, expect, it } from 'vitest';
import { hasPermission, type Role, type Resource, type Action } from '@/lib/permissions';

const roles: Role[] = ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'];
const direction: Role[] = ['SUPER_ADMIN', 'OWNER', 'ADMIN'];

describe('RP-01 · política de capacidades', () => {
  it.each(roles)('%s: recursos y acciones desconocidos fallan cerrados', role => {
    expect(hasPermission(role, 'unknown' as Resource, 'read')).toBe(false);
    expect(hasPermission(role, 'reports', 'unknown' as Action)).toBe(false);
    expect(hasPermission('UNKNOWN' as Role, 'reports', 'read')).toBe(false);
    expect(hasPermission(role, '__proto__' as Resource, 'read')).toBe(false);
  });

  it.each(roles)('%s: capacidades separadas, sin herencia numérica', role => {
    const cases: [string, string, Role[]][] = [
      ['executive', 'read', direction],
      ['executive', 'reason', direction],
      ['executive', 'refresh', direction],
      ['executive', 'resolve', direction],
      ['executive', 'export', direction],
      ['financial-summary', 'read', [...direction, 'GERENTE']],
      ['payroll', 'manage', direction],
      ['workflows', 'execute', [...direction, 'GERENTE', 'SUPERVISOR', 'EMPLEADO']],
      ['workflows', 'build', [...direction, 'GERENTE']],
      ['incidents', 'resolve', [...direction, 'GERENTE', 'SUPERVISOR']],
      ['incidents', 'create', [...direction, 'GERENTE', 'SUPERVISOR', 'EMPLEADO']],
      ['reports', 'export', [...direction, 'GERENTE', 'SUPERVISOR', 'READONLY']],
      ['profile', 'update', roles.filter(r => r !== 'READONLY')],
    ];
    for (const [resource, action, allowed] of cases) {
      expect(hasPermission(role, resource as Resource, action as Action), `${resource}:${action}`)
        .toBe(allowed.includes(role));
    }
  });

  it('READONLY solo consulta negocio; estado técnico usa otro contrato', () => {
    for (const resource of ['executive', 'financial-summary', 'payroll', 'workflows', 'incidents', 'reports', 'users', 'profile']) {
      for (const action of ['create', 'update', 'delete', 'manage', 'execute', 'resolve', 'build', 'refresh', 'reason']) {
        expect(hasPermission('READONLY', resource as Resource, action as Action), `${resource}:${action}`).toBe(false);
      }
    }
  });
});
