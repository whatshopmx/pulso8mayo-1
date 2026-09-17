import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, employeeProfiles } from "@/lib/db/schema";
import { eq, and, isNull, gte, lte, desc } from "drizzle-orm";
import { requireTenant } from "@/lib/tenant-context";

export interface IMSSBaja {
    userId: string;
    name: string;
    email: string;
    nss: string | null;
    employeeNumber: string | null;
    terminationDate: string | null;
    terminationReason: string;
    status: "PENDING" | "READY" | "DEREGISTERED" | "OVERDUE";
    daysSinceTermination: number;
}

export interface IMSSBajaSummary {
    pending: number;
    ready: number;
    deregistered: number;
    overdue: number;
}

/**
 * GET /api/imss/bajas
 * Get employees pending IMSS deregistration (bajas)
 */
export async function GET(req: NextRequest) {
    try {
        const session = await auth.api.getSession({ headers: req.headers });
        if (!session?.user?.id) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 });
        }

        const tenant = await requireTenant();
        const { searchParams } = new URL(req.url);
        const branchId = searchParams.get("branchId");

        // Get employees with TERMINATED or RESIGNED status
        const conditions = [
            eq(users.companyId, tenant.id as string),
            isNull(users.deletedAt),
        ];

        if (branchId && branchId !== "all" && branchId !== "ALL") {
            conditions.push(eq(users.branchId, branchId));
        }

        const employees = await db
            .select({
                id: users.id,
                name: users.name,
                email: users.email,
                role: users.role,
                branchId: users.branchId,
                nss: employeeProfiles.nss,
                terminationDate: employeeProfiles.terminationDate,
                employeeNumber: employeeProfiles.employeeNumber,
            })
            .from(users)
            .leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
            .where(and(...conditions))
            .orderBy(desc(users.updatedAt));

        const now = new Date();
        const fiveDays = 5 * 24 * 60 * 60 * 1000;

        const bajas: IMSSBaja[] = employees
            .filter(e => {
                const profile = e as any;
                return (
                    profile.role === "EMPLEADO" &&
                    (profile as any).employeeStatus === "TERMINATED" ||
                    (profile as any).employeeStatus === "RESIGNED"
                );
            })
            .map(e => {
                const terminationDate = (e as any).terminationDate
                    ? new Date((e as any).terminationDate)
                    : null;
                const daysSinceTermination = terminationDate
                    ? Math.floor((now.getTime() - terminationDate.getTime()) / (24 * 60 * 60 * 1000))
                    : 0;

                let status: IMSSBaja["status"] = "PENDING";
                if ((e as any).nss) {
                    status = "READY";
                }
                if (terminationDate && daysSinceTermination > 5) {
                    status = "OVERDUE";
                }

                return {
                    userId: e.id,
                    name: e.name || e.email,
                    email: e.email,
                    nss: (e as any).nss || null,
                    employeeNumber: (e as any).employeeNumber || null,
                    terminationDate: terminationDate
                        ? terminationDate.toISOString()
                        : null,
                    terminationReason: "Voluntary Resignation",
                    status,
                    daysSinceTermination,
                };
            });

        const summary: IMSSBajaSummary = {
            pending: bajas.filter(b => b.status === "PENDING").length,
            ready: bajas.filter(b => b.status === "READY").length,
            deregistered: 0,
            overdue: bajas.filter(b => b.status === "OVERDUE").length,
        };

        // Build branch map
        const branchesAll = await db.query.branches.findMany({
            columns: { id: true, name: true }
        });

        return NextResponse.json({
            bajas,
            summary,
            branches: branchesAll,
        });
    } catch (error) {
        console.error("Error fetching IMSS bajas:", error);
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}