"use server";

import { getSession } from "@/lib/auth";
import { InventoryService } from "@/lib/services/inventory-service";
import { revalidatePath } from "next/cache";

export async function addBatch(itemId: string, formData: FormData) {
    const session = await getSession();
    if (!session?.user?.branchId) {
        throw new Error("User must belong to a branch to add stock");
    }

    const lotNumber = formData.get("lotNumber") as string;
    const quantity = Number(formData.get("quantity"));
    const expirationDate = formData.get("expirationDate") ? new Date(formData.get("expirationDate") as string) : undefined;
    const supplierId = formData.get("supplierId") as string; // Optional

    // 1. Create Batch
    const batch = await InventoryService.createBatch({
        itemId,
        branchId: session.user.branchId,
        initialQuantity: String(quantity), // numeric(12,4): string en TS
        currentQuantity: String(quantity),
        lotNumber,
        expirationDate,
        supplierId: supplierId || null,
        status: 'AVAILABLE'
        // productionDate...
    });

    // 2. Record Movement (Receiving)
    await InventoryService.recordMovement({
        branchId: session.user.branchId,
        itemId,
        batchId: batch.id,
        type: 'RECEIVING',
        quantityChange: quantity,
        reason: 'Initial Receiving',
        performedBy: session.user.id
    });

    revalidatePath(`/dashboard/inventory/${itemId}`);
}


export async function recordUsage(itemId: string, formData: FormData) {
    const session = await getSession();
    if (!session?.user?.branchId) {
        throw new Error("User must belong to a branch");
    }

    const quantity = Number(formData.get("quantity"));
    const reason = formData.get("reason") as string;
    const batchId = formData.get("batchId") as string;

    await InventoryService.recordMovement({
        branchId: session.user.branchId,
        itemId,
        batchId: batchId || undefined, // If batch is selected, decrement from it
        type: 'USAGE',
        quantityChange: -quantity, // Negative for usage
        reason,
        performedBy: session.user.id
    });

    revalidatePath(`/dashboard/inventory/${itemId}`);
}
