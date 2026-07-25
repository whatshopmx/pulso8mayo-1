import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { InventoryService } from "@/lib/services/inventory-service";
import { AuditService } from "@/lib/services/audit-service";
import { db } from "@/lib/db";
import { suppliers } from "@/lib/db/schema";
import { eq, and, sql, or } from "drizzle-orm";
import { z } from "zod";

const supplierSchema = z.object({
    name: z.string().min(1, "Name is required"),
    contactName: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().optional(),
    address: z.string().optional(),
    taxId: z.string().optional(),
    active: z.boolean().default(true),
});

/**
 * GET /api/inventory/suppliers
 * Get all suppliers for the company
 */
export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json(
                { error: "Unauthorized - Company ID required" },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(req.url);
        const search = searchParams.get("search");
        const activeOnly = searchParams.get("active") !== "false";

        let conditions = [eq(suppliers.companyId, session.user.companyId)];
        
        if (activeOnly) {
            conditions.push(eq(suppliers.active, true));
        }

        if (search) {
            conditions.push(
                or(
                    sql`${suppliers.name} ILIKE ${`%${search}%`}`,
                    sql`${suppliers.contactName} ILIKE ${`%${search}%`}`,
                    sql`${suppliers.email} ILIKE ${`%${search}%`}`,
                    sql`${suppliers.taxId} ILIKE ${`%${search}%`}`
                )
            );
        }

        const supplierList = await db.select()
            .from(suppliers)
            .where(and(...conditions))
            .orderBy(sql`${suppliers.createdAt} DESC`);

        return NextResponse.json({
            success: true,
            suppliers: supplierList,
        });

    } catch (error) {
        console.error("Get suppliers error:", error);
        return NextResponse.json(
            { error: "Failed to fetch suppliers" },
            { status: 500 }
        );
    }
}

/**
 * POST /api/inventory/suppliers
 * Create a new supplier
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session?.user?.companyId) {
            return NextResponse.json(
                { error: "Unauthorized - Company ID required" },
                { status: 401 }
            );
        }

        const body = await req.json();
        const validatedData = supplierSchema.parse(body);

        const [supplier] = await db.insert(suppliers).values({
            companyId: session.user.companyId,
            ...validatedData,
        }).returning();

        AuditService.logInventoryAction({
            companyId: session.user.companyId,
            branchId: session.user.branchId || '',
            action: 'CREATE',
            entityType: 'SUPPLIER',
            entityId: supplier.id,
            newValue: validatedData,
            performedBy: session.user.id,
            reason: 'Supplier created',
        });

        return NextResponse.json({
            success: true,
            supplier,
        });

    } catch (error) {
        console.error("Create supplier error:", error);
        
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid data", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create supplier" },
      { status: 500 }
    );
  }
}
