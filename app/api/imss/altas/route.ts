import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, employeeProfiles, employeeContracts } from "@/lib/db/schema";
import { eq, and, isNull, gte, lte, desc } from "drizzle-orm";
import { requireTenant } from "@/lib/tenant-context";

export interface IMSSAlta {
    userId: string;
    name: string;
    email: string;
    nss: string | null;
    curp: string | null;
    rfc: string | null;
    department: string | null;
    position: string | null;
    baseSalary: number;
    hireDate: string | null;
    employeeNumber: string | null;
    branchName: string | null;
    status: "PENDING" | "READY" | "REGISTERED" | "OVERDUE";
    daysSinceHire: number;
}

export interface IMSSAltaSummary {
    pending: number;
    ready: number;
    registered: number;
    overdue: number;
}

/**
 * GET /api/imss/altas
 * Get employees pending IMSS registration (altas)
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

        // Get employees with ONBOARDING status (new hires)
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
        department: employeeProfiles.department,
        position: employeeProfiles.position,
        nss: employeeProfiles.nss,
        curp: employeeProfiles.curp,
        rfc: employeeProfiles.rfc,
        hireDate: employeeProfiles.hireDate,
        employeeNumber: employeeProfiles.employeeNumber,
      })
      .from(users)
      .leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
      .where(and(...conditions))
      .orderBy(desc(users.createdAt));

        // Build branch map
        const branchesAll = await db.query.branches.findMany({
            columns: { id: true, name: true }
        });
        const branchMap: Record<string, string> = Object.fromEntries(
            branchesAll.map(b => [b.id, b.name])
        );

        // Filter and classify
        const now = new Date();
        const fiveDays = 5 * 24 * 60 * 60 * 1000;

        const altas: IMSSAlta[] = employees
            .filter(e => e.role === "EMPLEADO" || e.role === "GERENTE" || e.role === "SUPERVISOR")
            .map(e => {
                const hireDate = e.hireDate ? new Date(e.hireDate) : null;
                const daysSinceHire = hireDate
                    ? Math.floor((now.getTime() - hireDate.getTime()) / (24 * 60 * 60 * 1000))
                    : 0;
                const hasNSS = e.nss && e.nss.length === 11;
                const hasCURP = e.curp && e.curp.length === 18;
                const hasRFC = e.rfc && e.rfc.length === 12;

                let status: IMSSAlta["status"] = "PENDING";
                if (hasNSS && hasCURP && hasRFC) {
                    status = "READY";
                }
                if (hireDate && daysSinceHire > 5) {
                    status = "OVERDUE";
                }

                return {
                    userId: e.id,
                    name: e.name || e.email,
                    email: e.email,
                    nss: e.nss || null,
                    curp: e.curp || null,
                    rfc: e.rfc || null,
                    department: e.department || null,
                    position: e.position || null,
                    baseSalary: (e as any).baseSalary || 0,
                    hireDate: e.hireDate ? new Date(e.hireDate).toISOString() : null,
                    employeeNumber: e.employeeNumber || null,
                    branchName: e.branchId ? (branchMap[e.branchId] || null) : null,
                    status,
                    daysSinceHire,
                };
            });

        const summary: IMSSAltaSummary = {
            pending: altas.filter(a => a.status === "PENDING").length,
            ready: altas.filter(a => a.status === "READY").length,
            registered: 0,
            overdue: altas.filter(a => a.status === "OVERDUE").length,
        };

        // Filter by branch if provided
        let filtered = altas;
        if (branchId) {
            filtered = altas.filter(a => (a as any).branchId === branchId);
        }

        return NextResponse.json({
            altas: filtered,
            summary,
            branches: branchesAll,
        });
    } catch (error) {
        console.error("Error fetching IMSS altas:", error);
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}