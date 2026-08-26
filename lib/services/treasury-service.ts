import { db } from "@/lib/db";
import { 
  paymentRuns, 
  paymentRunItems, 
  recurringContracts, 
  invoices,
  paymentRunStatusEnum,
  paymentRunItemTypeEnum 
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

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
}
