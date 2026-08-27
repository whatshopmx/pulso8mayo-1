import { db } from "@/lib/db";
import { 
  paymentRuns, 
  paymentRunItems, 
  recurringContracts, 
  invoices,
  paymentRunStatusEnum,
  paymentRunItemTypeEnum 
} from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

export class TreasuryService {
  /**
   * Generates a new draft payment run (Corrida de Tesorería).
   */
  static async createPaymentRun(
    companyId: string, 
    title: string, 
    runDate: Date, 
    userId: string
  ) {
    const [run] = await db.insert(paymentRuns)
      .values({
        companyId,
        title,
        runDate,
        preparedBy: userId,
        status: "DRAFT",
      })
      .returning();
      
    return run;
  }

  /**
   * Fetch invoices ready to be paid (MATCHED and UNPAID).
   */
  static async getUnpaidMatchedInvoices(companyId: string) {
    return db.query.invoices.findMany({
      where: and(
        eq(invoices.companyId, companyId),
        eq(invoices.matchStatus, "MATCHED"),
        eq(invoices.paymentStatus, "PENDING")
      ),
      orderBy: (inv, { asc }) => [asc(inv.fecha)],
    });
  }

  /**
   * Adds an item (e.g. an Invoice) to a payment run.
   */
  static async addItemToRun(
    paymentRunId: string, 
    itemType: typeof paymentRunItemTypeEnum.enumValues[number], 
    referenceId: string,
    amountCents: number,
    notes?: string
  ) {
    const [item] = await db.insert(paymentRunItems)
      .values({
        paymentRunId,
        itemType,
        referenceId,
        amountCents,
        notes
      })
      .returning();

    // If it's an invoice, we might want to update its status or track that it's queued for payment.
    if (itemType === 'INVOICE') {
      // Assuming we can convert referenceId back to UUID if it is UUID
      await db.update(invoices)
        .set({ paymentStatus: 'PENDING' }) // Actually it remains pending until APPROVED/PAID
        .where(eq(invoices.id, referenceId));
    }

    // Update the total amount of the payment run
    const run = await db.query.paymentRuns.findFirst({
      where: eq(paymentRuns.id, paymentRunId),
      columns: { totalAmountCents: true }
    });

    if (run) {
      await db.update(paymentRuns)
        .set({ totalAmountCents: run.totalAmountCents + amountCents })
        .where(eq(paymentRuns.id, paymentRunId));
    }

    return item;
  }

  /**
   * Fetches the details of a specific payment run, joining items.
   */
  static async getPaymentRunDetails(paymentRunId: string) {
    const run = await db.query.paymentRuns.findFirst({
      where: eq(paymentRuns.id, paymentRunId),
    });

    if (!run) throw new Error("Payment run not found");

    const items = await db.query.paymentRunItems.findMany({
      where: eq(paymentRunItems.paymentRunId, paymentRunId),
    });

    return { run, items };
  }

  /**
   * Create a recurring contract (Gasto Operativo Recurrente)
   */
  static async createRecurringContract(
    companyId: string,
    branchId: string | null,
    supplierId: string,
    title: string,
    contractType: string,
    baseAmountCents: number,
    startDate: Date,
    userId: string
  ) {
    const [contract] = await db.insert(recurringContracts)
      .values({
        companyId,
        branchId,
        supplierId,
        title,
        contractType,
        baseAmountCents,
        startDate,
        createdBy: userId,
      })
      .returning();

    return contract;
  }
  
  /**
   * Fetch all payment runs for a company.
   */
  static async getPaymentRuns(companyId: string) {
    return db.query.paymentRuns.findMany({
      where: eq(paymentRuns.companyId, companyId),
      orderBy: (paymentRuns, { asc }) => [asc(paymentRuns.runDate)],
    });
  }

  /**
   * Fetch all recurring contracts for a company.
   */
  static async getRecurringContracts(companyId: string) {
    return db.query.recurringContracts.findMany({
      where: eq(recurringContracts.companyId, companyId),
      orderBy: (contracts, { asc }) => [asc(contracts.createdAt)],
    });
  }

  /**
   * Transition the status of a payment run.
   */
  static async updatePaymentRunStatus(
    paymentRunId: string,
    newStatus: typeof paymentRunStatusEnum.enumValues[number],
    userId: string
  ) {
    const updateData: any = { status: newStatus };
    
    // If it's being approved, record who approved it
    if (newStatus === "APPROVED") {
      updateData.approvedBy = userId;
    }

    const [updatedRun] = await db.update(paymentRuns)
      .set(updateData)
      .where(eq(paymentRuns.id, paymentRunId))
      .returning();

    // If it's completed, we should ideally mark all its invoices as PAID.
    if (newStatus === "COMPLETED") {
      const items = await db.query.paymentRunItems.findMany({
        where: eq(paymentRunItems.paymentRunId, paymentRunId),
      });

      const invoiceIds = items
        .filter(i => i.itemType === 'INVOICE')
        .map(i => i.referenceId);

      if (invoiceIds.length > 0) {
        await db.update(invoices)
          .set({ paymentStatus: 'PAID' })
          .where(inArray(invoices.id, invoiceIds));
      }
    }

    return updatedRun;
  }
}
