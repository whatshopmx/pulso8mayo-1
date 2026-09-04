import { db } from "@/lib/db";
import { approvalRequests, purchaseOrders, purchaseOrderItems, requisitions, requisitionItems, suppliers, branches, inventoryBatches, inventoryItems, companies, users, invoices } from "@/lib/db/schema";
import { eq, and, desc, sql, inArray, or, asc, ilike } from "drizzle-orm";
import { AuditService } from "./audit-service";
import { ApiError } from "@/lib/api/error";
import { nextFolio } from "./folio-generator";
import { createApprovalRequests, resolveApprovalChain } from "./approval-matrix-service";
import { checkBudgetAvailability, validateEmergencyCap } from "./budget-service";

type POStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SENT' | 'PARTIALLY_RECEIVED' | 'CLOSED' | 'CANCELLED';
type POItemStatus = 'PENDING' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

const VALID_TRANSITIONS: Record<POStatus, POStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['SENT', 'CANCELLED'],
  REJECTED: ['DRAFT', 'CANCELLED'],
  SENT: ['PARTIALLY_RECEIVED', 'CLOSED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['CLOSED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
};

export class PurchaseOrderService {

  static async generatePONumber(companyId: string): Promise<string> {
    const year = new Date().getFullYear();
    const [result] = await db.select({
      count: sql<number>`count(*)`,
    })
      .from(purchaseOrders)
      .where(and(
        eq(purchaseOrders.companyId, companyId),
        sql`EXTRACT(YEAR FROM ${purchaseOrders.createdAt}) = ${year}`
      ));
    const nextNum = (result?.count || 0) + 1;
    return `PO-${year}-${String(nextNum).padStart(4, '0')}`;
  }

  static async generateRequisitionNumber(companyId: string): Promise<string> {
    const year = new Date().getFullYear();
    const [result] = await db.select({
      count: sql<number>`count(*)`,
    })
      .from(requisitions)
      .where(and(
        eq(requisitions.companyId, companyId),
        sql`EXTRACT(YEAR FROM ${requisitions.createdAt}) = ${year}`
      ));
    const nextNum = (result?.count || 0) + 1;
    return `REQ-${year}-${String(nextNum).padStart(4, '0')}`;
  }

