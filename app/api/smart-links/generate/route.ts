
import { auth } from "@/lib/auth";
import { SmartLinkService } from "@/lib/services/smart-link-service";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

const generateSchema = z.object({
    instanceId: z.string().uuid(),
    templateId: z.string(),
    sessionId: z.string().uuid().optional(),
    expiresInMinutes: z.number().int().positive().optional(),
});

export async function POST(req: Request) {
    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });

        if (!session?.user) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const body = await req.json();
        const { instanceId, templateId, sessionId, expiresInMinutes } = generateSchema.parse(body);

        // Optional: Check if user has permission to generate links for this instance/branch
        // For now, we assume if they can access the API and have valid IDs, it's allowed.

        const result = await SmartLinkService.createSmartLink(
            instanceId,
            templateId,
            sessionId ?? null,
            expiresInMinutes
        );

        return NextResponse.json(result);
    } catch (error) {
        console.error("Error generating smart link:", error);
        if (error instanceof z.ZodError) {
            return new NextResponse("Invalid request data", { status: 400 });
        }
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
