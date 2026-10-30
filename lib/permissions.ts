// `import type` a propósito: `roleEnum` solo se usa para derivar el tipo `Role`.
// Un import de valor arrastraría todo el schema de Drizzle al bundle de cualquier
// componente cliente que consuma este módulo (p. ej. la página de gastos).
import type { roleEnum } from "./db/schema";

export type Role = typeof roleEnum.enumValues[number];

const CRUD = ['create', 'read', 'update', 'delete', 'manage'] as const;

// Catálogo puro: manage cubre únicamente acciones definidas para el recurso.
// Las capacidades base nunca sustituyen scope, clasificación o guardas fiscales.
export const RESOURCE_ACTIONS = {
    users: CRUD,
    companies: CRUD,
    branches: CRUD,
    workflows: [...CRUD, 'execute', 'build'],
    inventory: CRUD,
    reports: [...CRUD, 'export'],
    settings: CRUD,
    billing: CRUD,
    exceptions: CRUD,
    executive: ['read', 'resolve', 'reason', 'refresh', 'export', 'manage'],
    'financial-summary': ['read'],
    payroll: CRUD,
    incidents: [...CRUD, 'resolve'],
    profile: ['read', 'update'],
} as const;

export type Resource = keyof typeof RESOURCE_ACTIONS;
export type Action = typeof RESOURCE_ACTIONS[Resource][number];

type PermissionMatrix = Record<Role, Partial<Record<Resource, Action[]>>>;

export const ROLES_HIERARCHY: Record<Role, number> = {
    'SUPER_ADMIN': 100,
    'OWNER': 95,
    'ADMIN': 90,
    'GERENTE': 80, // Manager
    'SUPERVISOR': 50,
    'EMPLEADO': 10,
    'READONLY': 0
};

/**
 * Niveles de autoridad para roles *aprobadores*.
 *
 * `expense_authorization_rules.approver_role` es una columna `text` libre
 * (schema.ts:2704) y admite `DIRECTOR_OPS`, que NO existe en `roleEnum`: ningún
 * usuario lo porta, pero una regla puede exigirlo. Se sitúa entre GERENTE (80)
 * y ADMIN (90), de modo que solo ADMIN/OWNER/SUPER_ADMIN lo satisfacen.
 *
 * Superconjunto de ROLES_HIERARCHY: todo rol de usuario sigue siendo válido aquí.
 */
export const APPROVER_ROLES_HIERARCHY: Record<string, number> = {
    ...ROLES_HIERARCHY,
    'DIRECTOR_OPS': 85,
};

/**
 * ¿La autoridad de `userRole` alcanza la exigida por `requiredRole`?
 *
 * Falla cerrado: un rol ausente del mapa deniega, en lugar de resolverse a 0 —
 * con `?? 0` un `approver_role` mal escrito volvía `requiredLevel` cero y
 * cualquiera, incluido READONLY, satisfacía la regla.
 */
export function roleIsAtLeast(userRole: string, requiredRole: string): boolean {
    const userLevel = APPROVER_ROLES_HIERARCHY[userRole];
    const requiredLevel = APPROVER_ROLES_HIERARCHY[requiredRole];

    if (userLevel === undefined || requiredLevel === undefined) {
        console.error(
            `[permissions] Rol desconocido en verificación de autoridad — se deniega. ` +
            `userRole="${userRole}" (${userLevel === undefined ? "no reconocido" : "ok"}), ` +
            `requiredRole="${requiredRole}" (${requiredLevel === undefined ? "no reconocido" : "ok"}). ` +
            `Roles válidos: ${Object.keys(APPROVER_ROLES_HIERARCHY).join(", ")}.`
        );
        return false;
    }

    return userLevel >= requiredLevel;
}

