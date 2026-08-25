import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { 
    employeeProfiles, 
    employeeContracts, 
    employeeAuditLogs, 
    employeeDocuments, 
    employeeOnboarding,
    reportTemplates,
    reportExecutionHistory,
    companies 
} from '@/lib/db/schema';
import { eq, and, gte, lte, count, sql, ilike, desc, asc } from 'drizzle-orm';
import { withTenantAuth } from '@/lib/api/with-auth';

// Standard report definitions
const STANDARD_REPORTS = {
    'employee-roster': {
        name: 'Employee Roster',
        dataSource: 'employees',
        fields: ['employeeNumber', 'name', 'department', 'position', 'employeeStatus', 'hireDate', 'branchId'],
        description: 'Complete list of all employees with basic information',
    },
    'headcount-report': {
        name: 'Headcount Report',
        dataSource: 'employees',
        fields: ['department', 'position', 'employeeStatus', 'hireDate', 'terminationDate'],
        groupBy: ['department', 'employeeStatus'],
        description: 'Headcount by department, branch, and status',
    },
    'turnover-report': {
        name: 'Turnover Report',
        dataSource: 'employees',
        fields: ['employeeNumber', 'name', 'department', 'hireDate', 'terminationDate', 'terminationReason'],
        filters: { employeeStatus: ['TERMINATED', 'RESIGNED'] },
        description: 'Employee terminations with reasons',
    },
    'compensation-report': {
        name: 'Compensation Report',
        dataSource: 'contracts',
        fields: ['employeeNumber', 'name', 'department', 'baseSalary', 'monthlySalary', 'weeklySalary', 'contractType'],
        description: 'Salary by department and position',
    },
    'compliance-report': {
        name: 'Compliance Report',
        dataSource: 'documents',
        fields: ['employeeNumber', 'name', 'documentType', 'status', 'expirationDate', 'isRequired'],
        description: 'Document compliance status',
    },
    'onboarding-report': {
        name: 'Onboarding Report',
        dataSource: 'onboarding',
        fields: ['employeeNumber', 'name', 'status', 'startDate', 'targetEndDate', 'progressPercentage'],
        description: 'Onboarding progress and completion',
    },
};