  static async validateTransition(currentStatus: POStatus, newStatus: POStatus): Promise<void> {
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(`Transición inválida: ${currentStatus} → ${newStatus}`);
    }
  }

  static async getHistoricalAverageCost(
    companyId: string,
    supplierId: string,
    itemId: string,
    days: number = 90
  ): Promise<number | null> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const [result] = await db.select({
      avgCost: sql<number>`AVG(${inventoryBatches.unitCost})`,
    })
      .from(inventoryBatches)
      .where(and(
        eq(inventoryBatches.itemId, itemId),
        eq(inventoryBatches.supplierId, supplierId),
        sql`${inventoryBatches.receivedAt} >= ${cutoffDate}`,
        sql`${inventoryBatches.unitCost} IS NOT NULL`
      ));

    if (result && result.avgCost !== null) {
      return Math.round(Number(result.avgCost));
    }

    // Fallback: check lastCost in inventoryItems
    const item = await db.query.inventoryItems.findFirst({
      where: eq(inventoryItems.id, itemId),
    });

    return item?.lastCost || null;
  }

  // --- Requisitions ---

  static async createRequisition(data: {
    companyId: string;
    branchId: string;
    requestedBy: string;
    notes?: string;
    dateRequired?: Date;
    items: Array<{
      itemId: string;
      requestedQuantity: number;
      notes?: string;
    }>;
  }) {
    return await db.transaction(async (tx) => {
      const reqNumber = await this.generateRequisitionNumber(data.companyId);
      const [req] = await tx.insert(requisitions).values({
        companyId: data.companyId,
        branchId: data.branchId,
        requisitionNumber: reqNumber,
        requestedBy: data.requestedBy,
        notes: data.notes,
        dateRequired: data.dateRequired,
      }).returning();

      const itemsData = data.items.map(item => ({
        requisitionId: req.id,
        itemId: item.itemId,
        requestedQuantity: item.requestedQuantity,
        notes: item.notes,
      }));

      const items = await tx.insert(requisitionItems).values(itemsData).returning();
      return { requisition: req, items };
    });
  }

  static async getRequisition(id: string) {
    return db.query.requisitions.findFirst({
      where: eq(requisitions.id, id),
    });
  }

  static async getRequisitionItems(requisitionId: string) {
    return db.select()
      .from(requisitionItems)
      .where(eq(requisitionItems.requisitionId, requisitionId));
  }

  static async listRequisitions(companyId: string, branchId?: string) {
    const conditions = [eq(requisitions.companyId, companyId)];
    if (branchId) conditions.push(eq(requisitions.branchId, branchId));
    return db.select()
      .from(requisitions)
      .where(and(...conditions))
      .orderBy(desc(requisitions.requestedAt));
  }

  // --- Purchase Orders ---

  static async createPO(data: {
    companyId: string;
    branchId: string;
    supplierId: string;
    requestedBy: string;
    requisitionId?: string;
    dateRequired?: Date;
    expectedDeliveryDate?: Date;
    notes?: string;
    termsConditions?: string;
    items: Array<{
      itemId: string;
      orderedQuantity: number;
      unitCost: number;
      notes?: string;
    }>;
  }) {
    const tx = db;
    const poNumber = await this.generatePONumber(data.companyId);

    // Fetch product details for tax rates
    const itemIds = data.items.map(i => i.itemId);
    const dbItems = itemIds.length > 0 ? await tx.select({
      id: inventoryItems.id,
      taxRate: inventoryItems.taxRate,
      iepsRate: inventoryItems.iepsRate,
    })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, itemIds)) : [];

    const dbItemsMap = new Map(dbItems.map(i => [i.id, i]));

    let totalSubtotal = 0;
    let totalTaxAmount = 0;
    let totalIepsAmount = 0;

    const processedItems = data.items.map(item => {
      const dbItem = dbItemsMap.get(item.itemId);
      const itemTaxRate = dbItem?.taxRate ?? 16;
      const itemIepsRate = dbItem?.iepsRate ?? 0;

      const lineTotal = item.orderedQuantity * item.unitCost;
      const lineTax = Math.round(lineTotal * (itemTaxRate / 100));
      const lineIeps = Math.round(lineTotal * (itemIepsRate / 100));

      totalSubtotal += lineTotal;
      totalTaxAmount += lineTax;
      totalIepsAmount += lineIeps;

      return {
        itemId: item.itemId,
        orderedQuantity: item.orderedQuantity,
        unitCost: item.unitCost,
        lineTotal,
        taxRate: itemTaxRate,
        taxAmount: lineTax,
        iepsRate: itemIepsRate,
        iepsAmount: lineIeps,
        notes: item.notes,
      };
    });

    const [po] = await tx.insert(purchaseOrders).values({
      companyId: data.companyId,
      branchId: data.branchId,
      poNumber,
      supplierId: data.supplierId,
      requestedBy: data.requestedBy,
      requisitionId: data.requisitionId || null,
      dateRequired: data.dateRequired,
      expectedDeliveryDate: data.expectedDeliveryDate,
      notes: data.notes,
      termsConditions: data.termsConditions,
      subtotal: totalSubtotal,
      taxAmount: totalTaxAmount,
      iepsAmount: totalIepsAmount,
      totalAmount: totalSubtotal + totalTaxAmount + totalIepsAmount,
    }).returning();

    const itemsData = processedItems.map(item => ({
      poId: po.id,
      ...item,
    }));

    const items = await tx.insert(purchaseOrderItems).values(itemsData).returning();

    if (data.requisitionId) {
      await tx.update(requisitions)
        .set({ status: 'CONVERTED' })
        .where(eq(requisitions.id, data.requisitionId));
    }

    AuditService.logInventoryAction({
      companyId: data.companyId,
      branchId: data.branchId,
      action: 'CREATE',
      entityType: 'PURCHASE_ORDER',
      entityId: po.id,
      newValue: { po, items },
      performedBy: data.requestedBy,
      reason: data.notes || 'PO created',
    });

    return { po, items };
  }

  static async getPO(id: string) {
    const [row] = await db.select({
      po: purchaseOrders,
      supplierName: suppliers.name,
      branchName: branches.name,
      requestedByName: users.name,
    })
      .from(purchaseOrders)
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .leftJoin(branches, eq(purchaseOrders.branchId, branches.id))
      .leftJoin(users, eq(purchaseOrders.requestedBy, users.id))
      .where(eq(purchaseOrders.id, id))
      .limit(1);

    if (!row) return null;

    const itemRows = await db.select({
      item: purchaseOrderItems,
      itemName: inventoryItems.name,
    })
      .from(purchaseOrderItems)
      .leftJoin(inventoryItems, eq(purchaseOrderItems.itemId, inventoryItems.id))
      .where(eq(purchaseOrderItems.poId, id));

    const items = itemRows.map(r => ({
      ...r.item,
      itemName: r.itemName || r.item.itemId,
    }));

    // Facturas recibidas contra esta OC. Sin esto, el detalle de la orden no
    // decía si ya llegó su CFDI ni si ya se pagó — había que adivinarlo desde
    // el módulo de finanzas, buscando por proveedor y monto a mano.
    const relatedInvoices = await db
      .select({
        id: invoices.id,
        folio: invoices.folio,
        serie: invoices.serie,
        uuid: invoices.uuid,
        total: invoices.total,
        fecha: invoices.fecha,
        matchStatus: invoices.matchStatus,
        paymentStatus: invoices.paymentStatus,
      })
      .from(invoices)
      .where(eq(invoices.purchaseOrderId, id))
      .orderBy(desc(invoices.createdAt));

    return {
      ...row.po,
      supplierName: row.supplierName || row.po.supplierId,
      branchName: row.branchName || row.po.branchId,
      requestedBy: row.requestedByName || row.po.requestedBy,
      items,
      invoices: relatedInvoices,
    };
  }

  static async listPOs(params: {
    companyId: string;
    branchId?: string;
    supplierId?: string;
    status?: POStatus;
    dateFrom?: Date;
    dateTo?: Date;
    search?: string;
    sortField?: string;
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }) {
    const conditions = [eq(purchaseOrders.companyId, params.companyId)];
    if (params.branchId) conditions.push(eq(purchaseOrders.branchId, params.branchId));
    if (params.supplierId) conditions.push(eq(purchaseOrders.supplierId, params.supplierId));
    if (params.status) conditions.push(eq(purchaseOrders.status, params.status));
    if (params.dateFrom) conditions.push(sql`${purchaseOrders.createdAt} >= ${params.dateFrom}`);
    if (params.dateTo) conditions.push(sql`${purchaseOrders.createdAt} <= ${params.dateTo}`);

    if (params.search) {
      conditions.push(or(
        ilike(purchaseOrders.poNumber, `%${params.search}%`),
        ilike(suppliers.name, `%${params.search}%`)
      ));
    }

    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    let orderByClause: any = desc(purchaseOrders.createdAt);
    if (params.sortField) {
      const orderFn = params.sortOrder === 'asc' ? asc : desc;
      switch (params.sortField) {
        case 'poNumber':
          orderByClause = orderFn(purchaseOrders.poNumber);
          break;
        case 'supplierName':
          orderByClause = orderFn(suppliers.name);
          break;
        case 'branchName':
          orderByClause = orderFn(branches.name);
          break;
        case 'status':
          orderByClause = orderFn(purchaseOrders.status);
          break;
        case 'totalAmount':
          orderByClause = orderFn(purchaseOrders.totalAmount);
          break;
        case 'createdAt':
          orderByClause = orderFn(purchaseOrders.createdAt);
          break;
      }
    }

    const rows = await db.select({
      po: purchaseOrders,
      supplierName: suppliers.name,
      branchName: branches.name,
      itemCount: sql<number>`(
        SELECT count(*) FROM ${purchaseOrderItems}
        WHERE ${purchaseOrderItems.poId} = ${purchaseOrders.id}
      )`,
    })
      .from(purchaseOrders)
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .leftJoin(branches, eq(purchaseOrders.branchId, branches.id))
      .where(and(...conditions))
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    const [countResult] = await db.select({
      total: sql<number>`count(*)`,
    })
      .from(purchaseOrders)
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .leftJoin(branches, eq(purchaseOrders.branchId, branches.id))
      .where(and(...conditions));

    return { orders: rows, total: countResult?.total ?? 0, limit, offset };
  }

  static async updatePO(id: string, data: Partial<typeof purchaseOrders.$inferInsert>, userId: string) {
    const current = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, id) });
    if (!current) throw new Error("PO not found");
    if (!['DRAFT', 'REJECTED'].includes(current.status)) {
      throw new Error("Solo se pueden editar POs en estado Borrador o Rechazado");
    }

    const [updated] = await db.update(purchaseOrders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id))
      .returning();

    AuditService.logInventoryAction({
      companyId: updated.companyId,
      branchId: updated.branchId,
      action: 'UPDATE',
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      oldValue: current,
      newValue: updated,
      performedBy: userId,
      reason: 'PO updated',
    });

    return updated;
  }

  static async updatePOItems(poId: string, items: Array<{
    id?: string;
    itemId: string;
    orderedQuantity: number;
    unitCost: number;
    notes?: string;
  }>, userId: string) {
    const po = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, poId) });
    if (!po) throw new Error("PO not found");
    if (!['DRAFT', 'REJECTED'].includes(po.status)) {
      throw new Error("Solo se pueden editar items en POs en Borrador o Rechazado");
    }

    const tx = db;
    await tx.delete(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, poId));

    // Fetch product details for tax rates
    const itemIds = items.map(i => i.itemId);
    const dbItems = itemIds.length > 0 ? await tx.select({
      id: inventoryItems.id,
      taxRate: inventoryItems.taxRate,
      iepsRate: inventoryItems.iepsRate,
    })
      .from(inventoryItems)
      .where(inArray(inventoryItems.id, itemIds)) : [];

    const dbItemsMap = new Map(dbItems.map(i => [i.id, i]));

    let totalSubtotal = 0;
    let totalTaxAmount = 0;
    let totalIepsAmount = 0;

    const itemsData = items.map(item => {
      const dbItem = dbItemsMap.get(item.itemId);
      const itemTaxRate = dbItem?.taxRate ?? 16;
      const itemIepsRate = dbItem?.iepsRate ?? 0;

      const lineTotal = item.orderedQuantity * item.unitCost;
      const lineTax = Math.round(lineTotal * (itemTaxRate / 100));
      const lineIeps = Math.round(lineTotal * (itemIepsRate / 100));

      totalSubtotal += lineTotal;
      totalTaxAmount += lineTax;
      totalIepsAmount += lineIeps;

      return {
        poId,
        itemId: item.itemId,
        orderedQuantity: item.orderedQuantity,
        unitCost: item.unitCost,
        lineTotal,
        taxRate: itemTaxRate,
        taxAmount: lineTax,
        iepsRate: itemIepsRate,
        iepsAmount: lineIeps,
        notes: item.notes,
      };
    });

    const newItems = await tx.insert(purchaseOrderItems).values(itemsData).returning();

    await tx.update(purchaseOrders)
      .set({
        subtotal: totalSubtotal,
        taxAmount: totalTaxAmount,
        iepsAmount: totalIepsAmount,
        totalAmount: totalSubtotal + totalTaxAmount + totalIepsAmount,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, poId));

    AuditService.logInventoryAction({
      companyId: po.companyId,
      branchId: po.branchId,
      action: 'UPDATE',
      entityType: 'PURCHASE_ORDER',
      entityId: poId,
      oldValue: { items: 'replaced' },
      newValue: { items: newItems },
      performedBy: userId,
      reason: 'PO items updated',
    });

    return newItems;
  }

  // --- Status Transitions ---

  /**
   * Submit de OC a aprobación por matriz (finzasordenes.md §4, Task 6).
   *
   * Misma mecánica que la OS (service-order-service.submitOrder): cadena de
   * autorización → presupuesto o tope de emergencias → folio real OC-[SUC]-[AÑO]-[N]
   * emitido en transacción atómica junto al cambio de estado y los approval_requests.
   *
   * Requisitos nuevos al enviar (retrocompatibles): purchaseType asignado y
   * total > 0. Las OC ya enviadas antes de la matriz no pasan por aquí.
   */
  static async submitForApproval(id: string, userId: string, companyId?: string) {
    const [po] = await db
      .select()
      .from(purchaseOrders)
      .where(
        companyId
          ? and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, companyId))
          : eq(purchaseOrders.id, id),
      )
      .limit(1);
    if (!po) throw new ApiError("Orden de compra no encontrada", 404);
    if (po.status !== 'DRAFT') {
      throw new ApiError("La orden ya fue enviada y no está en borrador", 409);
    }

    const total = po.totalAmount ?? 0;
    if (total <= 0) {
      throw new ApiError("La orden requiere un total mayor a cero antes de enviarla a aprobación", 400);
    }
    const purchaseType = po.purchaseType ?? null;
    if (!purchaseType) {
      throw new ApiError(
        "Selecciona el tipo de compra (PROGRAMADA / STOCK / EMERGENCIA) antes de enviar la orden",
        400,
      );
    }

    const effectiveCompanyId = companyId ?? po.companyId;

    // 1. Cadena de autorización según matriz OC (seed perezoso en primera llamada).
    const chain = await resolveApprovalChain(effectiveCompanyId, "OC", total);
    if (chain.length === 0) {
      throw new ApiError(
        "El monto no está cubierto por la matriz de autorización. " +
          "Pide a un administrador que agregue una regla que cubra este rango.",
        400,
      );
    }

    // 2. Presupuesto o tope de emergencias — mes de created_at, igual que OS.
    const month = po.createdAt.toISOString().slice(0, 7);
    if (purchaseType === 'EMERGENCIA') {
      const capCheck = await validateEmergencyCap(effectiveCompanyId, po.branchId, month, total);
      if (!capCheck.allowed) {
        const overBy = capCheck.overBy ?? 0;
        throw new ApiError(
          `Tope mensual de compras de emergencia excedido por $${(overBy / 100).toFixed(2)}. ` +
            `Tope: $${((capCheck.cap ?? 0) / 100).toFixed(2)}, usado antes: $${((capCheck.usedBefore ?? 0) / 100).toFixed(2)}.`,
          400,
          { cap: capCheck.cap, usedBefore: capCheck.usedBefore, overBy },
        );
      }
    } else {
      if (!po.costCenterId) {
        throw new ApiError(
          "Asigna un centro de costo a la orden: sin partida no hay contra qué validar presupuesto.",
          400,
        );
      }
      const budget = await checkBudgetAvailability(po.branchId, po.costCenterId, month, total);
      if (!budget.ok) {
        throw new ApiError(
          `Presupuesto insuficiente: disponible $${(budget.available / 100).toFixed(2)} ` +
            `de $${(budget.budgeted / 100).toFixed(2)} presupuestado; la orden requiere $${(total / 100).toFixed(2)}.`,
          400,
          { budget },
        );
      }
    }

    // 3. Transacción atómica: folio real + status + approvals. Un submit
    // concurrente pierde por el WHERE status='DRAFT' y el rollback devuelve
    // también el consecutivo (folios sin saltos).
    const result = await db.transaction(async (tx) => {
      const issued = await nextFolio({
        companyId: effectiveCompanyId,
        branchId: po.branchId,
        docType: "OC",
        tx,
      });
      const updated = await tx
        .update(purchaseOrders)
        .set({
          poNumber: issued.folio,
          folioYear: issued.year,
          folioSequence: issued.sequence,
          status: 'PENDING_APPROVAL' as POStatus,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(purchaseOrders.id, id),
            eq(purchaseOrders.companyId, effectiveCompanyId),
            eq(purchaseOrders.status, 'DRAFT'),
          ),
        )
        .returning();
      if (updated.length === 0) {
        throw new ApiError("La orden ya fue enviada por otro usuario", 409);
      }
      const approvalsCreated = await createApprovalRequests({
        companyId: effectiveCompanyId,
        docType: "OC",
        docId: id,
        chain,
        tx,
      });
      return { order: updated[0], issued, approvalsCreated };
    });

    AuditService.logInventoryAction({
      companyId: effectiveCompanyId,
      branchId: po.branchId,
      action: 'UPDATE',
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      oldValue: { status: po.status, poNumber: po.poNumber },
      newValue: { status: 'PENDING_APPROVAL', poNumber: result.issued.folio },
      performedBy: userId,
    });

    return result.order;
  }

  /**
   * ¿Tiene esta OC requests PENDING de la matriz? Si sí, ya no se aprueba/rechaza
   * directo: manda a la bandeja (segregación de niveles de la matriz §4).
   */
  private static async assertNotMatrixManaged(id: string) {
    const [req] = await db
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.docType, 'OC'),
          eq(approvalRequests.docId, id),
          eq(approvalRequests.status, 'PENDING'),
        ),
      )
      .limit(1);
    if (req) {
      throw new ApiError(
        "Esta orden está bajo la matriz de autorización: apruébala o recházala desde la bandeja de aprobaciones",
        409,
      );
    }
  }

  static async approvePO(id: string, approvedBy: string) {
    await this.assertNotMatrixManaged(id);
    const po = await this.transitionStatus(id, 'APPROVED', approvedBy);
    await db.update(purchaseOrders)
      .set({ approvedBy, approvedAt: new Date() })
      .where(eq(purchaseOrders.id, id));
    return po;
  }

  static async rejectPO(id: string, rejectedBy: string, reason: string) {
    await this.assertNotMatrixManaged(id);
    const po = await this.transitionStatus(id, 'REJECTED', rejectedBy);
    await db.update(purchaseOrders)
      .set({ approvedBy: rejectedBy, approvedAt: new Date(), rejectionReason: reason })
      .where(eq(purchaseOrders.id, id));
    return po;
  }

  static async sendPO(id: string, userId: string) {
    return this.transitionStatus(id, 'SENT', userId);
  }

  static async closePO(id: string, userId: string) {
    const po = await this.getPO(id);
    if (!po) throw new Error("PO not found");

    const allReceived = po.items.every(item =>
      item.status === 'RECEIVED' || item.receivedQuantity >= item.orderedQuantity
    );
    const targetStatus: POStatus = allReceived ? 'CLOSED' : 'PARTIALLY_RECEIVED';
    return this.transitionStatus(id, targetStatus, userId);
  }

  static async cancelPO(id: string, userId: string, reason: string) {
    const po = await this.transitionStatus(id, 'CANCELLED', userId);
    await db.update(purchaseOrders)
      .set({ cancelledAt: new Date(), cancellationReason: reason })
      .where(eq(purchaseOrders.id, id));
    return po;
  }

  private static async transitionStatus(id: string, newStatus: POStatus, userId: string) {
    const po = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, id) });
    if (!po) throw new Error("PO not found");

    await this.validateTransition(po.status as POStatus, newStatus);

    const [updated] = await db.update(purchaseOrders)
      .set({
        status: newStatus,
        updatedAt: new Date(),
        ...(newStatus === 'SENT' ? { sentAt: new Date() } : {}),
        ...(newStatus === 'CLOSED' || newStatus === 'PARTIALLY_RECEIVED' ? { receivedAt: new Date() } : {}),
        ...(newStatus === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
      })
      .where(eq(purchaseOrders.id, id))
      .returning();

    AuditService.logInventoryAction({
      companyId: po.companyId,
      branchId: po.branchId,
      action: 'UPDATE',
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      oldValue: { status: po.status },
      newValue: { status: newStatus },
      performedBy: userId,
      reason: `PO status: ${po.status} → ${newStatus}`,
    });

    return updated;
  }

  // --- Receiving Updates (called from receiving workflow) ---

  static async recordReceivedQuantity(poId: string, itemId: string, receivedQty: number, _userId: string) {
    const tx = db;
    const poItem = await tx.query.purchaseOrderItems.findFirst({
      where: and(
        eq(purchaseOrderItems.poId, poId),
        eq(purchaseOrderItems.itemId, itemId)
      ),
    });
    if (!poItem) throw new Error("PO item not found");

    const newReceived = (poItem.receivedQuantity || 0) + receivedQty;
    const itemStatus: POItemStatus = newReceived >= poItem.orderedQuantity ? 'RECEIVED' : 'PARTIALLY_RECEIVED';

    await tx.update(purchaseOrderItems)
      .set({
        receivedQuantity: newReceived,
        status: itemStatus,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrderItems.id, poItem.id));

    const allItems = await tx.select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.poId, poId));

    const allReceived = allItems.every(i => i.status === 'RECEIVED');
    const anyReceived = allItems.some(i => (i.receivedQuantity || 0) > 0);

    if (allReceived) {
      await tx.update(purchaseOrders)
        .set({ status: 'CLOSED', receivedAt: new Date(), updatedAt: new Date() })
        .where(eq(purchaseOrders.id, poId));
    } else if (anyReceived) {
      await tx.update(purchaseOrders)
        .set({ status: 'PARTIALLY_RECEIVED', updatedAt: new Date() })
        .where(eq(purchaseOrders.id, poId));
    }

    return { item: poItem, newReceived, itemStatus };
  }
}
