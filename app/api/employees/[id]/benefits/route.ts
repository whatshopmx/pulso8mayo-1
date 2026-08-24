import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { employeeProfiles, employeeBenefits } from "@/lib/db/schema";
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

        const benefits = await db
            .select()
            .from(employeeBenefits)
            .where(
                and(
                    eq(employeeBenefits.userId, employeeId),
                    eq(employeeBenefits.companyId, companyId)
                )
            )
            .orderBy(desc(employeeBenefits.startDate));

        return NextResponse.json({
            data: benefits,
            success: true
        });

    } catch (error) {
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        console.error("Error fetching employee benefits:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!["ADMIN", "GERENTE", "HR"].includes(session.user.role || "")) {
             return NextResponse.json({ error: "Forbidden. Insufficient permissions." }, { status: 403 });
        }

        const employeeId = (await params).id;
        const body = await request.json();

        // El tenant SIEMPRE viene de la sesión; nunca del cuerpo del cliente.
        const tenant = await getCurrentTenant();
        if (!tenant.id) {
            return NextResponse.json({ error: "Company info missing" }, { status: 403 });
        }
        const companyId = tenant.id;

    const newBenefit = await db.insert(employeeBenefits).values({
      userId: employeeId,
      companyId: companyId,
      benefitType: body.benefitType,
      provider: body.provider || null,
      policyNumber: body.policyNumber || null,
      coverageAmount: body.coverageAmount ? Number(body.coverageAmount) : null,
      isActive: body.isActive !== undefined ? body.isActive : true,
      startDate: new Date(body.startDate || new Date()),
      endDate: body.endDate ? new Date(body.endDate) : null,
      employeeContribution: body.employeeContribution ? Number(body.employeeContribution) : 0,
      employerContribution: body.employerContribution ? Number(body.employerContribution) : 0,
      beneficiaries: body.beneficiaries || [],
      createdBy: session.user.id
    }).returning();

        return NextResponse.json({
            data: newBenefit[0],
            success: true
        });

    } catch (error) {
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        console.error("Error creating employee benefit:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}