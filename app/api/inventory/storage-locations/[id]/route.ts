import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { storageLocations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const locationSchema = z.object({
    name: z.string().min(1).optional(),
    type: z.enum(['DRY_STORAGE', 'REFRIGERATOR', 'FREEZER', 'BAR', 'KITCHEN', 'PRODUCTION', 'PACKAGING', 'OTHER']).optional(),
    orgType: z.enum(['CENTRAL', 'BRANCH', 'VIRTUAL', 'TRANSIT']).optional(),
    active: z.boolean().optional(),
});

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        const { id } = await params;
        const location = await db.query.storageLocations.findFirst({
            where: and(
                eq(storageLocations.id, id),
                eq(storageLocations.companyId, session.user.companyId!)
            ),
        });

        if (!location) {
            return NextResponse.json(
                { error: "Ubicación no encontrada" },
                { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            location,
        });

    } catch (error) {
        console.error("Get storage location error:", error);
        return NextResponse.json(
            { error: "Error al obtener ubicación" },
            { status: 500 }
        );
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        const { id } = await params;
        const body = await req.json();
        const validatedData = locationSchema.parse(body);

        const existing = await db.query.storageLocations.findFirst({
            where: and(
                eq(storageLocations.id, id),
                eq(storageLocations.companyId, session.user.companyId!)
            ),
        });

        if (!existing) {
            return NextResponse.json(
                { error: "Ubicación no encontrada" },
                { status: 404 }
            );
        }

        const [updated] = await db.update(storageLocations)
            .set({
                ...validatedData,
                updatedAt: new Date(),
            })
            .where(eq(storageLocations.id, id))
            .returning();

        return NextResponse.json({
            success: true,
            location: updated,
        });

    } catch (error) {
        console.error("Update storage location error:", error);

        if (error instanceof z.ZodError) {
            return NextResponse.json(
                { error: "Datos inválidos", details: error.issues },
                { status: 400 }
            );
        }

        return NextResponse.json(
            { error: "Error al actualizar ubicación" },
            { status: 500 }
        );
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json(
                { error: "No autorizado" },
                { status: 401 }
            );
        }

        const { id } = await params;

        const existing = await db.query.storageLocations.findFirst({
            where: and(
                eq(storageLocations.id, id),
                eq(storageLocations.companyId, session.user.companyId!)
            ),
        });

        if (!existing) {
            return NextResponse.json(
                { error: "Ubicación no encontrada" },
                { status: 404 }
            );
        }

        await db.update(storageLocations)
            .set({
                active: false,
                updatedAt: new Date(),
            })
            .where(eq(storageLocations.id, id));

        return NextResponse.json({
            success: true,
            message: "Ubicación eliminada",
        });

    } catch (error) {
        console.error("Delete storage location error:", error);
        return NextResponse.json(
            { error: "Error al eliminar ubicación" },
            { status: 500 }
        );
    }
}
