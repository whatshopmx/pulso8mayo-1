"use server";

import { InventoryService } from "@/lib/services/inventory-service";
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
    // Tipo de almacenamiento (loteprod §5.2): vacío = sin clasificar.
    const storageTypeRaw = formData.get("storageType") as string;
    const storageType = ['DRY', 'REFRIGERATED', 'FROZEN'].includes(storageTypeRaw) ? storageTypeRaw as 'DRY' | 'REFRIGERATED' | 'FROZEN' : undefined;
    const typicalShelfLifeDays = formData.get("typicalShelfLifeDays") ? Number(formData.get("typicalShelfLifeDays")) : undefined;
    const photoUrl = formData.get("photoUrl") as string;
    const brand = formData.get("brand") as string || undefined;
    const presentation = formData.get("presentation") as string || undefined;
    const standardCost = formData.get("standardCost") ? Math.round(Number(formData.get("standardCost")) * 100) : undefined;
    const isHighValue = formData.get("isHighValue") === "true"; // Fase 4

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
        storageType,
        typicalShelfLifeDays,
        photoUrl: photoUrl || undefined,
        brand,
        presentation,
        standardCost,
        isHighValue,
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
    // Tipo de almacenamiento (loteprod §5.2): vacío = sin clasificar.
    const storageTypeRaw = formData.get("storageType") as string;
    const storageType = ['DRY', 'REFRIGERATED', 'FROZEN'].includes(storageTypeRaw) ? storageTypeRaw as 'DRY' | 'REFRIGERATED' | 'FROZEN' : undefined;
    const typicalShelfLifeDays = formData.get("typicalShelfLifeDays") ? Number(formData.get("typicalShelfLifeDays")) : undefined;
    const photoUrl = formData.get("photoUrl") as string;
    const brand = formData.get("brand") as string || undefined;
    const presentation = formData.get("presentation") as string || undefined;
    const standardCost = formData.get("standardCost") ? Math.round(Number(formData.get("standardCost")) * 100) : undefined;
    const isHighValue = formData.get("isHighValue") === "true"; // Fase 4

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
        storageType,
        typicalShelfLifeDays,
        photoUrl: photoUrl || undefined,
        brand,
        presentation,
        standardCost,
        isHighValue,
    }, session.user.id);

    revalidatePath("/dashboard/inventory");
    revalidatePath(`/dashboard/inventory/${id}`);
    redirect("/dashboard/inventory");
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
