import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { purchaseOrders, supplierClaims } from "@/lib/db/schema";
import { eq, and, desc, not } from "drizzle-orm";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: supplierId } = await params;
        const tenant = await requireTenant();
        const { user } = await requireAuth();

        if (!hasPermission(user.role, 'inventory', 'read')) {
            return NextResponse.json(
                { error: "No tienes permisos para ver el inventario" },
                { status: 403 }
            );
        }

        // 1. Fetch Purchase Orders
        const pos = await db.select({
            id: purchaseOrders.id,
            poNumber: purchaseOrders.poNumber,
            status: purchaseOrders.status,
            totalAmount: purchaseOrders.totalAmount,
            dateOrdered: purchaseOrders.dateOrdered,
            createdAt: purchaseOrders.createdAt,
        })
        .from(purchaseOrders)
        .where(
            and(
                eq(purchaseOrders.supplierId, supplierId),
                eq(purchaseOrders.companyId, tenant.id)
            )
        )
        .orderBy(desc(purchaseOrders.createdAt));

        // 2. Fetch Supplier Claims
        const claimsList = await db.select({
            id: supplierClaims.id,
            claimNumber: supplierClaims.claimNumber,
            status: supplierClaims.status,
            type: supplierClaims.type,
            totalAmount: supplierClaims.totalAmount,
            description: supplierClaims.description,
            createdAt: supplierClaims.createdAt,
        })
        .from(supplierClaims)
        .where(
            and(
                eq(supplierClaims.supplierId, supplierId),
                eq(supplierClaims.companyId, tenant.id)
            )
        )
        .orderBy(desc(supplierClaims.createdAt));

        // 3. Compute Metrics
        const totalOrders = pos.length;
        const completedOrders = pos.filter(po => po.status === 'CLOSED' || po.status === 'RECEIVED' || po.status === 'PARTIALLY_RECEIVED').length;
        
        const totalSpendCents = pos
            .filter(po => po.status !== 'CANCELLED')
            .reduce((sum, po) => sum + (po.totalAmount || 0), 0);
            
        const totalClaims = claimsList.length;
        const resolvedClaims = claimsList.filter(c => c.status === 'RESOLVED' || c.status === 'CLOSED').length;
        
        const totalClaimImpactCents = claimsList.reduce((sum, c) => sum + (c.totalAmount || 0), 0);

        // OTIF (On-Time, In-Full) / Accuracy estimate:
        // Accuracy rate is modeled as: 100 - (claims / totalOrders) * 100.
        // If there are no orders, default to 100.
        let accuracyRate = 100;
        if (totalOrders > 0) {
            accuracyRate = Math.max(0, Math.round((1 - (totalClaims / totalOrders)) * 100));
        }

        return NextResponse.json({
            success: true,
            purchases: pos.map(po => ({
                ...po,
                totalAmount: po.totalAmount ? po.totalAmount / 100 : 0,
            })),
            claims: claimsList.map(c => ({
                ...c,
                totalAmount: c.totalAmount ? c.totalAmount / 100 : 0,
            })),
            metrics: {
                totalOrders,
                completedOrders,
                totalSpend: totalSpendCents / 100,
                totalClaims,
                resolvedClaims,
                totalClaimImpact: totalClaimImpactCents / 100,
                accuracyRate,
            }
        });

    } catch (error) {
        console.error("Get supplier metrics error:", error);
        return NextResponse.json(
            { error: "Failed to calculate supplier metrics" },
            { status: 500 }
        );
    }
}
