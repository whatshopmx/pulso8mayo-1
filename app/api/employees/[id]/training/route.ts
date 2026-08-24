import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { employeeTraining } from "@/lib/db/schema";
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

        const trainings = await db
            .select()
            .from(employeeTraining)
            .where(
                and(
                    eq(employeeTraining.userId, employeeId),
                    eq(employeeTraining.companyId, companyId)
                )
            )
            .orderBy(desc(employeeTraining.startDate));

        return NextResponse.json({
            data: trainings,
            success: true
        });

    } catch (error) {
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        console.error("Error fetching employee training:", error);
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

    const newTraining = await db.insert(employeeTraining).values({
      userId: employeeId,
      companyId: companyId,
      trainingName: body.trainingName,
      trainingType: body.trainingType || 'TRAINING',
      provider: body.provider || null,
      startDate: new Date(body.startDate || new Date()),
      endDate: body.endDate ? new Date(body.endDate) : null,
      completionDate: body.completionDate ? new Date(body.completionDate) : null,
      expirationDate: body.expirationDate ? new Date(body.expirationDate) : null,
      status: body.status || 'SCHEDULED',
      certificationNumber: body.certificationNumber || null,
      isMandatory: body.isMandatory !== undefined ? body.isMandatory : false,
      cost: body.cost ? Number(body.cost) : 0,
      notes: body.notes || null,
      createdBy: session.user.id
    }).returning();

        return NextResponse.json({
            data: newTraining[0],
            success: true
        });

    } catch (error) {
        if (isApiError(error)) {
            return NextResponse.json({ error: error.message }, { status: error.statusCode });
        }
        console.error("Error creating employee training:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}
