export const payeeId = "00000000-0000-4000-8000-000000000002";
export const branchId = "00000000-0000-4000-8000-000000000003";
export const invoiceId = "00000000-0000-4000-8000-000000000005";
export const expenseId = "00000000-0000-4000-8000-000000000006";
export function payeeFixture(associated = false) {
  const common = { counterparty: "Servicios del Centro", supplierId: "supplier", payeeId, branchId, branchName: "Centro",
    amountCents: 450000, dueDate: "2026-11-20", daysUntilDue: 5, bucket: "DUE_7", matchStatus: null,
    hasDiscrepancy: false, bankAccountStatus: "VERIFIED", canPay: true, blockedReason: null };
  return {
    payee: { id: payeeId, name: "Servicios del Centro", taxId: "AAA010101AAA", active: true, contactName: "Contacto de prueba", email: "contacto@example.com", phone: null },
    payables: { items: [{ ...common, id: expenseId, source: "OPERATING_EXPENSE", reference: "Energía eléctrica de noviembre" },
      ...(associated ? [] : [{ ...common, id: invoiceId, source: "INVOICE", invoiceDestination: "UNCLASSIFIED", reference: "F-123" }])],
      itemsTotal: associated ? 1 : 2, totalCents: associated ? 450000 : 900000,
      confirmedCents: associated ? 450000 : 900000, confirmedOverdueCents: 0, estimatedCents: 0,
      overdueCents: 0, overdueCount: 0, dueThisWeekCents: associated ? 450000 : 900000, buckets: [], byCounterparty: [], missingDueDateCount: 0 },
    expenses: [{ id: expenseId, description: "Energía eléctrica de noviembre", amountCents: 450000,
      status: "APPROVED", invoiceId: associated ? invoiceId : null, evidenceUrl: null, businessDate: "2026-11-01",
      createdAt: "2026-11-01T12:00:00Z", dueDate: "2026-11-20", paidAt: null, branchId, branchName: "Centro" }],
    documents: [{ id: invoiceId, uuid: "CFDI-DE-PRUEBA-123", folio: "123", serie: "F", amountCents: 450000,
      destination: "UNCLASSIFIED", satStatus: null, hasPurchaseOrder: false, hasReceivingReport: false, hasRecurringContract: false, hasServiceOrder: false,
      identityConflict: false, requiresReview: true, expenseCount: associated ? 1 : 0, expenseAmountCents: associated ? 450000 : null,
      status: "PENDING", date: "2026-11-01", dueDate: "2026-11-20", branchId, branchName: "Centro", supplierName: "Proveedor de prueba", expenseId: associated ? expenseId : null }],
    pendingApprovalCents: 0, moreExpenses: false, moreDocuments: false,
    suppliers: [{ id: "supplier", name: "Proveedor de prueba", taxId: "AAA010101AAA" }],
    accounts: [{ id: "account", bankName: "Banco de prueba", last4: "1234", status: "VERIFIED" }], supplierAccounts: [],
  };
}

/**
 * T13 — mismo emisor con dos destinos.
 *
 * Vende harina (compra de inventario con orden de compra), cobra la luz y el
 * mantenimiento como gastos operativos documentados, y conserva una factura
 * histórica sin evidencia. La renta es un gasto sin comprobante todavía.
 */
