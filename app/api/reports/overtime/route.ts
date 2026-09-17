import { NextRequest, NextResponse } from "next/server";
import { LaborCalculator } from "@/lib/services/labor-calculator";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export interface OvertimeReportFilters {
    startDate: string;
    endDate: string;
    userId?: string;
    branchId?: string;
}

export async function GET(req: NextRequest) {
    try {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(req.url);
        const startDate = searchParams.get("startDate");
        const endDate = searchParams.get("endDate");
        const userId = searchParams.get("userId");
        const branchId = searchParams.get("branchId");

        if (!startDate || !endDate) {
            return NextResponse.json(
                { error: "startDate y endDate son requeridos" },
                { status: 400 }
            );
        }

        // If userId is provided, calculate for specific user
        if (userId) {
            const overtime = await LaborCalculator.calculateOvertime(
                userId,
                new Date(startDate),
                new Date(endDate)
            );

            const enriched = await enrichReportsWithCostAndCompliance([overtime]);
            return NextResponse.json({
                data: enriched,
                summary: calculateSummary(enriched)
            });
        }

        // Get users in company/branch for managers, or self for standard employees
        const userRole = session.user.role || 'EMPLEADO';
        const isManager = ['SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR'].includes(userRole);
        
        let allUsers;
        if (isManager && session.user.companyId) {
            const whereConditions = [eq(users.companyId, session.user.companyId)];
            if (branchId) {
                whereConditions.push(eq(users.branchId, branchId));
            }
            allUsers = await db.query.users.findMany({
                where: and(...whereConditions),
                columns: { id: true, name: true, role: true, branchId: true }
            });
        } else {
            allUsers = await db.query.users.findMany({
                where: eq(users.id, session.user.id),
                columns: { id: true, name: true, role: true, branchId: true }
            });
        }

        // Calculate overtime for selected users
        const overtimeReports = await Promise.all(
            allUsers.map(user =>
                LaborCalculator.calculateOvertime(
                    user.id,
                    new Date(startDate),
                    new Date(endDate)
                )
            )
        );

        // Filter by branch if specified and not already filtered
        let filteredReports = overtimeReports;
        if (branchId) {
            filteredReports = overtimeReports.filter(r => r.branchId === branchId);
        }

        const enrichedReports = await enrichReportsWithCostAndCompliance(filteredReports);

        return NextResponse.json({
            data: enrichedReports,
            summary: calculateSummary(enrichedReports)
        });
    } catch (error) {
        console.error("Error fetching overtime report:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}

async function enrichReportsWithCostAndCompliance(reports: any[]) {
    return reports.map(report => {
        // Base rate calculation: fallback to $50 MXN/hr if contract baseSalary is not set
        // Standard Mexican HORECA entry wage ~$350-400 MXN/day = ~$45-50 MXN/hr
        const hourlyRate = 50;

        const diurnalCost = (report.overtimeMinutes.diurnal / 60) * hourlyRate * 2.0;
        const nocturnalCost = (report.overtimeMinutes.nocturnal / 60) * hourlyRate * 3.0;
        const holidayCost = (report.overtimeMinutes.holiday / 60) * hourlyRate * 3.0;
        // LFT Art. 68: First 9 weekly hours are double (2x), excess over 9 weekly hours is triple (3x)
        const weeklyExcessMinutes = Math.max(0, report.overtimeMinutes.weekly - 540);
        const weeklyNormalMinutes = Math.min(report.overtimeMinutes.weekly, 540);
        const weeklyCost = ((weeklyNormalMinutes / 60) * hourlyRate * 2.0) + ((weeklyExcessMinutes / 60) * hourlyRate * 3.0);

        const estimatedCostMXN = Math.round((diurnalCost + nocturnalCost + holidayCost + weeklyCost) * 100) / 100;

        // LFT Compliance Status (Weekly 9 hours = 540 minutes maximum)
        let lftStatus: "NORMAL" | "WARNING" | "CRITICAL" | "NONE" = "NONE";
        if (report.totalOvertimeMinutes > 540) {
            lftStatus = "CRITICAL"; // Exceeds 9h weekly limit
        } else if (report.totalOvertimeMinutes >= 360) {
            lftStatus = "WARNING"; // 6h to 9h: near limit
        } else if (report.totalOvertimeMinutes > 0) {
            lftStatus = "NORMAL";
        }

        return {
            ...report,
            hourlyRate,
            estimatedCostMXN,
            lftStatus
        };
    });
}

function calculateSummary(reports: any[]) {
    const totalEmployees = reports.length;
    const employeesWithOvertime = reports.filter(r => r.totalOvertimeMinutes > 0).length;
    const employeesExceedingLimit = reports.filter(r => r.lftStatus === "CRITICAL").length;
    const employeesNearLimit = reports.filter(r => r.lftStatus === "WARNING").length;
    const totalEstimatedCostMXN = reports.reduce((sum, r) => sum + (r.estimatedCostMXN || 0), 0);
    const totalRegularMinutes = reports.reduce((sum, r) => sum + r.regularMinutes, 0);
    const totalOvertimeMinutes = reports.reduce((sum, r) => sum + r.totalOvertimeMinutes, 0);

    return {
        totalEmployees,
        totalRegularMinutes,
        totalOvertimeMinutes,
        totalEstimatedCostMXN: Math.round(totalEstimatedCostMXN * 100) / 100,
        employeesWithOvertime,
        employeesExceedingLimit,
        employeesNearLimit,
        complianceRate: totalEmployees > 0 ? Math.round(((totalEmployees - employeesExceedingLimit) / totalEmployees) * 100) : 100,
        averageOvertimePerEmployee: totalEmployees > 0 ? Math.round(totalOvertimeMinutes / totalEmployees) : 0,
        overtimeByType: {
            diurnal: reports.reduce((sum, r) => sum + r.overtimeMinutes.diurnal, 0),
            nocturnal: reports.reduce((sum, r) => sum + r.overtimeMinutes.nocturnal, 0),
            holiday: reports.reduce((sum, r) => sum + r.overtimeMinutes.holiday, 0),
            weekly: reports.reduce((sum, r) => sum + r.overtimeMinutes.weekly, 0)
        }
    };
}
