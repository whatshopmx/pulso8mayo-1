import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { shiftSessions, users, branches } from "@/lib/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";

export interface AttendanceReportFilters {
    startDate: string;
    endDate: string;
    branchId?: string;
    userId?: string;
    department?: string;
}

export interface AttendanceRecord {
    id: string;
    userId: string;
    userName: string;
    userEmail: string;
    userRole: string;
    branchId: string;
    branchName: string;
    date: string;
    clockIn: string | null;
    clockOut: string | null;
    totalWorkMinutes: number;
    breakMinutes: number;
    overtimeMinutes: number;
    status: "COMPLETED" | "ACTIVE" | "MISSED";
    geolocation: any;
}

export async function GET(req: NextRequest) {
    try {
        // Get authenticated user
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        // Parse query parameters
        const { searchParams } = new URL(req.url);
        const startDate = searchParams.get("startDate");
        const endDate = searchParams.get("endDate");
        const branchId = searchParams.get("branchId");
        const userId = searchParams.get("userId");

        if (!startDate || !endDate) {
            return NextResponse.json(
                { error: "startDate y endDate son requeridos" },
                { status: 400 }
            );
        }

        // Build query conditions (ensure end of day is covered)
        const startDateTime = new Date(startDate.includes("T") ? startDate : `${startDate}T00:00:00.000`);
        const endDateTime = new Date(endDate.includes("T") ? endDate : `${endDate}T23:59:59.999`);

        const effectiveTimeSql = sql`COALESCE(${shiftSessions.checkInTime}, ${shiftSessions.startedAt})`;

        const conditions = [
            gte(effectiveTimeSql, startDateTime),
            lte(effectiveTimeSql, endDateTime)
        ];

        if (branchId) {
            conditions.push(eq(shiftSessions.branchId, branchId));
        }

        if (userId) {
            conditions.push(eq(shiftSessions.userId, userId));
        }

        // Fetch shift sessions with user and branch data
        const sessions = await db
            .select({
                id: shiftSessions.id,
                userId: shiftSessions.userId,
                userName: users.name,
                userEmail: users.email,
                userRole: users.role,
                branchId: shiftSessions.branchId,
                branchName: branches.name,
                startedAt: shiftSessions.startedAt,
                endedAt: shiftSessions.endedAt,
                checkInTime: shiftSessions.checkInTime,
                checkOutTime: shiftSessions.checkOutTime,
                status: shiftSessions.status,
                totalWorkMinutes: shiftSessions.totalWorkMinutes,
                totalBreakMinutes: shiftSessions.totalBreakMinutes,
                overtimeMinutes: shiftSessions.overtimeMinutes,
                checkInGeolocation: shiftSessions.checkInGeolocation,
                checkOutGeolocation: shiftSessions.checkOutGeolocation
            })
            .from(shiftSessions)
            .leftJoin(users, eq(shiftSessions.userId, users.id))
            .leftJoin(branches, eq(shiftSessions.branchId, branches.id))
            .where(and(...conditions))
            .orderBy(sql`${effectiveTimeSql} DESC`);

        // Transform to attendance records
        const attendanceRecords: AttendanceRecord[] = sessions.map(session => {
            const effectiveStart = session.checkInTime || session.startedAt;
            const effectiveEnd = session.checkOutTime || session.endedAt;
            return {
                id: session.id,
                userId: session.userId,
                userName: session.userName || "Unknown",
                userEmail: session.userEmail || "",
                userRole: session.userRole || "EMPLEADO",
                branchId: session.branchId,
                branchName: session.branchName || "Unknown",
                date: effectiveStart ? new Date(effectiveStart).toISOString().split("T")[0] : "",
                clockIn: effectiveStart ? new Date(effectiveStart).toISOString() : null,
                clockOut: effectiveEnd ? new Date(effectiveEnd).toISOString() : null,
                totalWorkMinutes: session.totalWorkMinutes || 0,
                breakMinutes: session.totalBreakMinutes || 0,
                overtimeMinutes: session.overtimeMinutes || 0,
                status: session.status as "COMPLETED" | "ACTIVE" | "MISSED",
                geolocation: session.checkInGeolocation || session.checkOutGeolocation || null
            };
        });

        // Calculate summary statistics
        const summary = {
            totalRecords: attendanceRecords.length,
            totalWorkMinutes: attendanceRecords.reduce((sum, r) => sum + r.totalWorkMinutes, 0),
            totalBreakMinutes: attendanceRecords.reduce((sum, r) => sum + r.breakMinutes, 0),
            totalOvertimeMinutes: attendanceRecords.reduce((sum, r) => sum + r.overtimeMinutes, 0),
            completedShifts: attendanceRecords.filter(r => r.status === "COMPLETED").length,
            activeShifts: attendanceRecords.filter(r => r.status === "ACTIVE").length,
            uniqueEmployees: new Set(attendanceRecords.map(r => r.userId)).size
        };

        return NextResponse.json({
            data: attendanceRecords,
            summary,
            filters: {
                startDate,
                endDate,
                branchId: branchId || undefined,
                userId: userId || undefined
            }
        });
    } catch (error) {
        console.error("Error fetching attendance report:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    // Support POST for complex queries with body
    try {
        const body: AttendanceReportFilters = await req.json();
        const { startDate, endDate, branchId, userId } = body;

        if (!startDate || !endDate) {
            return NextResponse.json(
                { error: "startDate y endDate son requeridos" },
                { status: 400 }
            );
        }

        // Build URL with query params and redirect to GET
        const url = new URL(req.url);
        url.searchParams.set("startDate", startDate);
        url.searchParams.set("endDate", endDate);
        if (branchId) url.searchParams.set("branchId", branchId);
        if (userId) url.searchParams.set("userId", userId);

        return NextResponse.redirect(url.toString());
    } catch (error) {
        console.error("Error in attendance report POST:", error);
        return NextResponse.json(
            { error: "Error interno del servidor" },
            { status: 500 }
        );
    }
}
