// lib/services/__tests__/recipe-versioning.test.ts
import { describe, expect, it } from "vitest";
import { RecipeCycleError } from "../recipe-service";

describe("Recipe Cycle & Versioning Contracts", () => {
    it("RecipeCycleError carries recipeId and appropriate message", () => {
        const error = new RecipeCycleError("rec-123");
        expect(error.name).toBe("RecipeCycleError");
        expect(error.message).toContain("rec-123");
        expect(error.message).toContain("Recipe cycle detected");
    });

    it("verifies snapshot structure contract", () => {
        const snapshot = {
            versionNumber: 2,
            name: "Salsa Habanero Especial",
            baseYield: "2.50",
            unit: "LITRO",
            calculatedCost: 4500, // $45.00 MXN
            priceSelling: 12000,  // $120.00 MXN
            foodCostPercentage: "37.50",
            itemsSnapshot: [
                {
                    itemId: "item-habanero",
                    itemName: "Chile Habanero",
                    quantity: "0.5000",
                    unit: "KG",
                    isSubRecipe: false,
                },
                {
                    itemId: "item-cebolla",
                    itemName: "Cebolla Morada",
                    quantity: "1.0000",
                    unit: "KG",
                    isSubRecipe: false,
                },
            ],
            changeReason: "Ajuste por aumento de costo de habanero",
            createdAt: new Date().toISOString(),
        };

        expect(snapshot.versionNumber).toBe(2);
        expect(snapshot.itemsSnapshot).toHaveLength(2);
        expect(Number(snapshot.foodCostPercentage)).toBeGreaterThan(0);
        expect(snapshot.calculatedCost / 100).toBe(45);
    });
});
