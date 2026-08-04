import { roleEnum } from "./db/schema";

export type Role = typeof roleEnum.enumValues[number];

export type Resource =
    | 'users'
    | 'companies'
    | 'branches'
    | 'workflows'
    | 'inventory'
    | 'reports'
    | 'settings'
    | 'billing';

export type Action = 'create' | 'read' | 'update' | 'delete' | 'manage';

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

export const PERMISSIONS: PermissionMatrix = {
    'SUPER_ADMIN': {
        // Full access implicitly handled in logic, but explicit here for clarity
        'users': ['manage'],
        'companies': ['manage'],
        'branches': ['manage'],
        'workflows': ['manage'],
        'inventory': ['manage'],
        'reports': ['manage'],
        'settings': ['manage'],
        'billing': ['manage']
    },
    'OWNER': {
        'users': ['manage'],
        'companies': ['manage'],
        'branches': ['manage'],
        'workflows': ['manage'],
        'inventory': ['manage'],
        'reports': ['manage'],
        'settings': ['manage'],
        'billing': ['manage']
    },
    'ADMIN': {
        'users': ['manage'],
        'companies': ['read', 'update'],
        'branches': ['manage'],
        'workflows': ['manage'],
        'inventory': ['manage'],
        'reports': ['manage'],
        'settings': ['manage'],
        'billing': ['read'] // Cannot modify billing
    },
    'GERENTE': {
        'users': ['read', 'create', 'update'], // Can manage branch users
        'companies': ['read'],
        'branches': ['read', 'update'],
        'workflows': ['read', 'create', 'update', 'delete'], // Can manage workflows
        'inventory': ['manage'],
        'reports': ['read'],
        'settings': ['read'],
        'billing': []
    },
    'SUPERVISOR': {
        'users': ['read'],
        'companies': ['read'],
        'branches': ['read'],
        'workflows': ['read', 'create', 'update'], // Assignment mainly
        'inventory': ['read', 'update', 'create'],
        'reports': ['read'],
        'settings': [],
        'billing': []
    },
    'EMPLEADO': {
        'users': ['read'], // Can see team
        'companies': ['read'],
        'branches': ['read'],
        'workflows': ['read', 'update'], // Execute steps
        'inventory': ['read'],
        'reports': [],
        'settings': [],
        'billing': []
    },
    'READONLY': {
        'users': ['read'],
        'companies': ['read'],
        'branches': ['read'],
        'workflows': ['read'],
        'inventory': ['read'],
        'reports': ['read'],
        'settings': ['read'],
        'billing': []
    }
};

/**
 * Check if a user role has permission to perform an action on a resource.
 */
export function hasPermission(userRole: Role, resource: Resource, action: Action): boolean {
    if (!userRole) return false;

    // Super Admin bypass
    if (userRole === 'SUPER_ADMIN') return true;

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
