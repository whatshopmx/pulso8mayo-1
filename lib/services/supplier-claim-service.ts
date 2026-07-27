import { db } from "@/lib/db";
import { supplierClaims, invoices, suppliers } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { NotificationDispatcher } from "./notification-dispatcher";

type ClaimStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
type ClaimType = 'SHORTAGE' | 'DAMAGE' | 'PRICE_DIFFERENCE' | 'QUALITY';

export class SupplierClaimService {
  static async generateClaimNumber(companyId: string): Promise<string> {
    const year = new Date().getFullYear();
    const [result] = await db.select({
      count: sql<number>`count(*)`,
    })
      .from(supplierClaims)
      .where(and(
        eq(supplierClaims.companyId, companyId),
        sql`EXTRACT(YEAR FROM ${supplierClaims.createdAt}) = ${year}`
      ));
    const nextNum = (result?.count || 0) + 1;
    return `CLM-${year}-${String(nextNum).padStart(4, '0')}`;
  }

  static async createClaim(data: {
    companyId: string;
    invoiceId?: string;
    branchId: string;
    supplierId: string;
    type: ClaimType;
    description?: string;
    totalAmount?: number;
    notes?: string;
  }) {
    const claimNumber = await this.generateClaimNumber(data.companyId);

    const [claim] = await db.insert(supplierClaims).values({
      companyId: data.companyId,
      invoiceId: data.invoiceId || null,
      branchId: data.branchId,
      claimNumber,
      supplierId: data.supplierId,
      status: 'OPEN',
      type: data.type,
      description: data.description || null,
      totalAmount: data.totalAmount || null,
      notes: data.notes || null,
    }).returning();

    return claim;
  }

  static async getClaim(id: string) {
    return db.query.supplierClaims.findFirst({
      where: eq(supplierClaims.id, id),
    });
  }

  static async listClaims(companyId: string, branchId?: string, status?: ClaimStatus) {
    const conditions = [eq(supplierClaims.companyId, companyId)];
    if (branchId) conditions.push(eq(supplierClaims.branchId, branchId));
    if (status) conditions.push(eq(supplierClaims.status, status));

    return db.select({
      claim: supplierClaims,
      supplierName: suppliers.name,
      invoiceFolio: invoices.folio,
    })
      .from(supplierClaims)
      .leftJoin(suppliers, eq(supplierClaims.supplierId, suppliers.id))
      .leftJoin(invoices, eq(supplierClaims.invoiceId, invoices.id))
      .where(and(...conditions))
      .orderBy(desc(supplierClaims.createdAt));
  }

  static async updateStatus(id: string, status: ClaimStatus, resolvedBy?: string, resolution?: string) {
    const validTransitions: Record<ClaimStatus, ClaimStatus[]> = {
      OPEN: ['IN_PROGRESS', 'CLOSED'],
      IN_PROGRESS: ['RESOLVED', 'CLOSED'],
      RESOLVED: ['CLOSED'],
      CLOSED: [],
    };

    const claim = await this.getClaim(id);
    if (!claim) throw new Error("Claim not found");

    const allowed = validTransitions[claim.status as ClaimStatus];
    if (!allowed || !allowed.includes(status)) {
      throw new Error(`Invalid transition: ${claim.status} → ${status}`);
    }

    const updateData: Record<string, unknown> = { status, updatedAt: new Date() };
    if (resolvedBy && (status === 'RESOLVED' || status === 'CLOSED')) {
      updateData.resolvedBy = resolvedBy;
      updateData.resolvedAt = new Date();
    }
    if (resolution) {
      updateData.resolution = resolution;
    }

    const [updated] = await db.update(supplierClaims)
      .set(updateData)
      .where(eq(supplierClaims.id, id))
      .returning();

    return updated;
  }

  static async resolveClaim(id: string, resolvedBy: string, resolution: string) {
    return this.updateStatus(id, 'RESOLVED', resolvedBy, resolution);
  }

  static async closeClaim(id: string, closedBy: string) {
    return this.updateStatus(id, 'CLOSED', closedBy);
  }
}
