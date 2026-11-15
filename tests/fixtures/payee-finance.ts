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
      ...(associated ? [] : [{ ...common, id: invoiceId, source: "INVOICE", reference: "F-123" }])],
      itemsTotal: associated ? 1 : 2, totalCents: associated ? 450000 : 900000,
      confirmedCents: associated ? 450000 : 900000, confirmedOverdueCents: 0, estimatedCents: 0,
      overdueCents: 0, overdueCount: 0, dueThisWeekCents: associated ? 450000 : 900000, buckets: [], byCounterparty: [], missingDueDateCount: 0 },
    expenses: [{ id: expenseId, description: "Energía eléctrica de noviembre", amountCents: 450000,
      status: "APPROVED", invoiceId: associated ? invoiceId : null, evidenceUrl: null, businessDate: "2026-11-01",
      createdAt: "2026-11-01T12:00:00Z", dueDate: "2026-11-20", paidAt: null, branchId, branchName: "Centro" }],
    documents: [{ id: invoiceId, uuid: "CFDI-DE-PRUEBA-123", folio: "123", serie: "F", amountCents: 450000,
      status: "PENDING", date: "2026-11-01", dueDate: "2026-11-20", branchId, branchName: "Centro", supplierName: "Proveedor de prueba", expenseId: associated ? expenseId : null }],
    pendingApprovalCents: 0, moreExpenses: false, moreDocuments: false,
    suppliers: [{ id: "supplier", name: "Proveedor de prueba", taxId: "AAA010101AAA" }],
    accounts: [{ id: "account", bankName: "Banco de prueba", last4: "1234", status: "VERIFIED" }], supplierAccounts: [],
  };
}
