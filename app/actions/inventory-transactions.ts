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

    // 1. Create batch + RECEIVING movement in one transaction. El lote nace en
    // cero y el movimiento de entrada es el único dueño del incremento: antes
    // ambos sumaban y el saldo quedaba al doble.
    await InventoryService.createReceivingBatch({
        itemId,
        branchId: session.user.branchId,
        initialQuantity: String(quantity), // numeric(12,4): string en TS
        lotNumber,
        expirationDate,
        supplierId: supplierId || null,
        status: 'AVAILABLE'
        // productionDate...
    }, {
        branchId: session.user.branchId,
        itemId,
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
