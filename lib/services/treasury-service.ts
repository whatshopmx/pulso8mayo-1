import { db } from "@/lib/db";
import { 
  paymentRuns, 
  paymentRunItems, 
  recurringContracts, 
  invoices,
  suppliers,
  supplierBankAccounts,
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
   * Fetch invoices ready to be paid (MATCHED or EXCEPTION_APPROVED, and UNPAID).
   */
  static async getUnpaidMatchedInvoices(companyId: string) {
    return db.query.invoices.findMany({
      where: and(
        eq(invoices.companyId, companyId),
        inArray(invoices.matchStatus, ["MATCHED", "EXCEPTION_APPROVED"]),
        eq(invoices.paymentStatus, "PENDING")
      ),
      orderBy: (inv, { asc }) => [asc(inv.fecha)],
    });
  }

  /**
   * Adds an item (e.g. an Invoice) to a payment run with 3-way match & CLABE verification checks (Módulo 6.1).
   */
  static async addItemToRun(
    paymentRunId: string, 
    itemType: typeof paymentRunItemTypeEnum.enumValues[number], 
    referenceId: string,
    amountCents: number,
    notes?: string
  ) {
    // 1. If invoice, strictly enforce 3-Way Match & verified CLABE account checks
    if (itemType === 'INVOICE') {
      const invoice = await db.query.invoices.findFirst({
        where: eq(invoices.id, referenceId),
      });

      if (!invoice) throw new Error("Factura no encontrada");
      
      if (invoice.matchStatus === 'DISCREPANCY') {
        throw new Error("Factura bloqueada por discrepancia en 3-Way Match sin autorización de excepción");
      }

      if (invoice.supplierId) {
        const verifiedAccount = await db.query.supplierBankAccounts.findFirst({
          where: and(
            eq(supplierBankAccounts.supplierId, invoice.supplierId),
            eq(supplierBankAccounts.status, 'VERIFIED'),
            eq(supplierBankAccounts.active, true)
          ),
        });

        if (!verifiedAccount) {
          const supplier = await db.query.suppliers.findFirst({
            where: eq(suppliers.id, invoice.supplierId),
          });
          const suppName = supplier?.name || "del proveedor";
          throw new Error(`El proveedor "${suppName}" no tiene una cuenta bancaria CLABE verificada. Se requiere validación previa contra fraude (Módulo 6.1).`);
        }
      }
    }

    const [item] = await db.insert(paymentRunItems)
      .values({
        paymentRunId,
        itemType,
        referenceId,
        amountCents,
        notes
      })
      .returning();

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
   * Valida un CFDI/Gasto recibido contra el contrato recurrente base (Renta/CFE/Servicios)
   * detectando sobrecostos > tolerancia (default +10%) (Módulo 4.2 & 5.1).
   */
  static async validateInvoiceAgainstContract(
    companyId: string,
    supplierId: string,
    invoicedAmountCents: number,
    branchId?: string | null
  ) {
    const contracts = await db.query.recurringContracts.findMany({
      where: and(
        eq(recurringContracts.companyId, companyId),
        eq(recurringContracts.supplierId, supplierId),
        eq(recurringContracts.active, true)
      ),
    });

    // Match branch-specific contract first, fallback to corporate contract
    const contract = (branchId ? contracts.find(c => c.branchId === branchId) : null) || contracts[0];

    if (!contract) {
      return {
        hasContract: false,
        invoicedAmountCents,
        varianceCents: 0,
        variancePercent: 0,
        isCompliant: true,
      };
    }

    const varianceCents = invoicedAmountCents - contract.baseAmountCents;
    const variancePercent = contract.baseAmountCents > 0
      ? Math.round((varianceCents / contract.baseAmountCents) * 1000) / 10
      : 0;

    // Variance exceeds tolerance (e.g. +10%)
    const isCompliant = variancePercent <= contract.varianceTolerancePercent;
    const alertMessage = !isCompliant
      ? `Desviación en contrato recurrente "${contract.title}": Facturado $${(invoicedAmountCents / 100).toFixed(2)} vs Base $${(contract.baseAmountCents / 100).toFixed(2)} (+${variancePercent}% vs tolerancia +${contract.varianceTolerancePercent}%)`
      : undefined;

    return {
      hasContract: true,
      contract: {
        id: contract.id,
        title: contract.title,
        contractType: contract.contractType,
        baseAmountCents: contract.baseAmountCents,
        varianceTolerancePercent: contract.varianceTolerancePercent,
      },
      invoicedAmountCents,
      varianceCents,
      variancePercent,
      isCompliant,
      alertMessage,
    };
  }

  /**
   * Transition the status of a payment run with dual-signature segregation of duties (Módulo 6.2).
   */
  static async updatePaymentRunStatus(
    paymentRunId: string,
    newStatus: typeof paymentRunStatusEnum.enumValues[number],
    userId: string
  ) {
    const currentRun = await db.query.paymentRuns.findFirst({
      where: eq(paymentRuns.id, paymentRunId),
    });

    if (!currentRun) throw new Error("Corrida de pago no encontrada");

    const updateData: any = { status: newStatus, updatedAt: new Date() };
    
    // Regla de Segregación de Funciones: Quien prepara NO puede auto-aprobar (Módulo 6.2)
    if (newStatus === "APPROVED") {
      if (currentRun.preparedBy === userId) {
        throw new Error("Segregación de funciones: El usuario que preparó la corrida de pago no puede auto-aprobarla (se requiere doble firma de un segundo usuario autorizado).");
      }
      updateData.approvedBy = userId;
    }

    const [updatedRun] = await db.update(paymentRuns)
      .set(updateData)
      .where(eq(paymentRuns.id, paymentRunId))
      .returning();

    // If it's completed, mark all its invoices as PAID.
    if (newStatus === "COMPLETED") {
      const items = await db.query.paymentRunItems.findMany({
        where: eq(paymentRunItems.paymentRunId, paymentRunId),
      });

      const invoiceIds = items
        .filter(i => i.itemType === 'INVOICE')
        .map(i => i.referenceId);

      if (invoiceIds.length > 0) {
        await db.update(invoices)
          .set({ paymentStatus: 'PAID', paidAt: new Date(), paidBy: userId })
          .where(inArray(invoices.id, invoiceIds));
      }
    }

    return updatedRun;
  }

  /**
   * Genera el layout de dispersión bancaria para transferencias masivas SPEI (Banorte/BBVA/Genérico) (Módulo 6.2).
   */
  static async generateBankDisbursementLayout(
    paymentRunId: string,
    companyId: string,
    format: "SPEI_CSV" | "BANORTE_TXT" | "BBVA_TXT" = "SPEI_CSV"
  ) {
    const run = await db.query.paymentRuns.findFirst({
      where: and(eq(paymentRuns.id, paymentRunId), eq(paymentRuns.companyId, companyId)),
    });

    if (!run) throw new Error("Corrida de pago no encontrada");

    const items = await db.query.paymentRunItems.findMany({
      where: eq(paymentRunItems.paymentRunId, paymentRunId),
    });

    const lines: string[] = [];
    let recordCount = 0;
    let totalCents = 0;

    if (format === "SPEI_CSV") {
      lines.push("CUENTA_ORIGEN,CLABE_DESTINO,BANCO_DESTINO,BENEFICIARIO,MONTO_PESOS,CONCEPTO,REFERENCIA");
    }

    for (const item of items) {
      if (item.itemType === "INVOICE") {
        const invoice = await db.query.invoices.findFirst({
          where: eq(invoices.id, item.referenceId),
        });

        if (invoice && invoice.supplierId) {
          const bankAccount = await db.query.supplierBankAccounts.findFirst({
            where: and(
              eq(supplierBankAccounts.supplierId, invoice.supplierId),
              eq(supplierBankAccounts.status, "VERIFIED"),
              eq(supplierBankAccounts.active, true)
            ),
          });

          const supplier = await db.query.suppliers.findFirst({
            where: eq(suppliers.id, invoice.supplierId),
          });

          const sourceAcc = run.sourceAccount || "0000000000";
          const destClabe = bankAccount ? `************${bankAccount.clabeLast4}` : "SIN_CLABE";
          const destBank = bankAccount?.bankName || "BANCO";
          const holderName = bankAccount?.accountHolderName || supplier?.name || "PROVEEDOR";
          const amountPesos = (item.amountCents / 100).toFixed(2);
          const concept = `PAGO FAC ${invoice.folio || invoice.uuid.slice(0, 8)}`;
          const ref = String(Date.now()).slice(-7);

          if (format === "SPEI_CSV") {
            lines.push(`"${sourceAcc}","${destClabe}","${destBank}","${holderName}",${amountPesos},"${concept}","${ref}"`);
          } else if (format === "BANORTE_TXT") {
            lines.push(`D|${sourceAcc}|${destClabe}|${amountPesos}|${concept}|${holderName}|${ref}`);
          } else {
            lines.push(`01|${sourceAcc}|${destClabe}|${amountPesos}|${concept}|${ref}|${holderName}`);
          }

          recordCount++;
          totalCents += item.amountCents;
        }
      }
    }

    return {
      runId: run.id,
      runTitle: run.title,
      format,
      recordCount,
      totalPesos: (totalCents / 100).toFixed(2),
      content: lines.join("\n"),
    };
  }
}
