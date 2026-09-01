import { db } from "@/lib/db";
import { 
  paymentRuns, 
  paymentRunItems, 
  recurringContracts, 
  invoices,
  suppliers,
  supplierBankAccounts,
  paymentRunStatusEnum,
  paymentRunItemTypeEnum,
  branches,
  payrollRuns,
  payrollPayslips,
  pettyCashFunds
} from "@/lib/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";

export class TreasuryService {
  /**
   * Generates a new draft payment run (Corrida de Tesorería).
   */
  static async createPaymentRun(
    companyId: string, 
    title: string, 
    runDate: Date, 
    userId: string,
    branchId?: string | null
  ) {
    const [run] = await db.insert(paymentRuns)
      .values({
        companyId,
        branchId: branchId && branchId !== "ALL" ? branchId : null,
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
  static async getUnpaidMatchedInvoices(companyId: string, branchId?: string | null) {
    const conditions = [
      eq(invoices.companyId, companyId),
      inArray(invoices.matchStatus, ["MATCHED", "EXCEPTION_APPROVED"]),
      eq(invoices.paymentStatus, "PENDING")
    ];

    if (branchId && branchId !== "ALL") {
      conditions.push(eq(invoices.branchId, branchId));
    }

    return db.query.invoices.findMany({
      where: and(...conditions),
      orderBy: (inv, { asc }) => [asc(inv.fecha)],
    });
  }

  /**
   * Fetch payroll runs ready to be paid in Treasury.
   */
  static async getUnpaidPayrollRuns(companyId: string, branchId?: string | null) {
    const runs = await db.query.payrollRuns.findMany({
      where: eq(payrollRuns.companyId, companyId),
      orderBy: (pr, { desc }) => [desc(pr.createdAt)],
    });

    if (runs.length === 0) return [];

    const runIds = runs.map(r => r.id);

    const existingRunItems = await db.query.paymentRunItems.findMany({
      where: eq(paymentRunItems.itemType, "PAYROLL"),
      columns: { referenceId: true }
    });
    const attachedIds = new Set(existingRunItems.map(i => i.referenceId));

    const payslips = await db.query.payrollPayslips.findMany({
      where: inArray(payrollPayslips.runId, runIds),
      columns: { runId: true, totalPercepcionesCents: true }
    });

    const payrollTotals = new Map<string, number>();
    payslips.forEach(ps => {
      payrollTotals.set(ps.runId, (payrollTotals.get(ps.runId) || 0) + (ps.totalPercepcionesCents || 0));
    });

    return runs
      .filter(r => !attachedIds.has(r.id))
      .map(r => ({
        ...r,
        totalAmountCents: payrollTotals.get(r.id) || 0,
        branchName: "Todas las sucursales (Consolidado)",
      }));
  }

  /**
   * Resuelve la contraparte de una partida de pago y afirma que es cobrable.
   *
   * G1.1 de `tasks/plan-facturas-contrapartes.md`. Antes, la regla "la
   * contraparte tiene CLABE verificada" vivía inline dentro de
   * `if (itemType === 'INVOICE')` y, adentro, dentro de `if (invoice.supplierId)`.
   * Los otros cuatro valores del enum entraban al lote **sin validar nada** —
   * ni siquiera que el `referenceId` existiera o fuera del tenant. Toda la
   * máquina antifraude de la Fase 1 de CLABE se rodeaba cambiando una cadena
   * en el body del POST.
   *
   * El `switch` es exhaustivo a propósito: el `default` asigna a `never`, así
   * que **agregar un valor al enum sin declarar su regla no compila**. Ese es
   * el punto de la función — no cubrir los cinco tipos de hoy, sino que el
   * sexto reviente en build en vez de abrir un hueco callado.
   *
   * Devuelve el monto autoritativo: para los tipos con documento se lee del
   * documento y **se ignora el del body**. Un monto que viene del cliente en
   * un lote de pago es dinero declarado por quien cobra.
   */
  static async assertCounterpartyPayable(input: {
    companyId: string;
    itemType: typeof paymentRunItemTypeEnum.enumValues[number];
    referenceId: string;
    /** Solo se usa en los tipos que no tienen documento con monto propio. */
    amountCents?: number;
    notes?: string;
  }): Promise<{ amountCents: number; counterparty: string }> {
    const { companyId, itemType, referenceId, notes } = input;

    switch (itemType) {
      // Mercancía: contraparte = proveedor de la factura, con CLABE verificada.
      case "INVOICE": {
        const invoice = await db.query.invoices.findFirst({
          where: and(eq(invoices.id, referenceId), eq(invoices.companyId, companyId)),
        });

        // Mismo 404 para "no existe" y "es de otra empresa": distinguirlos
        // filtra la existencia de documentos ajenos.
        if (!invoice) throw ApiError.notFound("Factura no encontrada");

        if (invoice.matchStatus === "DISCREPANCY") {
          throw ApiError.badRequest(
            "Factura bloqueada por discrepancia en 3-Way Match sin autorización de excepción"
          );
        }

        // Antes esto era `if (invoice.supplierId)`: una factura sin proveedor
        // se saltaba la verificación de CLABE entera. No hay a quién
        // transferirle, así que no es pagable.
        if (!invoice.supplierId) {
          throw ApiError.badRequest(
            "La factura no tiene proveedor asignado. Asigna la contraparte antes de programarla para pago."
          );
        }

        const verifiedAccount = await db.query.supplierBankAccounts.findFirst({
          where: and(
            eq(supplierBankAccounts.supplierId, invoice.supplierId),
            eq(supplierBankAccounts.status, "VERIFIED"),
            eq(supplierBankAccounts.active, true)
          ),
        });

        const supplier = await db.query.suppliers.findFirst({
          where: eq(suppliers.id, invoice.supplierId),
        });
        const suppName = supplier?.name || "del proveedor";

        if (!verifiedAccount) {
          throw ApiError.badRequest(
            `El proveedor "${suppName}" no tiene una cuenta bancaria CLABE verificada. Se requiere validación previa contra fraude (Módulo 6.1).`
          );
        }

        return { amountCents: invoice.total, counterparty: suppName };
      }

      // Nómina: se paga por layout de dispersión contra las CLABEs de los
      // empleados, no contra una cuenta de contraparte. **Se declara** que no
      // requiere contraparte bancaria; no cae por omisión.
      case "PAYROLL": {
        const payrollRun = await db.query.payrollRuns.findFirst({
          where: and(eq(payrollRuns.id, referenceId), eq(payrollRuns.companyId, companyId)),
        });

        if (!payrollRun) throw ApiError.notFound("Corrida de nómina no encontrada");

        const payslips = await db.query.payrollPayslips.findMany({
          where: eq(payrollPayslips.runId, payrollRun.id),
          columns: { totalPercepcionesCents: true },
        });

        const totalCents = payslips.reduce(
          (sum, ps) => sum + (ps.totalPercepcionesCents || 0),
          0
        );

        if (totalCents <= 0) {
          throw ApiError.badRequest(
            "Esta corrida de nómina no tiene percepciones calculadas; no hay monto que programar."
          );
        }

        return { amountCents: totalCents, counterparty: "Nómina (dispersión a empleados)" };
      }

      // Impuestos: se pagan por línea de captura al SAT/IMSS, no por SPEI a una
      // contraparte. No hay tabla de declaraciones en el repo contra la cual
      // verificar el `referenceId`, así que la nota es obligatoria: es lo único
      // que deja rastro de qué se está pagando.
      case "TAXES": {
        const amountCents = input.amountCents ?? 0;
        if (amountCents <= 0) {
          throw ApiError.badRequest("El monto del pago de impuestos debe ser mayor a cero.");
        }
        if (!notes || notes.trim().length === 0) {
          throw ApiError.badRequest(
            "Un pago de impuestos requiere nota con la línea de captura y el concepto: no hay documento contra el cual verificarlo."
          );
        }
        return { amountCents, counterparty: "Autoridad fiscal (línea de captura)" };
      }

      // Caja chica: la reposición es efectivo que entra al fondo de una
      // sucursal, no una transferencia a un tercero — `petty_cash_transactions`
      // no tiene contraparte y el fondo se identifica por sucursal. Se declara
      // que no requiere CLABE, y el `referenceId` apunta al fondo.
      //
      // El monto se acota al faltante del fondo: se admite una reposición
      // parcial, pero no se puede meter a la sucursal más efectivo del que el
      // fondo está autorizado a tener.
      case "PETTY_CASH_REIMBURSEMENT": {
        const fund = await db.query.pettyCashFunds.findFirst({
          where: and(
            eq(pettyCashFunds.id, referenceId),
            eq(pettyCashFunds.companyId, companyId)
          ),
        });

        if (!fund) throw ApiError.notFound("Fondo de caja chica no encontrado");
        if (!fund.active) {
          throw ApiError.badRequest("El fondo de caja chica está cerrado; no admite reposición.");
        }

        const faltanteCents = fund.fundAmount - fund.currentBalance;
        if (faltanteCents <= 0) {
          throw ApiError.badRequest(
            "El fondo de caja chica está completo; no requiere reposición."
          );
        }

        const solicitado = input.amountCents ?? faltanteCents;
        if (solicitado <= 0) {
          throw ApiError.badRequest("El monto de la reposición debe ser mayor a cero.");
        }
        if (solicitado > faltanteCents) {
          throw ApiError.badRequest(
            `La reposición excede el faltante del fondo ($${(faltanteCents / 100).toFixed(2)} MXN).`
          );
        }

        return { amountCents: solicitado, counterparty: "Fondo de caja chica de la sucursal" };
      }

      // Un cajón de sastre en un lote de pago **es** el bypass: monto libre,
      // referencia libre, sin contraparte que verificar. Si aparece un caso de
      // uso real, se le declara su propio tipo con su propia regla.
      case "OTHER": {
        throw ApiError.badRequest(
          "El tipo de partida OTHER no está permitido en una corrida de pago: no tiene contraparte que verificar. Usa el tipo que corresponda al documento."
        );
      }

      default: {
        // Exhaustividad: si el enum crece, esta asignación deja de compilar.
        const tipoSinRegla: never = itemType;
        throw ApiError.badRequest(
          `Tipo de partida sin regla de contraparte declarada: ${String(tipoSinRegla)}`
        );
      }
    }
  }

  /**
   * Agrega una partida a una corrida de pago (Módulo 6.1).
   *
   * `companyId` viene de la sesión, nunca del body: sin él, una factura de otra
   * empresa con su `id` conocido entraba al lote (G1.2).
   */
  static async addItemToRun(input: {
    paymentRunId: string;
    companyId: string;
    itemType: typeof paymentRunItemTypeEnum.enumValues[number];
    referenceId: string;
    /** Ignorado en los tipos con documento; el monto se lee del documento. */
    amountCents?: number;
    notes?: string;
  }) {
    const { paymentRunId, companyId, itemType, referenceId, notes } = input;

    const run = await db.query.paymentRuns.findFirst({
      where: and(eq(paymentRuns.id, paymentRunId), eq(paymentRuns.companyId, companyId)),
      columns: { id: true, status: true },
    });

    if (!run) throw ApiError.notFound("Corrida de pago no encontrada");
    if (run.status !== "DRAFT") {
      throw ApiError.badRequest("Solo puedes agregar ítems a una corrida en estado DRAFT.");
    }

    const { amountCents } = await TreasuryService.assertCounterpartyPayable({
      companyId,
      itemType,
      referenceId,
      amountCents: input.amountCents,
      notes,
    });

    // La partida y el total de la corrida se escriben juntos: antes eran dos
    // escrituras sueltas y un fallo entre ellas dejaba la corrida cuadrando mal.
    return db.transaction(async (tx) => {
      const [item] = await tx
        .insert(paymentRunItems)
        .values({ paymentRunId, itemType, referenceId, amountCents, notes })
        .returning();

      await tx
        .update(paymentRuns)
        .set({
          totalAmountCents: sql`${paymentRuns.totalAmountCents} + ${amountCents}`,
          updatedAt: new Date(),
        })
        .where(eq(paymentRuns.id, paymentRunId));

      return item;
    });
  }

  /**
   * Fetches the details of a specific payment run, joining items.
   */
  static async getPaymentRunDetails(paymentRunId: string) {
    const run = await db.query.paymentRuns.findFirst({
      where: eq(paymentRuns.id, paymentRunId),
    });

    if (!run) throw new Error("Payment run not found");

    let branchName = "Todas las sucursales (Consolidado)";
    if (run.branchId) {
      const b = await db.query.branches.findFirst({
        where: eq(branches.id, run.branchId),
        columns: { name: true }
      });
      if (b) branchName = b.name;
    }

    const items = await db.query.paymentRunItems.findMany({
      where: eq(paymentRunItems.paymentRunId, paymentRunId),
    });

    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        if (item.itemType === 'INVOICE') {
          const inv = await db.query.invoices.findFirst({
            where: eq(invoices.id, item.referenceId),
            columns: { folio: true, uuid: true, rfcEmisor: true, nombreEmisor: true, fecha: true }
          });
          return { ...item, invoiceDetails: inv || null };
        }
        if (item.itemType === 'PAYROLL') {
          const pr = await db.query.payrollRuns.findFirst({
            where: eq(payrollRuns.id, item.referenceId),
            columns: { periodStart: true, periodEnd: true, status: true }
          });
          return { ...item, payrollDetails: pr || null };
        }
        return item;
      })
    );

    return { 
      run: { ...run, branchName }, 
      items: enrichedItems 
    };
  }

