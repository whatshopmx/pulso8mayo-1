import { NextRequest, NextResponse } from 'next/server';
import { EmployeeService } from '@/lib/services/employee-service';
import { requireTenantAuth } from '@/lib/api/with-auth';
import { isApiError } from '@/lib/api/error';
import { canManageRole, hasPermission, type Role } from '@/lib/permissions';
import { resolveBranchScope } from '@/lib/branch-scope';
import { maskSensitiveFields } from '@/lib/rbac/employee-permissions';

const EMPLOYEE_VIEW_ROLES: ReadonlySet<Role> = new Set([
  'SUPER_ADMIN',
  'OWNER',
  'ADMIN',
  'GERENTE',
  'SUPERVISOR',
  'READONLY',
]);

const SALARY_VIEW_ROLES: ReadonlySet<Role> = new Set([
  'SUPER_ADMIN',
  'OWNER',
  'ADMIN',
  'GERENTE',
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const auth = await requireTenantAuth();
    const role = auth.user.role as Role;
    const isSelf = auth.user.id === id;

    if (!isSelf && !EMPLOYEE_VIEW_ROLES.has(role)) {
      return NextResponse.json(
        { error: 'No tienes permiso para ver expedientes de otros empleados.' },
        { status: 403 }
      );
    }

    const scope = isSelf ? { kind: 'ALL' as const } : resolveBranchScope(role, auth.branchId, null);
    if (scope.kind === 'NONE') {
      return NextResponse.json(
        { error: 'Tu usuario no tiene una sucursal asignada.' },
        { status: 403 }
      );
    }

    const canViewSalary = isSelf || SALARY_VIEW_ROLES.has(role);
    const includeContracts = searchParams.get('includeContracts') === 'true' && canViewSalary;
    const includeSalary = searchParams.get('includeSalary') === 'true' && canViewSalary;
    const includeOnboarding = searchParams.get('includeOnboarding') === 'true';
    const includeDocuments = searchParams.get('includeDocuments') === 'true';
    const includeBenefits = searchParams.get('includeBenefits') === 'true';
    const includeTraining = searchParams.get('includeTraining') === 'true';
    const includeVacation = searchParams.get('includeVacation') === 'true';
    const includeAttendance = searchParams.get('includeAttendance') === 'true';

    const employee = await EmployeeService.getEmployee(id, {
      companyId: auth.tenantId,
      includeContracts,
      includeSalary,
      includeOnboarding,
      includeDocuments,
      includeBenefits,
      includeTraining,
      includeVacation,
      includeAttendance,
    });

    if (scope.kind === 'BRANCH' && employee.branchId !== scope.branchId) {
      return NextResponse.json(
        { error: 'No tienes permiso para ver empleados de otra sucursal.' },
        { status: 403 }
      );
    }

    const safeEmployee = canViewSalary
      ? employee
      : maskSensitiveFields(employee as Record<string, unknown>, []);

    return NextResponse.json({
      success: true,
      data: safeEmployee,
    });
  } catch (error: any) {
    if (isApiError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('[API] Error fetching employee:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch employee',
        details: error?.message,
      },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await requireTenantAuth();
    const role = auth.user.role as Role;

    if (!hasPermission(role, 'users', 'update')) {
      return NextResponse.json(
        { error: 'No tienes permiso para modificar expedientes de empleados.' },
        { status: 403 }
      );
    }

    const scope = resolveBranchScope(role, auth.branchId, null);
    if (scope.kind === 'NONE') {
      return NextResponse.json(
        { error: 'Tu usuario no tiene una sucursal asignada.' },
        { status: 403 }
      );
    }

    const existing = await EmployeeService.getEmployee(id, {
      companyId: auth.tenantId,
    });

    if (scope.kind === 'BRANCH' && existing.branchId !== scope.branchId) {
      return NextResponse.json(
        { error: 'No puedes modificar empleados de otra sucursal.' },
        { status: 403 }
      );
    }

    const targetRole = existing.userRole as Role | null;
    if (targetRole && !canManageRole(role, targetRole)) {
      return NextResponse.json(
        { error: 'No puedes modificar a un usuario con un rol superior al tuyo.' },
        { status: 403 }
      );
    }

    const body = await request.json();

    const requestedRole = (body.role ?? body.userRole) as Role | undefined;
    if (requestedRole && !canManageRole(role, requestedRole)) {
      return NextResponse.json(
        { error: 'No puedes asignar un rol superior al tuyo.' },
        { status: 403 }
      );
    }

    if (scope.kind === 'BRANCH' && body.branchId && body.branchId !== scope.branchId) {
      return NextResponse.json(
        { error: 'No puedes transferir empleados a otra sucursal.' },
        { status: 403 }
      );
    }

    const updatedEmployee = await EmployeeService.updateEmployee(
      id,
      auth.tenantId,
      body,
      auth.user.id
    );

    return NextResponse.json({
      success: true,
      data: updatedEmployee,
    });
  } catch (error: any) {
    if (isApiError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error updating employee:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to update employee' },
      { status: 500 }
    );
  }
}

// DELETE - Archive employee profile (Soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await requireTenantAuth();
    const role = auth.user.role as Role;

    if (!hasPermission(role, 'users', 'delete')) {
      return NextResponse.json(
        { error: 'No tienes permiso para archivar empleados.' },
        { status: 403 }
      );
    }

    if (auth.user.id === id) {
      return NextResponse.json(
        { error: 'No puedes archivar tu propio perfil.' },
        { status: 400 }
      );
    }

    const existing = await EmployeeService.getEmployee(id, {
      companyId: auth.tenantId,
    });

    const targetRole = existing.userRole as Role | null;
    if (targetRole && !canManageRole(role, targetRole)) {
      return NextResponse.json(
        { error: 'No puedes archivar a un usuario con un rol superior al tuyo.' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Employee archived successfully',
    });
  } catch (error: any) {
    if (isApiError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error deleting employee:', error);
    return NextResponse.json({ error: 'Failed to delete employee' }, { status: 500 });
  }
}
