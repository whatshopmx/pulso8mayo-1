import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { employeeProfiles, employeeContracts } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { getCurrentTenant } from "@/lib/tenant-context";
import { isApiError } from "@/lib/api/error";

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const employeeId = (await params).id;

        // El tenant SIEMPRE viene de la sesión; nunca de parámetros del cliente.
        const tenant = await getCurrentTenant();
        if (!tenant.id) {
             return NextResponse.json({ error: "Company info missing" }, { status: 403 });
        }
        const companyId = tenant.id;

        if (session.user.role === "EMPLEADO" && session.user.id !== employeeId) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (["SUPERVISOR", "GERENTE"].includes(session.user.role || "")) {
            const employee = await db.query.employeeProfiles.findFirst({
                where: eq(employeeProfiles.userId, employeeId)
            });

            if (!employee) {
                return NextResponse.json({ error: "Employee not found" }, { status: 404 });
            }
        }

        const contracts = await db
            .select()
            .from(employeeContracts)
            .where(
                and(
                    eq(employeeContracts.userId, employeeId),
                    eq(employeeContracts.companyId, companyId)
                )
            )
            .orderBy(desc(employeeContracts.startDate));

        return NextResponse.json({
            data: contracts,
            success: true
        });

    } catch (error) {
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        console.error("Error fetching employee contracts:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}