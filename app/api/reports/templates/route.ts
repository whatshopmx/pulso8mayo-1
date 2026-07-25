import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { reportTemplates } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const templates = await db
      .select()
      .from(reportTemplates)
      .where(
        and(
          eq(reportTemplates.companyId, session.user.companyId),
          eq(reportTemplates.reportType, "CUSTOM")
        )
      )
      .orderBy(desc(reportTemplates.createdAt));

    return NextResponse.json({ templates });
  } catch (error) {
    console.error("[CUSTOM_TEMPLATES_GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      name,
      description,
      dataSource,
      fields,
      filters,
      dateFrom,
      dateTo,
      groupBy,
      sortBy,
    } = body;

    if (!name || !dataSource) {
      return NextResponse.json(
        { error: "Missing required fields: name, dataSource" },
        { status: 400 }
      );
    }

    const [template] = await db
      .insert(reportTemplates)
      .values({
        name,
        description: description || null,
        companyId: session.user.companyId,
        reportType: "CUSTOM",
        dataSource,
        fields: fields || [],
        filters: filters ? { filters, dateFrom, dateTo } : null,
        groupBy: groupBy || null,
        sortBy: sortBy || null,
        createdBy: session.user.id,
        isPublic: false,
      })
      .returning();

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    console.error("[CUSTOM_TEMPLATES_POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