  /**
   * Create a recurring contract (Gasto Operativo Recurrente)
   */
  /**
   * Alta de un contrato recurrente.
   *
   * Firma por objeto y no posicional (mismo criterio que `addItemToRun`): con
   * las tolerancias eran once parámetros en fila, y `createRecurringContract(a,
   * b, c, d, e, 250000, f, g, 10, 30)` no se puede leer ni revisar.
   *
   * `varianceTolerancePercent` era inalcanzable desde la aplicación: la columna
   * admitía cualquier valor pero esta función no lo recibía, así que TODO
   * contrato quedaba con el 10% por omisión. Para un servicio de monto variable
   * —luz, agua— ese 10% sobre un monto fijo se rebasa cada temporada, y la
   * excepción resultante se vuelve ruido que la gente aprende a ignorar.
   */
  static async createRecurringContract(input: {
    companyId: string;
    branchId: string | null;
    supplierId: string;
    title: string;
    contractType: string;
    baseAmountCents: number;
    startDate: Date;
    userId: string;
    paymentFrequency?: string;
    /** Tolerancia por arriba, en %. Por omisión 10. */
    varianceTolerancePercent?: number;
    /** Tolerancia por abajo, en %. `null`/omitido = no alertar por debajo. */
    varianceToleranceBelowPercent?: number | null;
  }) {
    const arriba = input.varianceTolerancePercent ?? 10;
    const abajo = input.varianceToleranceBelowPercent ?? null;

    // Se validan aquí y no sólo en la ruta: el servicio es la frontera que
    // también cruzan los seeds y cualquier script.
    if (!Number.isInteger(arriba) || arriba < 0 || arriba > 1000) {
      throw new Error("La tolerancia superior debe ser un entero entre 0 y 1000 por ciento.");
    }
    if (abajo !== null && (!Number.isInteger(abajo) || abajo < 0 || abajo > 100)) {
      // El tope de abajo es 100: una desviación del -100% es un recibo en cero,
      // y no hay nada por debajo de eso que un porcentaje pueda describir.
      throw new Error("La tolerancia inferior debe ser un entero entre 0 y 100 por ciento.");
    }

    const [contract] = await db.insert(recurringContracts)
      .values({
        companyId: input.companyId,
        branchId: input.branchId && input.branchId !== "ALL" ? input.branchId : null,
        supplierId: input.supplierId,
        title: input.title,
        contractType: input.contractType,
        baseAmountCents: input.baseAmountCents,
        startDate: input.startDate,
        paymentFrequency: input.paymentFrequency ?? "MONTHLY",
        varianceTolerancePercent: arriba,
        varianceToleranceBelowPercent: abajo,
        createdBy: input.userId,
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
      orderBy: (paymentRuns, { desc }) => [desc(paymentRuns.runDate)],
    });
  }