export const PERMISSIONS: PermissionMatrix = {
    'SUPER_ADMIN': {
        // Autoridad explícita; no bypass para recursos/acciones desconocidos.
        'users': ['manage'],
        'companies': ['manage'],
        'branches': ['manage'],
        'workflows': ['manage'],
        'inventory': ['manage'],
        'reports': ['manage'],
        'settings': ['manage'],
        'billing': ['manage'],
        'exceptions': ['manage'],
        'executive': ['manage'],
        'financial-summary': ['read'],
        'payroll': ['manage'],
        'incidents': ['manage'],
        'profile': ['read', 'update']
    },
    'OWNER': {
        'users': ['manage'],
        'companies': ['manage'],
        'branches': ['manage'],
        'workflows': ['manage'],
        'inventory': ['manage'],
        'reports': ['manage'],
        'settings': ['manage'],
        'billing': ['manage'],
        'exceptions': ['manage'],
        'executive': ['manage'],
        'financial-summary': ['read'],
        'payroll': ['manage'],
        'incidents': ['manage'],
        'profile': ['read', 'update']
    },
    'ADMIN': {
        'users': ['manage'],
        'companies': ['read', 'update'],
        'branches': ['manage'],
        'workflows': ['manage'],
        'inventory': ['manage'],
        'reports': ['manage'],
        'settings': ['manage'],
        'billing': ['read'], // Cannot modify billing
        'exceptions': ['manage'],
        'executive': ['manage'],
        'financial-summary': ['read'],
        'payroll': ['manage'],
        'incidents': ['manage'],
        'profile': ['read', 'update']
    },
    'GERENTE': {
        'users': ['read', 'create', 'update'], // Can manage branch users
        'companies': ['read'],
        'branches': ['read', 'update'],
        'workflows': ['read', 'create', 'update', 'delete', 'execute', 'build'],
        'inventory': ['manage'],
        'reports': ['read', 'export'],
        'settings': ['read'],
        'billing': [],
        'exceptions': ['read', 'update'],
        'financial-summary': ['read'],
        'incidents': ['read', 'create', 'update', 'resolve'],
        'profile': ['read', 'update']
    },
    'SUPERVISOR': {
        'users': ['read'],
        'companies': ['read'],
        'branches': ['read'],
        'workflows': ['read', 'create', 'update', 'execute'], // Assignment mainly
        'inventory': ['read', 'update', 'create'],
        'reports': ['read', 'export'],
        'settings': [],
        'billing': [],
        'exceptions': ['read', 'update'],
        'incidents': ['read', 'create', 'update', 'resolve'],
        'profile': ['read', 'update']
    },
    'EMPLEADO': {
        'users': ['read'], // Can see team
        'companies': ['read'],
        'branches': ['read'],
        'workflows': ['read', 'update', 'execute'], // Execute eligible assigned steps
        'inventory': ['read'],
        'reports': [],
        'settings': [],
        'billing': [],
        'exceptions': ['read'],
        'incidents': ['read', 'create'],
        'profile': ['read', 'update']
    },
    'READONLY': {
        'users': ['read'],
        'companies': ['read'],
        'branches': ['read'],
        'workflows': ['read'],
        'inventory': ['read'],
        'reports': ['read', 'export'],
        'settings': ['read'],
        'billing': [],
        'exceptions': ['read'],
        'incidents': ['read'],
        'profile': ['read']
    }
};

/**
 * Check if a user role has permission to perform an action on a resource.
 */
export function hasPermission(userRole: Role, resource: Resource, action: Action): boolean {
    if (!Object.prototype.hasOwnProperty.call(PERMISSIONS, userRole) ||
        !Object.prototype.hasOwnProperty.call(RESOURCE_ACTIONS, resource)) return false;
    const definedActions: readonly string[] = RESOURCE_ACTIONS[resource];
    if (!definedActions.includes(action)) return false;

    const rolePermissions = PERMISSIONS[userRole];
    if (!rolePermissions) return false;

    const resourcePermissions = rolePermissions[resource];
    if (!resourcePermissions) return false;

    if (resourcePermissions.includes('manage')) return true;

    return resourcePermissions.includes(action);
}

/**
 * Check if the acting user has higher or equal authority (hierarchy) than the target role.
 * Used to prevent lower roles from modifying higher roles.
 */
export function canManageRole(actingRole: Role, targetRole: Role): boolean {
    return ROLES_HIERARCHY[actingRole] >= ROLES_HIERARCHY[targetRole];
}
