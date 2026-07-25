import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { storageLocations, branches } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";

const locationSchema = z.object({
    name: z.string().min(1, "Name is required"),
    type: z.enum(['DRY_STORAGE', 'REFRIGERATOR', 'FREEZER', 'BAR', 'KITCHEN', 'PRODUCTION', 'PACKAGING', 'OTHER']).default('DRY_STORAGE'),
    active: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(req.url);
        const branchId = searchParams.get("branchId") || session.user.branchId;
        const activeOnly = searchParams.get("active") !== "false";

        let conditions = [
            eq(storageLocations.companyId, session.user.companyId),
            eq(storageLocations.branchId, branchId!),
        ];

        if (activeOnly) {
            conditions.push(eq(storageLocations.active, true));
        }

        const locations = await db.select()
            .from(storageLocations)
            .where(and(...conditions))
            .orderBy(sql`${storageLocations.createdAt} DESC`);

        return NextResponse.json({
            success: true,
            locations,
        });

    } catch (error) {
        console.error("Get storage locations error:", error);
        return NextResponse.json(
            { error: "Error al obtener ubicaciones" },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId || !session?.user?.branchId) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        const body = await req.json();
        const validatedData = locationSchema.parse(body);

        const [location] = await db.insert(storageLocations).values({
            companyId: session.user.companyId,
            branchId: session.user.branchId,
            ...validatedData,
        }).returning();

        return NextResponse.json({
            success: true,
            location,
        });

    } catch (error) {
        console.error("Create storage location error:", error);

        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Datos inválidos", details: error.issues },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { error: "Error al crear ubicación" },
            { status: 500 }
        );
    }
}