  /**
   * Fetch all recurring contracts for a company with vendor and branch enrichment.
   */
  static async getRecurringContracts(companyId: string) {
    const contracts = await db.query.recurringContracts.findMany({
      where: eq(recurringContracts.companyId, companyId),
      orderBy: (contracts, { asc }) => [asc(contracts.createdAt)],
    });

    const supplierIds = contracts.map(c => c.supplierId).filter(Boolean);
    const branchIds = contracts.map(c => c.branchId).filter(Boolean) as string[];

    const supplierMap = new Map<string, string>();
    if (supplierIds.length > 0) {
      const suppList = await db.query.suppliers.findMany({
        where: inArray(suppliers.id, supplierIds),
        columns: { id: true, name: true }
      });
      suppList.forEach(s => supplierMap.set(s.id, s.name));
    }

    const branchMap = new Map<string, string>();
    if (branchIds.length > 0) {
      const branchList = await db.query.branches.findMany({
        where: inArray(branches.id, branchIds),
        columns: { id: true, name: true }
      });
      branchList.forEach(b => branchMap.set(b.id, b.name));
    }

    return contracts.map(c => ({
      ...c,
      vendorName: supplierMap.get(c.supplierId) || null,
      branchName: c.branchId ? branchMap.get(c.branchId) || "Sucursal" : "Todas las sucursales",
    }));
  }

  /**
   * La validación de una factura contra su contrato recurrente vive en
   * `lib/services/recurring-contract-variance.ts`.
   *
   * Aquí existía `validateInvoiceAgainstContract`, que nadie llamaba y que
   * duplicaba con otro criterio de severidad la regla que sí corre en
   * `control-interno-service`. Además elegía contrato con
   * `contracts.find(...) || contracts[0]`: con dos contratos del mismo
   * proveedor tomaba el primero que devolviera la base de datos. Dos
   * implementaciones de una regla de dinero, una sin ejecutar, es una
   * invitación a arreglar la equivocada.
   */

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
