/**
 * Role-based access control configuration
 * Defines which roles can access which routes
 */

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'GERENTE' | 'SUPERVISOR' | 'EMPLEADO' | 'READONLY';

export interface RoutePermission {
    path: string;
    allowedRoles: UserRole[];
    description?: string;
}

/**
 * Route permissions configuration
 * More specific paths should come first
 */
export const ROUTE_PERMISSIONS: RoutePermission[] = [
  // === Super Admin only ===
  {
    path: '/dashboard/billing',
    allowedRoles: ['SUPER_ADMIN'],
    description: 'Billing and subscription management'
  },

  // === Admin only ===
  {
    path: '/dashboard/company',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN'],
    description: 'Company settings, branches, and organization management'
  },

  // === Admin + Gerente ===
  {
    path: '/dashboard/team',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE'],
    description: 'User management and team settings'
  },
  {
    path: '/dashboard/builder',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE'],
    description: 'Workflow template builder'
  },

  // === Management tier (SUPER_ADMIN, ADMIN, GERENTE, SUPERVISOR) ===
  {
    path: '/dashboard/operations',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Operations dashboard - management only'
  },
  {
    path: '/dashboard/execute',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO'],
    description: 'Quick workflow execution'
  },
  {
    path: '/dashboard/evidence',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO'],
    description: 'Evidence collection and review'
  },
  {
    path: '/dashboard/incidents',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO'],
    description: 'Incident management'
  },
  {
    path: '/dashboard/inventory',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Inventory management'
  },
  {
    path: '/dashboard/equipment',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Equipment management'
  },
  {
    path: '/dashboard/compliance',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Compliance dashboard'
  },
  {
    path: '/dashboard/audit',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Audit logs'
  },
  {
    path: '/dashboard/reports',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Reports'
  },
  {
    path: '/dashboard/ai-verifications',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'AI verification results'
  },
  {
    path: '/dashboard/performance',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Performance management'
  },
  {
    path: '/dashboard/schedules',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Schedule management'
  },
  {
    path: '/dashboard/analytics',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Analytics and reports'
  },
  {
    path: '/dashboard/branches',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Branch performance comparison and ranking'
  },

  // === Finance module (EMPLEADO y READONLY denegados) ===
  // Sin esta entrada `hasAccess` caía al comodín `/dashboard` (abajo), que
  // admite los seis roles: cualquier empleado podía leer el libro de gastos de
  // todas las sucursales —costos de proveedor y montos colindantes con nómina—
  // escribiendo la URL. El sidebar oculta el enlace, pero eso es cosmético: un
  // marcador o el `actionUrl` de una notificación aterrizan igual.
  // READONLY queda fuera a propósito: esta pantalla autoriza pagos, y el rol
  // existe para consultar operación, no tesorería.
  {
    path: '/dashboard/finance',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Finance module: expenses, authorizations, cash flow and petty cash'
  },

  // === Sales module (misma lista que Finanzas) ===
  // Sin esta entrada `hasAccess` caía al comodín `/dashboard`, que admite los
  // seis roles: cualquier empleado podía leer el corte del día y el arqueo de
  // caja de todas las sucursales —y la pantalla de mapeo POS, que decide cómo
  // se ingesta la venta— escribiendo la URL. El sidebar oculta el enlace, pero
  // eso es cosmético.
  // READONLY queda fuera por el mismo criterio que Finanzas: el arqueo de caja
  // es tesorería, no consulta de operación.
  {
    path: '/dashboard/sales',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Sales module: daily cuts, cash reconciliation and POS mapping'
  },

  // === Labor module - management sub-routes (EMPLEADO denied) ===
  {
    path: '/dashboard/labor/attendance',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Attendance management'
  },
  {
    path: '/dashboard/labor/shifts',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Shift management'
  },
  {
    path: '/dashboard/labor/schedule-builder',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Schedule builder'
  },
  {
    path: '/dashboard/labor/shift-changes',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Shift change requests'
  },
  {
    path: '/dashboard/labor/approvals',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Approval management'
  },
  {
    path: '/dashboard/labor/breaks',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Break compliance monitoring'
  },
  {
    path: '/dashboard/labor/overtime',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Overtime management'
  },
  {
    path: '/dashboard/labor/vacations',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Vacation management'
  },
  {
    path: '/dashboard/labor/geolocation',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Geolocation tracking'
  },
  {
    path: '/dashboard/labor/holidays',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Holiday management'
  },
  {
    path: '/dashboard/labor/documents',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Employee documents/expediente'
  },
  {
    path: '/dashboard/labor/violations',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Labor violations'
  },

  // === Employee directory (management only) ===
  {
    path: '/dashboard/employees',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Employee directory and management'
  },

  // === Labor dashboard (management only - shows sensitive data) ===
  {
    path: '/dashboard/labor',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Labor management dashboard - shows company-wide sensitive data'
  },

  // === Workflows - All roles except ReadOnly ===
  {
    path: '/dashboard/workflows',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO'],
    description: 'Execute and view workflows'
  },

  // === Profile - All roles ===
  {
    path: '/dashboard/profile',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'],
    description: 'User profile settings'
  },

  // === Onboarding - All roles (for users without companyId) ===
  {
    path: '/onboarding',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'],
    description: 'Onboarding flow for new users without company'
  },

  // === Dashboard home - All roles ===
  {
    path: '/dashboard',
    allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'],
    description: 'Main dashboard'
  }
];

/**
 * Check if a user role has access to a specific path
 */
export function hasAccess(userRole: UserRole, path: string): boolean {
  const sortedRoutes = [...ROUTE_PERMISSIONS].sort((a, b) => b.path.length - a.path.length);

  const matchingRoute = sortedRoutes.find(route =>
    path === route.path || path.startsWith(route.path + '/')
  );

  if (!matchingRoute) {
    console.warn(`[RBAC] No permission defined for path: ${path}`);
    return false;
  }

  return matchingRoute.allowedRoles.includes(userRole);
}

/**
 * Get the redirect path for a user based on their role
 */
export function getDefaultDashboard(userRole: UserRole): string {
    switch (userRole) {
        case 'SUPER_ADMIN':
        case 'ADMIN':
        case 'GERENTE':
        case 'SUPERVISOR':
            return '/dashboard';
        case 'EMPLEADO':
            return '/dashboard/workflows';
        case 'READONLY':
            return '/dashboard/analytics';
        default:
            return '/dashboard';
    }
}

/**
 * Get accessible routes for a specific role
 */
export function getAccessibleRoutes(userRole: UserRole): RoutePermission[] {
    return ROUTE_PERMISSIONS.filter(route =>
        route.allowedRoles.includes(userRole)
    );
}
