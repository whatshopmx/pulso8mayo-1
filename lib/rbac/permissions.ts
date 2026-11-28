/**
 * Role-based access control configuration
 * Defines which roles can access which routes
 */

export type UserRole = 'SUPER_ADMIN' | 'OWNER' | 'ADMIN' | 'GERENTE' | 'SUPERVISOR' | 'EMPLEADO' | 'READONLY';

export interface RoutePermission {
    path: string;
    allowedRoles: UserRole[];
    description?: string;
    /** When true, matches only the exact path (or trailing slash), never arbitrary sub-routes. */
    exact?: boolean;
}

/**
 * Route permissions configuration
 * More specific paths should come first
 */
export const ROUTE_PERMISSIONS: RoutePermission[] = [
  // === Direction / Executive / Payroll / Company / Internal (SUPER_ADMIN, OWNER, ADMIN) ===
  {
    path: '/dashboard/executive',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN'],
    description: 'Executive cockpit, unit economics, cash runway and decision deck'
  },
  {
    path: '/dashboard/labor/payroll',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN'],
    description: 'Payroll calculation and CFDI stamping'
  },
  {
    path: '/dashboard/compliance/payroll',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN'],
    description: 'Payroll compliance export'
  },
  {
    path: '/dashboard/company/subscription',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN'],
    description: 'Company subscription plan and tier capabilities'
  },
  {
    path: '/dashboard/company',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN'],
    description: 'Company settings, branches, and organization management'
  },
  {
    path: '/dashboard/prototipo',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN'],
    description: 'Internal prototype screens'
  },
  {
    path: '/dashboard/workflow-test',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN'],
    description: 'Internal workflow test harness'
  },

  // === Admin + Gerente ===
  {
    path: '/dashboard/team',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE'],
    description: 'User management and team settings'
  },
  {
    path: '/dashboard/builder',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE'],
    description: 'Workflow template builder'
  },
  {
    path: '/dashboard/budgets',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE'],
    description: 'Monthly operating budgets by branch and cost center'
  },

  // === Management tier (SUPER_ADMIN, OWNER, ADMIN, GERENTE, SUPERVISOR) ===
  {
    path: '/dashboard/operations',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Operations dashboard - management only'
  },
  {
    path: '/dashboard/exceptions',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Operational exceptions and risk queue'
  },
  {
    path: '/dashboard/execute',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO'],
    description: 'Quick workflow execution'
  },
  {
    path: '/dashboard/my-tasks',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO'],
    description: 'Personal workflow assignments'
  },
  {
    path: '/dashboard/evidence',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO'],
    description: 'Evidence collection and review'
  },
  {
    path: '/dashboard/incidents',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO'],
    description: 'Incident management'
  },
  {
    path: '/dashboard/inventory',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Inventory management'
  },
  {
    path: '/dashboard/equipment',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Equipment management'
  },
  {
    path: '/dashboard/compliance',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Compliance dashboard'
  },
  {
    path: '/dashboard/civil-protection',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Civil protection drills, extinguishers and emergency exits (NOM-002)'
  },
  {
    path: '/dashboard/audit',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Audit logs'
  },
  {
    path: '/dashboard/reports',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Reports'
  },
  {
    path: '/dashboard/ai-verifications',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'AI verification results'
  },
  {
    path: '/dashboard/performance',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Performance management'
  },
  {
    path: '/dashboard/schedules',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Schedule management'
  },
  {
    path: '/dashboard/analytics',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Analytics and reports'
  },
  {
    path: '/dashboard/branches',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Branch performance comparison and ranking'
  },

  // === Finance module (Caja Chica abierta a SUPERVISOR; Finanzas corporativas desde GERENTE) ===
  {
    path: '/dashboard/finance/petty-cash',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Branch petty cash operations (floor management)'
  },
  {
    path: '/dashboard/finance',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE'],
    description: 'Finance module: expenses, authorizations, cash flow, payables and results'
  },

  // === Sales module (Cortes de caja / ventas abiertos a SUPERVISOR) ===
  {
    path: '/dashboard/sales',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Sales module: daily cuts, cash reconciliation and POS mapping'
  },

  // === Labor module - management sub-routes (EMPLEADO denied) ===
  {
    path: '/dashboard/labor/attendance',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Attendance management'
  },
  {
    path: '/dashboard/labor/shifts',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Shift management'
  },
  {
    path: '/dashboard/labor/schedule-builder',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Schedule builder'
  },
  {
    path: '/dashboard/labor/shift-changes',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO'],
    description: 'Shift change requests (employee self-service + supervisor approval)'
  },
  {
    path: '/dashboard/labor/leave',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO'],
    description: 'Leave and absence requests (employee self-service + management)'
  },
  {
    path: '/dashboard/labor/approvals',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Approval management'
  },
  {
    path: '/dashboard/labor/breaks',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Break compliance monitoring'
  },
  {
    path: '/dashboard/labor/overtime',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Overtime management'
  },
  {
    path: '/dashboard/labor/vacations',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO'],
    description: 'Vacation requests and scoped team management'
  },
  {
    path: '/dashboard/labor/geolocation',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Geolocation tracking'
  },
  {
    path: '/dashboard/labor/holidays',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Holiday management'
  },
  {
    path: '/dashboard/labor/documents',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Employee documents/expediente'
  },
  {
    path: '/dashboard/labor/violations',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Labor violations'
  },

  // === Employee directory (management only) ===
  {
    path: '/dashboard/employees',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Employee directory and management'
  },

  // === Labor dashboard (management only - shows sensitive data) ===
  {
    path: '/dashboard/labor',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR'],
    description: 'Labor management dashboard - shows company-wide sensitive data'
  },

  // === Workflows - History (management + readonly), Execution (all except readonly) ===
  {
    path: '/dashboard/workflows/history',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'READONLY'],
    description: 'Workflow execution history across branch/company'
  },
  {
    path: '/dashboard/workflows',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO'],
    description: 'Execute and view workflows'
  },

  // === Profile & Notifications - All roles ===
  {
    path: '/dashboard/profile',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'],
    description: 'User profile settings'
  },
  {
    path: '/dashboard/notifications',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'],
    description: 'User notifications center'
  },

  // === Onboarding - All roles (for users without companyId) ===
  {
    path: '/onboarding',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'],
    description: 'Onboarding flow for new users without company'
  },

  // === Dashboard home - Exact match only (unknown /dashboard/* routes fail closed) ===
  {
    path: '/dashboard',
    allowedRoles: ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'EMPLEADO', 'READONLY'],
    description: 'Main dashboard (exact match only)',
    exact: true,
  }
];

/**
 * Check if a user role has access to a specific path
 */
export function hasAccess(userRole: UserRole, path: string): boolean {
  const normalizedPath = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  const sortedRoutes = [...ROUTE_PERMISSIONS].sort((a, b) => b.path.length - a.path.length);

  const matchingRoute = sortedRoutes.find(route =>
    route.exact
      ? normalizedPath === route.path
      : normalizedPath === route.path || normalizedPath.startsWith(route.path + '/')
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
        case 'OWNER':
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
