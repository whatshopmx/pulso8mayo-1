import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { BillingService, PlanId } from "@/lib/services/billing-service";
import { z } from "zod";

export async function GET(req: Request) {
    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });
        if (!session?.user?.companyId) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const plan = await BillingService.getCompanyPlan(session.user.companyId);
        return NextResponse.json(plan);
    } catch (error) {
        console.error("Error fetching plan:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}

const subscribeSchema = z.object({
    planId: z.enum(['FREE', 'BASIC', 'PRO', 'ENTERPRISE'])
});

export async function POST(req: Request) {
    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });
        if (!session?.user?.companyId) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        // Only OWNER or ADMIN should be able to change billing
        // Ideally: if (!['OWNER', 'ADMIN'].includes(session.user.role)) return 403;

        const body = await req.json();
        const { planId } = subscribeSchema.parse(body);

        const result = await BillingService.subscribe(session.user.companyId, planId as PlanId);
        return NextResponse.json(result);

    } catch (error) {
        console.error("Error subscribing:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
