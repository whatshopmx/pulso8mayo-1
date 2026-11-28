import { NextRequest, NextResponse } from 'next/server';
import { EmployeeService } from '@/lib/services/employee-service';
import { requireTenantAuth } from '@/lib/api/with-auth';
import { isApiError } from '@/lib/api/error';
import { hasPermission, type Role } from '@/lib/permissions';
import { resolveBranchScope } from '@/lib/branch-scope';
import { z } from 'zod';

const EMPLOYEE_LIST_ROLES: ReadonlySet<Role> = new Set([
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

// POST - Create new employee
const createEmployeeSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.string().optional(),
  branchId: z.string().optional(),
  department: z.string().optional(),
  position: z.string().optional(),
  employeeNumber: z.string().optional(),
  hireDate: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTenantAuth();
    const role = auth.user.role as Role;
    if (!hasPermission(role, 'users', 'create')) {
      return NextResponse.json(
        { error: 'No tienes permiso para crear empleados.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    createEmployeeSchema.parse(body);

    // Employee creation logic will be handled fully in later steps
    return NextResponse.json({
      error: 'Employee creation via this endpoint is coming soon. Use User management for now and then update profile.'
    }, { status: 501 });
  } catch (error) {
    if (isApiError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Datos inválidos', details: error.flatten() }, { status: 400 });
    }
    console.error('Error creating employee:', error);
    return NextResponse.json({ error: 'Failed to create employee' }, { status: 500 });
  }
}

// GET - List employees
export async function GET(request: NextRequest) {
  try {
    const auth = await requireTenantAuth();
    const role = auth.user.role as Role;

    if (!EMPLOYEE_LIST_ROLES.has(role)) {
      return NextResponse.json(
        { error: 'No tienes permiso para ver el directorio de empleados.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20;
    const search = searchParams.get('search') || undefined;
    const department = searchParams.get('department') || undefined;
    const status = searchParams.get('status') || undefined;
    const requestedBranchId = searchParams.get('branchId') || undefined;

    const scope = resolveBranchScope(role, auth.branchId, requestedBranchId);
    if (scope.kind === 'NONE') {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    const effectiveBranchId = scope.kind === 'BRANCH' ? scope.branchId : undefined;

    const result = await EmployeeService.listEmployees(auth.tenantId, {
      page,
      limit,
      search,
      department,
      status,
      branchId: effectiveBranchId,
    });

    const canViewSalary = SALARY_VIEW_ROLES.has(role);
    const data = canViewSalary
      ? result.data
      : result.data.map((row) => ({
          ...row,
          contractBaseSalary: null,
          effectiveSalaryCents: null,
        }));

    return NextResponse.json({
      success: true,
      data,
      pagination: result.meta,
    });
  } catch (error) {
    if (isApiError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error fetching employees:', error);
    return NextResponse.json(
      { error: 'Failed to fetch employees' },
      { status: 500 }
    );
  }
}