export const mixedInvoiceIds = {
  harina: "00000000-0000-4000-8000-000000000101",
  luz: "00000000-0000-4000-8000-000000000102",
  mantenimiento: "00000000-0000-4000-8000-000000000103",
  historica: "00000000-0000-4000-8000-000000000104",
  renta: "00000000-0000-4000-8000-000000000105",
};
export const mixedExpenseIds = {
  luz: "00000000-0000-4000-8000-000000000201",
  mantenimiento: "00000000-0000-4000-8000-000000000202",
  renta: "00000000-0000-4000-8000-000000000203",
};
export function mixedIssuerFixture(rentaAsociada = false) {
  const base = { counterparty: "Insumos y Servicios del Centro", supplierId: "supplier", payeeId, branchId,
    branchName: "Centro", dueDate: "2026-11-20", daysUntilDue: 5, bucket: "DUE_7", matchStatus: null,
    hasDiscrepancy: false, bankAccountStatus: "VERIFIED", canPay: true, blockedReason: null };
  const document = (overrides: Record<string, unknown>) => ({ serie: "F", uuid: null, satStatus: null,
    hasPurchaseOrder: false, hasReceivingReport: false, hasRecurringContract: false, hasServiceOrder: false,
    identityConflict: false, requiresReview: false, expenseCount: 0, expenseAmountCents: null, status: "PENDING",
    date: "2026-11-01", dueDate: "2026-11-20", branchId, branchName: "Centro",
    supplierName: "Insumos y Servicios del Centro", expenseId: null, folio: null, ...overrides });
  return {
    payee: { id: payeeId, name: "Insumos y Servicios del Centro", taxId: "AAA010101AAA", active: true,
      contactName: "Contacto de prueba", email: "contacto@example.com", phone: null },
    payables: {
      items: [
        { ...base, id: mixedInvoiceIds.harina, source: "INVOICE", invoiceDestination: "INVENTORY_PURCHASE",
          reference: "Harina · OC-1042", amountCents: 580000 },
        { ...base, id: mixedExpenseIds.luz, source: "OPERATING_EXPENSE", reference: "Energía eléctrica de noviembre",
          amountCents: 116000 },
        { ...base, id: mixedExpenseIds.mantenimiento, source: "OPERATING_EXPENSE", reference: "Mantenimiento de cámara fría",
          amountCents: 348000 },
        { ...base, id: mixedExpenseIds.renta, source: "OPERATING_EXPENSE", reference: "Renta de noviembre",
          amountCents: 232000 },
        { ...base, id: mixedInvoiceIds.historica, source: "INVOICE", invoiceDestination: "UNCLASSIFIED",
          reference: "Factura histórica sin evidencia", amountCents: 23200 },
      ],
      itemsTotal: 5, totalCents: 1319200, confirmedCents: 1319200, confirmedOverdueCents: 0, estimatedCents: 0,
      overdueCents: 0, overdueCount: 0, dueThisWeekCents: 1319200, buckets: [], byCounterparty: [], missingDueDateCount: 0,
    },
    expenses: [
      { id: mixedExpenseIds.luz, description: "Energía eléctrica de noviembre", amountCents: 116000, status: "APPROVED",
        invoiceId: mixedInvoiceIds.luz, evidenceUrl: null, businessDate: "2026-11-01", createdAt: "2026-11-01T12:00:00Z",
        dueDate: "2026-11-25", paidAt: null, branchId, branchName: "Centro" },
      { id: mixedExpenseIds.mantenimiento, description: "Mantenimiento de cámara fría", amountCents: 348000,
        status: "PENDING_APPROVAL", invoiceId: mixedInvoiceIds.mantenimiento, evidenceUrl: null, businessDate: "2026-11-05",
        createdAt: "2026-11-05T12:00:00Z", dueDate: "2026-11-30", paidAt: null, branchId, branchName: "Centro" },
      { id: mixedExpenseIds.renta, description: "Renta de noviembre", amountCents: 232000, status: "APPROVED",
        invoiceId: rentaAsociada ? mixedInvoiceIds.renta : null, evidenceUrl: null, businessDate: "2026-11-01",
        createdAt: "2026-11-01T09:00:00Z", dueDate: "2026-11-10", paidAt: null, branchId, branchName: "Centro" },
    ],
    documents: [
      document({ id: mixedInvoiceIds.harina, uuid: "CFDI-HARINA-1042", folio: "1042", amountCents: 580000,
        destination: "INVENTORY_PURCHASE", hasPurchaseOrder: true }),
      document({ id: mixedInvoiceIds.luz, uuid: "CFDI-LUZ-1101", folio: "1101", amountCents: 116000,
        destination: "OPERATING_EXPENSE", expenseCount: 1, expenseAmountCents: 116000, expenseId: mixedExpenseIds.luz }),
      document({ id: mixedInvoiceIds.mantenimiento, uuid: "CFDI-MANT-1102", folio: "1102", amountCents: 348000,
        destination: "OPERATING_EXPENSE", expenseCount: 1, expenseAmountCents: 348000,
        expenseId: mixedExpenseIds.mantenimiento }),
      document({ id: mixedInvoiceIds.historica, uuid: "CFDI-HIST-0998", folio: "998", amountCents: 23200,
        destination: "UNCLASSIFIED", hasServiceOrder: true, requiresReview: true }),
    ],
    pendingApprovalCents: 348000, moreExpenses: false, moreDocuments: false,
    suppliers: [{ id: "supplier", name: "Insumos y Servicios del Centro", taxId: "AAA010101AAA" }],
    accounts: [{ id: "account", bankName: "Banco de prueba", last4: "1234", status: "VERIFIED" }],
    supplierAccounts: [],
  };
}
