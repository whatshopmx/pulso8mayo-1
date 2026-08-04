import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, employeeProfiles, employeeContracts } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requirePermissionApi } from "@/lib/rbac/abac";

/**
 * POST /api/payroll/export
 *
 * Migrated to ABAC (Sprint 2 Track B slice 2c). This route returns employee
 * PII (NSS, CURP, RFC, salario) so it is gated with classification 'SENSITIVE'
 * — non-gate roles (GERENTE/SUPERVISOR/EMPLEADO/READONLY) are denied by the
 * SENSITIVE gate (strict; HR arrives Sprint 3). Gate roles
 * (SUPER_ADMIN/OWNER/ADMIN) read plaintext, consistent with the prior
 * `requireTenant` behavior for authenticated admins.
 *
 * `ctx.userCompanyId` replaces `requireTenant().id` (both read `user.companyId`
 * from the same session). The response is a CSV blob (not JSON), so the
 * masking middleware (Task 3) does not apply here — the SENSITIVE deny is the
 * control for non-gate roles, not field masking.
 */
export async function POST(req: NextRequest) {
    try {
        const { ctx } = await requirePermissionApi("reports", "read", {
            classification: "SENSITIVE",
        });

        const body = await req.json();
        const { startDate, endDate } = body;

        if (!startDate || !endDate) {
            return NextResponse.json(
                { error: "startDate y endDate requeridos" },
                { status: 400 }
            );
        }

        const employeeData = await db
            .select({
                userId: users.id,
                name: users.name,
                employeeNumber: employeeProfiles.employeeNumber,
                nss: employeeProfiles.nss,
                curp: employeeProfiles.curp,
                rfc: employeeProfiles.rfc,
                hireDate: employeeProfiles.hireDate,
                position: employeeProfiles.position,
                department: employeeProfiles.department,
                baseSalary: employeeContracts.baseSalary,
                contractType: employeeContracts.contractType,
            })
            .from(users)
            .leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
            .leftJoin(employeeContracts, and(
                eq(employeeContracts.userId, users.id),
                isNull(employeeContracts.endDate)
            ))
            .where(eq(users.companyId, ctx.userCompanyId));

        const records = employeeData.map(emp => {
            const baseSalary = Number(emp.baseSalary || 0) / 100;
            const dailyRate = baseSalary / 30;
            const workDays = 15;
            const grossPay = dailyRate * workDays;
            const imssEmployee = grossPay * 0.02375;
            const isrEstimate = grossPay * 0.03;
            const netPay = grossPay - imssEmployee - isrEstimate;

            const hireDateVal = emp.hireDate;
            const hireDateStr = hireDateVal
                ? new Date(hireDateVal as unknown as string).toISOString().slice(0, 10)
                : "";

            return [
                emp.employeeNumber || emp.userId.slice(0, 8),
                emp.name || "",
                emp.nss || "",
                emp.curp || "",
                emp.rfc || "",
                emp.position || "",
                emp.department || "",
                hireDateStr,
                emp.contractType || "FIJO",
                workDays,
                baseSalary.toFixed(2),
                dailyRate.toFixed(2),
                grossPay.toFixed(2),
                imssEmployee.toFixed(2),
                isrEstimate.toFixed(2),
                netPay.toFixed(2),
                0,
            ];
        });

        const headers = [
            "NumeroEmpleado", "Nombre", "NSS", "CURP", "RFC",
            "Puesto", "Departamento", "FechaAlta", "TipoContrato",
            "DiasTrabajados", "SalarioBase", "SalarioDiario",
            "PercepcionBruta", "IMSS", "ISR", "PercepcionNeta", "HorasExtra"
        ];

        const csvRows = records.map(row =>
            row.map(cell => {
                const str = String(cell);
                return str.includes(",") || str.includes('"')
                    ? `"${str.replace(/"/g, '""')}"`
                    : str;
            }).join(",")
        );

        const content = [headers.join(","), ...csvRows].join("\r\n");
        const blob = new Blob([content], { type: "text/csv;charset=utf-8" });

        const filename = `NOMINA_${startDate}_${endDate}.csv`;

        return new Response(blob, {
            headers: {
                "Content-Type": "text/csv",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    } catch (error) {
        console.error("Error generating payroll export:", error);
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}