import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { users, employeeContracts, employeeDocuments, branches } from "@/lib/db/schema";
import { eq, and, gte, lte, ilike, or, sql } from "drizzle-orm";

const FIELD_MAP: Record<string, Record<string, string>> = {
  employees: {
    employeeNumber: "employee_number",
    name: "name",
    department: "department",
    position: "position",
    employeeStatus: "status",
    hireDate: "hire_date",
    terminationDate: "termination_date",
    terminationReason: "termination_reason",
    branchId: "branch_id",
    gender: "gender",
    dateOfBirth: "date_of_birth",
    curp: "curp",
    rfc: "rfc",
    personalEmail: "personal_email",
    personalPhone: "personal_phone",
    city: "city",
    state: "state",
  },
  contracts: {
    contractNumber: "contract_number",
    contractType: "contract_type",
    workRegime: "work_regime",
    baseSalary: "base_salary",
    monthlySalary: "monthly_salary",
    weeklySalary: "weekly_salary",
    startDate: "start_date",
    endDate: "end_date",
    status: "status",
  },
  documents: {
    documentType: "document_type",
    documentName: "document_name",
    status: "status",
    expirationDate: "expiration_date",
    isRequired: "is_required",
  },
};

function buildWhereClause(
  dataSource: string,
  filters: Array<{ field: string; operator: string; value: string }> | undefined,
  dateFrom?: string,
  dateTo?: string
) {
  const conditions: any[] = [];

  if (filters && Array.isArray(filters)) {
    for (const f of filters) {
      if (!f.field || !f.operator) continue;
      const dbField = FIELD_MAP[dataSource]?.[f.field];
      if (!dbField) continue;

      switch (f.operator) {
        case "equals":
          conditions.push(eq(sql.raw(dbField), f.value));
          break;
        case "contains":
          conditions.push(ilike(sql.raw(dbField), `%${f.value}%`));
          break;
        case "starts_with":
          conditions.push(ilike(sql.raw(dbField), `${f.value}%`));
          break;
        case "greater_than":
          conditions.push(sql`${sql.raw(dbField)} > ${f.value}`);
          break;
        case "less_than":
          conditions.push(sql`${sql.raw(dbField)} < ${f.value}`);
          break;
        case "is_null":
          conditions.push(sql`${sql.raw(dbField)} IS NULL`);
          break;
        case "is_not_null":
          conditions.push(sql`${sql.raw(dbField)} IS NOT NULL`);
          break;
      }
    }
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

async function queryEmployees(
  companyId: string,
  fields: string[],
  filters?: Array<{ field: string; operator: string; value: string }>,
  dateFrom?: string,
  dateTo?: string
) {
  const conditions = [eq(users.companyId, companyId)];

  if (dateFrom) conditions.push(gte(users.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(users.createdAt, new Date(dateTo)));

  const filterCondition = buildWhereClause("employees", filters, dateFrom, dateTo);
  if (filterCondition) conditions.push(filterCondition as any);

  return await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      branchId: users.branchId,
      branchName: branches.name,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(branches, eq(users.branchId, branches.id))
    .where(and(...conditions));
}

async function queryContracts(
  companyId: string,
  fields: string[],
  filters?: Array<{ field: string; operator: string; value: string }>,
  dateFrom?: string,
  dateTo?: string
) {
  const conditions = [eq(employeeContracts.companyId, companyId)];

  if (dateFrom) conditions.push(gte(employeeContracts.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(employeeContracts.createdAt, new Date(dateTo)));

  const filterCondition = buildWhereClause("contracts", filters, dateFrom, dateTo);
  if (filterCondition) conditions.push(filterCondition as any);

  return await db
    .select({
      id: employeeContracts.id,
      contractNumber: employeeContracts.contractNumber,
      contractType: employeeContracts.contractType,
      workRegime: employeeContracts.workRegime,
      baseSalary: employeeContracts.baseSalary,
      monthlySalary: employeeContracts.monthlySalary,
      weeklySalary: employeeContracts.weeklySalary,
      startDate: employeeContracts.startDate,
      endDate: employeeContracts.endDate,
      status: employeeContracts.status,
      userId: employeeContracts.userId,
      employeeName: users.name,
      branchId: employeeContracts.branchId,
      branchName: branches.name,
    })
    .from(employeeContracts)
    .leftJoin(users, eq(employeeContracts.userId, users.id))
    .leftJoin(branches, eq(employeeContracts.branchId, branches.id))
    .where(and(...conditions));
}

async function queryDocuments(
  companyId: string,
  fields: string[],
  filters?: Array<{ field: string; operator: string; value: string }>,
  dateFrom?: string,
  dateTo?: string
) {
  const conditions = [eq(employeeDocuments.companyId, companyId)];

  if (dateFrom) conditions.push(gte(employeeDocuments.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(employeeDocuments.createdAt, new Date(dateTo)));

  const filterCondition = buildWhereClause("documents", filters, dateFrom, dateTo);
  if (filterCondition) conditions.push(filterCondition as any);

  return await db
    .select({
      id: employeeDocuments.id,
      documentType: employeeDocuments.documentType,
      documentName: employeeDocuments.documentName,
      status: employeeDocuments.status,
      expirationDate: employeeDocuments.expirationDate,
      isRequired: employeeDocuments.isRequired,
      issueDate: employeeDocuments.issueDate,
      isValid: employeeDocuments.isValid,
      userId: employeeDocuments.userId,
      employeeName: users.name,
      branchId: employeeDocuments.branchId,
      branchName: branches.name,
    })
    .from(employeeDocuments)
    .leftJoin(users, eq(employeeDocuments.userId, users.id))
    .leftJoin(branches, eq(employeeDocuments.branchId, branches.id))
    .where(and(...conditions));
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { dataSource, fields, filters, dateFrom, dateTo, format } = body;

    if (!dataSource) {
      return NextResponse.json({ error: "Missing required field: dataSource" }, { status: 400 });
    }

    let data: any[] = [];

    switch (dataSource) {
      case "employees":
        data = await queryEmployees(session.user.companyId, fields || [], filters, dateFrom, dateTo);
        break;
      case "contracts":
        data = await queryContracts(session.user.companyId, fields || [], filters, dateFrom, dateTo);
        break;
      case "documents":
        data = await queryDocuments(session.user.companyId, fields || [], filters, dateFrom, dateTo);
        break;
      default:
        return NextResponse.json({ error: `Unknown dataSource: ${dataSource}` }, { status: 400 });
    }

    if (format === "csv") {
      const selectedFields = (fields as string[]) || [];
      const header = selectedFields.join(",");
      const rows = data.map((row) =>
        selectedFields
          .map((f) => {
            const val = row[f];
            if (val === null || val === undefined) return "";
            const str = String(val);
            return str.includes(",") ? `"${str}"` : str;
          })
          .join(",")
      );
      const csv = [header, ...rows].join("\n");

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="report-${Date.now()}.csv"`,
        },
      });
    }

    return NextResponse.json({ data, total: data.length });
  } catch (error) {
    console.error("[EXECUTE_REPORT]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
