// app/api/inventory/recipes/[id]/versions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { RecipeService } from "@/lib/services/recipe-service";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await getSession();
        if (!session?.user?.id || !session?.user?.companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id: recipeId } = await params;
        const versions = await RecipeService.listRecipeVersions(
            recipeId,
            session.user.companyId
        );

        return NextResponse.json({
            success: true,
            versions: versions.map((v) => ({
                ...v,
                calculatedCost: v.calculatedCost ? v.calculatedCost / 100 : 0,
                priceSelling: v.priceSelling ? v.priceSelling / 100 : 0,
            })),
        });
    } catch (error) {
        console.error("GET recipe versions error:", error);
        return NextResponse.json(
            { error: "Failed to fetch recipe versions" },
            { status: 500 }
        );
    }
}
