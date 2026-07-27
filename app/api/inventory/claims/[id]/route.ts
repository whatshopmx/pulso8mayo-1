import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { SupplierClaimService } from "@/lib/services/supplier-claim-service";
import { z } from "zod";

const updateClaimSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  resolution: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const validated = updateClaimSchema.parse(body);

    const claim = await SupplierClaimService.updateStatus(
      id,
      validated.status,
      session.user.id,
      validated.resolution,
    );

    return NextResponse.json({ success: true, claim });
  } catch (error) {
    console.error("Error updating claim:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid data", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update claim" }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const claim = await SupplierClaimService.getClaim(id);
    if (!claim) {
      return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, claim });
  } catch (error) {
    console.error("Error getting claim:", error);
    return NextResponse.json({ error: "Failed to get claim" }, { status: 500 });
  }
}
