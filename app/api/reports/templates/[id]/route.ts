import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { reportTemplates } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const [template] = await db
      .select()
      .from(reportTemplates)
      .where(
        and(
          eq(reportTemplates.id, id),
          eq(reportTemplates.companyId, session.user.companyId)
        )
      )
      .limit(1);

    if (!template) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ template });
  } catch (error) {
    console.error("[CUSTOM_TEMPLATES_GET_ID]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await db
      .select()
      .from(reportTemplates)
      .where(
        and(
          eq(reportTemplates.id, id),
          eq(reportTemplates.companyId, session.user.companyId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.dataSource !== undefined) updateData.dataSource = body.dataSource;
    if (body.fields !== undefined) updateData.fields = body.fields;
    if (body.filters !== undefined) updateData.filters = body.filters;
    if (body.groupBy !== undefined) updateData.groupBy = body.groupBy;
    if (body.sortBy !== undefined) updateData.sortBy = body.sortBy;

    const [template] = await db
      .update(reportTemplates)
      .set(updateData)
      .where(eq(reportTemplates.id, id))
      .returning();

    return NextResponse.json({ template });
  } catch (error) {
    console.error("[CUSTOM_TEMPLATES_PUT]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const existing = await db
      .select()
      .from(reportTemplates)
      .where(
        and(
          eq(reportTemplates.id, id),
          eq(reportTemplates.companyId, session.user.companyId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.delete(reportTemplates).where(eq(reportTemplates.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[CUSTOM_TEMPLATES_DELETE]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
