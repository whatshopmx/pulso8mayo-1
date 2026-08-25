import { NextRequest, NextResponse } from "next/server";
import { LaborCalculator } from "@/lib/services/labor-calculator";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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

            return NextResponse.json({
                data: [overtime],
                summary: calculateSummary([overtime])
            });
        }

        // Otherwise, get all users in company/branch
        const userQuery = db.query.users.findMany({
            where: eq(users.id, session.user.id) // Default to current user
        });

        // If admin, get all users in company
        // TODO: Add role-based filtering

        const allUsers = await userQuery;

        // Calculate overtime for all users
        const overtimeReports = await Promise.all(
            allUsers.map(user =>
                LaborCalculator.calculateOvertime(
                    user.id,
                    new Date(startDate),
                    new Date(endDate)
                )
            )
        );

        // Filter by branch if specified
        let filteredReports = overtimeReports;
        if (branchId) {
            filteredReports = overtimeReports.filter(r => r.branchId === branchId);
        }

        return NextResponse.json({
            data: filteredReports,
            summary: calculateSummary(filteredReports)
        });
    } catch (error) {
        console.error("Error fetching overtime report:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}

function calculateSummary(reports: any[]) {
    return {
        totalEmployees: reports.length,
        totalRegularMinutes: reports.reduce((sum, r) => sum + r.regularMinutes, 0),
        totalOvertimeMinutes: reports.reduce((sum, r) => sum + r.totalOvertimeMinutes, 0),
        overtimeByType: {
            diurnal: reports.reduce((sum, r) => sum + r.overtimeMinutes.diurnal, 0),
            nocturnal: reports.reduce((sum, r) => sum + r.overtimeMinutes.nocturnal, 0),
            holiday: reports.reduce((sum, r) => sum + r.overtimeMinutes.holiday, 0),
            weekly: reports.reduce((sum, r) => sum + r.overtimeMinutes.weekly, 0)
        },
        employeesWithOvertime: reports.filter(r => r.totalOvertimeMinutes > 0).length,
        averageOvertimePerEmployee: reports.reduce((sum, r) => sum + r.totalOvertimeMinutes, 0) / reports.length
    };
}
