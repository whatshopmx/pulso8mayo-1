import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { creditNotes, invoices, suppliers } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const invoiceId = searchParams.get("invoiceId");

    const conditions = [eq(creditNotes.companyId, session.user.companyId)];
    if (invoiceId) conditions.push(eq(creditNotes.invoiceId, invoiceId));

    const list = await db.select({
      id: creditNotes.id,
      uuid: creditNotes.uuid,
      folio: creditNotes.folio,
      serie: creditNotes.serie,
      fecha: creditNotes.fecha,
      subtotal: creditNotes.subtotal,
      taxAmount: creditNotes.taxAmount,
      total: creditNotes.total,
      currency: creditNotes.currency,
      reason: creditNotes.reason,
      createdAt: creditNotes.createdAt,
      invoiceFolio: invoices.folio,
      invoiceSerie: invoices.serie,
      invoiceTotal: invoices.total,
      supplierName: suppliers.name,
    })
      .from(creditNotes)
      .leftJoin(invoices, eq(creditNotes.invoiceId, invoices.id))
      .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
      .where(and(...conditions))
      .orderBy(desc(creditNotes.createdAt));

    return NextResponse.json({ success: true, data: list });
  } catch (error) {
    console.error("[CreditNotes] Error listing:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { invoiceId, reason } = body;

    if (!invoiceId) {
      return NextResponse.json({ error: "invoiceId required" }, { status: 400 });
    }

    const [invoice] = await db.select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, session.user.companyId)))
      .limit(1);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const existing = await db.query.creditNotes.findFirst({
      where: and(
        eq(creditNotes.companyId, session.user.companyId),
        eq(creditNotes.invoiceId, invoiceId),
      ),
    });

    if (existing) {
      return NextResponse.json({ success: true, data: existing, message: "Ya existe una nota de crédito para esta factura" });
    }

    const [note] = await db.insert(creditNotes).values({
      companyId: session.user.companyId,
      invoiceId,
      uuid: `NC-${invoice.uuid}`,
      folio: invoice.folio,
      serie: invoice.serie,
      fecha: new Date().toISOString(),
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount ?? 0,
      total: invoice.total,
      currency: invoice.currency ?? "MXN",
      reason: reason ?? "Nota de crédito generada desde conciliación",
      xmlContent: null,
    }).returning();

    return NextResponse.json({ success: true, data: note }, { status: 201 });
  } catch (error) {
    console.error("[CreditNotes] Error creating:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