export const GET = withTenantAuth(async (request: NextRequest, { auth }) => {
    try {
        const searchParams = request.nextUrl.searchParams;
        const reportType = searchParams.get('reportType');
        const branchId = searchParams.get('branchId');
        const dateFrom = searchParams.get('dateFrom');
        const dateTo = searchParams.get('dateTo');
        const format = searchParams.get('format') || 'json'; // json, csv

        const companyId = auth.tenantId;

        // Get standard report definition
        const reportDef = STANDARD_REPORTS[reportType as keyof typeof STANDARD_REPORTS];
        if (!reportDef) {
            return NextResponse.json({ error: 'Invalid report type' }, { status: 400 });
        }

        let data: any[] = [];
        const metadata = {
            reportName: reportDef.name,
            generatedAt: new Date().toISOString(),
            recordCount: 0,
            filters: { companyId, branchId, dateFrom, dateTo },
        };

// Execute report based on data source
    switch (reportDef.dataSource) {
      case 'employees':
        // Build conditions array dynamically
        const conditions = [eq(sql`u."company_id"`, companyId)];
        
        // Apply date filter
        if (dateFrom) {
          conditions.push(gte(employeeProfiles.hireDate, new Date(dateFrom)));
        }
        if (dateTo) {
          conditions.push(lte(employeeProfiles.hireDate, new Date(dateTo)));
        }

        // Apply branch filter
        if (branchId && branchId !== 'all') {
          conditions.push(eq(sql`u.branch_id`, branchId));
        }

        // Apply report-specific filters
        if ('filters' in reportDef && reportDef.filters?.employeeStatus) {
          conditions.push(sql`employee_profiles.employee_status IN (${sql.join(reportDef.filters.employeeStatus.map(s => sql`'${s}'`), sql`, `)})`);
        }

        // Build the query
        let employeeQuery = db
          .select({
            employeeNumber: employeeProfiles.employeeNumber,
            name: sql<string>`u.name`,
            department: employeeProfiles.department,
            position: employeeProfiles.position,
            employeeStatus: employeeProfiles.employeeStatus,
            hireDate: employeeProfiles.hireDate,
            terminationDate: employeeProfiles.terminationDate,
            terminationReason: employeeProfiles.terminationReason,
            branchId: sql<string>`u.branch_id`,
          })
          .from(employeeProfiles)
          .leftJoin(sql`users u`, eq(employeeProfiles.userId, sql`u.id`))
          .where(and(...conditions));

        // Apply grouping
        if ('groupBy' in reportDef && reportDef.groupBy) {
          const groupByColumns = reportDef.groupBy.map(field => {
            if (field === 'department') return employeeProfiles.department;
            if (field === 'employeeStatus') return employeeProfiles.employeeStatus;
            return sql.raw(field);
          });
          employeeQuery = employeeQuery.groupBy(...groupByColumns) as typeof employeeQuery;
        }

        data = await employeeQuery;
        break;

            case 'contracts':
                data = await db
                    .select({
                        employeeNumber: employeeProfiles.employeeNumber,
                        name: sql<string>`u.name`,
                        department: employeeProfiles.department,
                        baseSalary: employeeContracts.baseSalary,
                        monthlySalary: employeeContracts.monthlySalary,
                        weeklySalary: employeeContracts.weeklySalary,
                        contractType: employeeContracts.contractType,
                    })
                    .from(employeeContracts)
                    .leftJoin(employeeProfiles, eq(employeeContracts.userId, employeeProfiles.userId))
                    .leftJoin(sql`users u`, eq(employeeProfiles.userId, sql`u.id`))
                    .where(
                        and(
                            eq(sql`u."company_id"`, companyId),
                            eq(employeeContracts.status, 'ACTIVE')
                        )
                    );
                break;

            case 'documents':
                data = await db
                    .select({
                        employeeNumber: employeeProfiles.employeeNumber,
                        name: sql<string>`u.name`,
                        documentType: employeeDocuments.documentType,
                        status: employeeDocuments.status,
                        expirationDate: employeeDocuments.expirationDate,
                        isRequired: employeeDocuments.isRequired,
                    })
                    .from(employeeDocuments)
                    .leftJoin(employeeProfiles, eq(employeeDocuments.userId, employeeProfiles.userId))
                    .leftJoin(sql`users u`, eq(employeeProfiles.userId, sql`u.id`))
                    .where(eq(sql`u."company_id"`, companyId));
                break;

            case 'onboarding':
                data = await db
                    .select({
                        employeeNumber: employeeProfiles.employeeNumber,
                        name: sql<string>`u.name`,
                        status: employeeOnboarding.status,
                        startDate: employeeOnboarding.startDate,
                        targetEndDate: employeeOnboarding.targetEndDate,
                        progressPercentage: employeeOnboarding.progressPercentage,
                    })
                    .from(employeeOnboarding)
                    .leftJoin(employeeProfiles, eq(employeeOnboarding.userId, employeeProfiles.userId))
                    .leftJoin(sql`users u`, eq(employeeProfiles.userId, sql`u.id`))
                    .where(eq(sql`u."company_id"`, companyId));
                break;

            default:
                return NextResponse.json({ error: 'Unsupported data source' }, { status: 400 });
        }

        metadata.recordCount = data.length;

        // Format response based on requested format
        if (format === 'csv') {
            const csv = convertToCSV(data);
            return new NextResponse(csv, {
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': `attachment; filename="${reportType}-${Date.now()}.csv"`,
                },
            });
        }

        return NextResponse.json({
            metadata,
            data,
        });
    } catch (error) {
        console.error('Error generating report:', error);
        return NextResponse.json(
            { error: 'Failed to generate report' },
            { status: 500 }
        );
    }
});

// POST endpoint for custom report builder
export const POST = withTenantAuth(async (request: NextRequest, { auth }) => {
    try {
        const body = await request.json();
        const {
            dataSource,
            fields,
            filters,
            groupBy,
            sortBy,
            dateFrom,
            dateTo,
        } = body;

        if (!dataSource || !fields) {
            return NextResponse.json(
                { error: 'Missing required fields: dataSource, fields' },
                { status: 400 }
            );
        }

        const companyId = auth.tenantId;

        // Build custom query based on provided configuration
        const data: any[] = [];

        // Similar logic to GET but with dynamic field selection
        // This would be expanded to handle all possible data sources and fields

        return NextResponse.json({
            metadata: {
                generatedAt: new Date().toISOString(),
                recordCount: data.length,
                dataSource,
                fields,
            },
            data,
        });
    } catch (error) {
        console.error('Error generating custom report:', error);
        return NextResponse.json(
            { error: 'Failed to generate custom report' },
            { status: 500 }
        );
    }
});

// Helper function to convert JSON to CSV
function convertToCSV(data: any[]): string {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const rows = data.map(row =>
        headers.map(header => {
            const value = row[header];
            // Handle dates, nulls, and special characters
            if (value === null || value === undefined) return '';
            if (value instanceof Date) return value.toISOString();
            if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        }).join(',')
    );

    return [headers.join(','), ...rows].join('\n');
}
