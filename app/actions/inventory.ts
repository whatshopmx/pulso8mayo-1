"use server";

import { InventoryService } from "@/lib/services/inventory-service";
import { inventoryItems } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createProduct(formData: FormData) {
    const session = await getSession();
    // @ts-ignore
    if (!session?.user?.companyId) {
        throw new Error("Unauthorized");
    }

    const name = formData.get("name") as string;
    const sku = formData.get("sku") as string;
    const barcode = formData.get("barcode") as string;
    const category = formData.get("category") as string;
    const minLevel = Number(formData.get("minLevel") || 0);
    const maxLevel = formData.get("maxLevel") ? Number(formData.get("maxLevel")) : undefined;
    const unit = formData.get("unit") as string;
    const supplierId = formData.get("supplierId") as string || undefined;
    const lastCost = formData.get("lastCost") ? Math.round(Number(formData.get("lastCost")) * 100) : undefined;
    const allergenInfo = formData.get("allergenInfo") as string;
    const storageRequirements = formData.get("storageRequirements") as string;
    const typicalShelfLifeDays = formData.get("typicalShelfLifeDays") ? Number(formData.get("typicalShelfLifeDays")) : undefined;
    const photoUrl = formData.get("photoUrl") as string;

    await InventoryService.createItem({
        companyId: session.user.companyId as string,
        name,
        sku,
        barcode,
        category,
        minLevel,
        maxLevel,
        unit,
        active: true,
        supplierId,
        lastCost,
        allergenInfo,
        storageRequirements,
        typicalShelfLifeDays,
        photoUrl: photoUrl || undefined,
        userId: session.user.id
    });

    revalidatePath("/dashboard/inventory");
    redirect("/dashboard/inventory");
}

export async function updateProduct(id: string, formData: FormData) {
    const session = await getSession();
    // @ts-ignore
    if (!session?.user?.companyId) {
        throw new Error("Unauthorized");
    }

    const name = formData.get("name") as string;
    const sku = formData.get("sku") as string;
    const barcode = formData.get("barcode") as string;
    const category = formData.get("category") as string;
    const minLevel = Number(formData.get("minLevel") || 0);
    const maxLevel = formData.get("maxLevel") ? Number(formData.get("maxLevel")) : undefined;
    const unit = formData.get("unit") as string;
    const supplierId = formData.get("supplierId") as string || undefined;
    const lastCost = formData.get("lastCost") ? Math.round(Number(formData.get("lastCost")) * 100) : undefined;
    const allergenInfo = formData.get("allergenInfo") as string;
    const storageRequirements = formData.get("storageRequirements") as string;
    const typicalShelfLifeDays = formData.get("typicalShelfLifeDays") ? Number(formData.get("typicalShelfLifeDays")) : undefined;
    const photoUrl = formData.get("photoUrl") as string;

    await InventoryService.updateItem(id, {
        name,
        sku,
        barcode,
        category,
        minLevel,
        maxLevel,
        unit,
        supplierId,
        lastCost,
        allergenInfo,
        storageRequirements,
        typicalShelfLifeDays,
        photoUrl: photoUrl || null,
    }, session.user.id);

    revalidatePath("/dashboard/inventory");
    revalidatePath(`/dashboard/inventory/${id}`);
    redirect(`/dashboard/inventory/${id}`);
}

export async function getCompanyProducts(companyId: string) {
    return await InventoryService.getItems(companyId);
}

export async function getSuppliers(companyId: string) {
    const { suppliers } = await import("@/lib/db/schema");
    const { db } = await import("@/lib/db");
    const { eq, and } = await import("drizzle-orm");

    return await db.select()
        .from(suppliers)
        .where(
            and(
                eq(suppliers.companyId, companyId),
                eq(suppliers.active, true)
            )
        );
}

export async function getPriceHistory(itemId: string) {
    const { inventoryPriceHistory, users } = await import("@/lib/db/schema");
    const { db } = await import("@/lib/db");
    const { eq, desc } = await import("drizzle-orm");

    return await db.select({
        id: inventoryPriceHistory.id,
        previousCost: inventoryPriceHistory.previousCost,
        newCost: inventoryPriceHistory.newCost,
        changedAt: inventoryPriceHistory.changedAt,
        changedByName: users.name
    })
        .from(inventoryPriceHistory)
        .leftJoin(users, eq(inventoryPriceHistory.changedBy, users.id))
        .where(eq(inventoryPriceHistory.itemId, itemId))
        .orderBy(desc(inventoryPriceHistory.changedAt));
}
