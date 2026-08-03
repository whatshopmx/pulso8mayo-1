import { z } from "zod";

/**
 * Shared contracts for the recipes API (create/update).
 * Used by app/api/inventory/recipes/route.ts and
 * app/api/inventory/recipes/[id]/route.ts so both routes
 * validate the exact same shape.
 */
export const recipeItemInputSchema = z.object({
    itemId: z.string().uuid(),
    quantity: z.number().positive(),
    unit: z.string(),
    isSubRecipe: z.boolean().default(false),
});

export const createRecipeSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    baseYield: z.number().positive().default(1),
    unit: z.string().default("PORTION"),
    priceSelling: z.number().nonnegative().default(0), // in decimal dollars/pesos
    items: z.array(recipeItemInputSchema).default([]),
});

export const updateRecipeSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    baseYield: z.number().positive(),
    unit: z.string(),
    priceSelling: z.number().nonnegative(),
    items: z.array(recipeItemInputSchema),
});

export type RecipeItemInput = z.infer<typeof recipeItemInputSchema>;
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
