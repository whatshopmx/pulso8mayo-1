// FC-02: synthetic expected postings, NOT a production posting engine or tax policy.
// MXN cents; October business dates are authoritative, even across UTC midnight.
type Line = { account: string; branchId: string; debit: number; credit: number };
type Flow = "opening" | "operating" | "investing" | "financing" | "internal";
const d = (account: string, branchId: string, debit: number): Line => ({ account, branchId, debit, credit: 0 });
const c = (account: string, branchId: string, credit: number): Line => ({ account, branchId, debit: 0, credit });
const a = "branch-a", b = "branch-b", foreign = "branch-foreign";
const j = (id: string, date: string, lines: Line[], flow: Flow = "operating", companyId = "company-a") =>
  ({ id, date, companyId, sourceId: id, sourceVersion: 1, flow, lines });

export const month = {
  currency: "MXN",
  period: { start: "2026-10-01", end: "2026-10-31" },
  assumptions: "Expected synthetic postings for technical review; no customer or approved fiscal rules.",
  branches: [{ id: a, companyId: "company-a" }, { id: b, companyId: "company-a" }, { id: foreign, companyId: "company-foreign" }],
  ruleVersions: [{ id: "rules-v1", effectiveFrom: "2026-10-01" }, { id: "rules-v2", effectiveFrom: "2026-10-16" }],
  documents: [
    { id: "cash-cut", journalId: "cash-sale", kind: "daily_sales_cuts", ruleVersion: "rules-v1" },
    { id: "card-cut", journalId: "card-sale", kind: "daily_sales_cuts", ruleVersion: "rules-v2" },
    { id: "receiving-report", journalId: "receiving", kind: "receiving_reports", ruleVersion: "rules-v1" },
    { id: "supplier-invoice", journalId: "invoice", kind: "invoices", relatesTo: "receiving-report", ruleVersion: "rules-v1" },
    { id: "approved-expense", journalId: "credit-expense", kind: "operating_expenses", ruleVersion: "rules-v2" },
    { id: "payment-1", journalId: "partial-payment-1", kind: "payment_run_items", relatesTo: "approved-expense", ruleVersion: "rules-v2" },
    { id: "payment-2", journalId: "partial-payment-2", kind: "payment_run_items", relatesTo: "approved-expense", ruleVersion: "rules-v2" },
    { id: "gateway-deposit", journalId: "card-settlement", kind: "gateway_transactions", relatesTo: "card-cut", ruleVersion: "rules-v2" },
    { id: "bank-match", journalId: "card-settlement", kind: "bank_transactions", relatesTo: "gateway-deposit", ruleVersion: "rules-v2" },
  ],
  journals: [
    j("opening-a", "2026-10-01", [d("bank", a, 1_000_000), d("cash", a, 100_000), d("inventory", a, 200_000), d("pettyCash", a, 20_000), c("payable", a, 100_000), c("equity", a, 1_220_000)], "opening"),
    j("opening-b", "2026-10-01", [d("bank", b, 500_000), d("cash", b, 50_000), d("inventory", b, 100_000), d("pettyCash", b, 10_000), c("payable", b, 50_000), c("equity", b, 610_000)], "opening"),
    // Cash collection includes a separately documented 2000 tip liability.
    j("cash-sale", "2026-10-05", [d("cash", a, 118_000), c("revenue", a, 100_000), c("outputVat", a, 16_000), c("tipsPayable", a, 2_000)]),
    j("card-sale", "2026-10-31", [d("receivable", a, 232_000), c("revenue", a, 200_000), c("outputVat", a, 32_000)]),
    j("platform-sale", "2026-10-20", [d("receivable", b, 116_000), c("revenue", b, 100_000), c("outputVat", b, 16_000)]),
    j("customer-return", "2026-10-06", [d("revenue", a, 10_000), d("outputVat", a, 1_600), c("cash", a, 11_600)]),
    j("receiving", "2026-10-08", [d("inventory", a, 60_000), c("receivingPending", a, 60_000)]),
    // Invoice amount here has documented zero tax; it only reclassifies the receipt.
    j("invoice", "2026-10-09", [d("receivingPending", a, 60_000), c("payable", a, 60_000)]),
    j("consumption", "2026-10-10", [d("foodCost", a, 70_000), c("inventory", a, 70_000)]),
    j("waste", "2026-10-10", [d("waste", a, 5_000), c("inventory", a, 5_000)]),
    j("inventory-transfer", "2026-10-11", [d("inventory", b, 20_000), c("inventory", a, 20_000)], "internal"),
    j("credit-expense", "2026-10-20", [d("expense", b, 30_000), d("inputVat", b, 4_800), c("payable", b, 34_800)]),
    j("partial-payment-1", "2026-10-21", [d("payable", b, 10_000), c("bank", b, 10_000)]),
    j("partial-payment-2", "2026-10-22", [d("payable", b, 5_000), c("bank", b, 5_000)]),
    j("payroll-recognition", "2026-10-23", [d("labor", a, 80_000), c("payrollPayable", a, 70_000), c("deductionsPayable", a, 10_000)]),
    j("payroll-payment", "2026-10-24", [d("payrollPayable", a, 70_000), c("bank", a, 70_000)]),
    j("petty-cash-expense", "2026-10-25", [d("expense", b, 1_000), d("inputVat", b, 160), c("pettyCash", b, 1_160)]),
    j("petty-cash-replenishment", "2026-10-26", [d("pettyCash", b, 1_160), c("bank", b, 1_160)], "internal"),
    j("own-bank-transfer", "2026-10-27", [d("bank", b, 100_000), c("bank", a, 100_000)], "internal"),
    j("platform-settlement", "2026-10-29", [d("bank", b, 92_800), d("commission", b, 20_000), d("inputVat", b, 3_200), c("receivable", b, 116_000)]),
    // List price 50000, documented discount 5000: net revenue 45000.
    j("discounted-cash-sale", "2026-10-30", [d("cash", b, 52_200), c("revenue", b, 45_000), c("outputVat", b, 7_200)]),
    j("equipment-purchase", "2026-10-30", [d("equipment", b, 50_000), d("inputVat", b, 8_000), c("bank", b, 58_000)], "investing"),
    j("loan-received", "2026-10-30", [d("bank", a, 200_000), c("loan", a, 200_000)], "financing"),
    j("card-settlement", "2026-11-02", [d("bank", a, 225_040), d("commission", a, 6_000), d("inputVat", a, 960), c("receivable", a, 232_000)]),
    j("foreign-company-sale", "2026-10-05", [d("cash", foreign, 999_999), c("revenue", foreign, 999_999)], "operating", "company-foreign"),
  ],
  // Hand-calculated constants; never generated by the accounting service under test.
  expected: {
    totalDebits: 3_400_920, totalCredits: 3_400_920,
    closingBalances: {
      bank: 1_648_640, cash: 308_600, inventory: 285_000, pettyCash: 30_000,
      payable: -229_800, equity: -1_830_000, revenue: -435_000, outputVat: -69_600,
      tipsPayable: -2_000, receivable: 232_000, receivingPending: 0,
      foodCost: 70_000, waste: 5_000, expense: 31_000, inputVat: 16_160,
      labor: 80_000, payrollPayable: 0, deductionsPayable: -10_000,
      commission: 20_000, equipment: 50_000, loan: -200_000,
    },
    statements: { assets: 2_570_400, liabilities: 511_400, equity: 1_830_000, profit: 229_000 },
    cashFlow: { opening: 1_680_000, operating: 165_240, investing: -58_000, financing: 200_000, internal: 0 },
  },
  sourceCases: [
    { id: "duplicate-cut", sourceId: "cash-sale", expected: "reuse", reason: "Same cut business key and version" },
    { id: "recipe-overlap", sourceId: "cash-sale", expected: "exclude", reason: "Recipe sales overlap canonical cut" },
    { id: "duplicate-bank-import", sourceId: "platform-settlement", expected: "reuse", reason: "Fingerprint and confirmed match already linked" },
    { id: "failed-payment", sourceId: "credit-expense", expected: "exclude", reason: "FAILED is not a cash outflow" },
    { id: "unconfirmed-payment", sourceId: "credit-expense", expected: "pending", reason: "PENDING is not a confirmed payment" },
    { id: "pending-expense", expected: "pending", reason: "PENDING_APPROVAL; no approved obligation" },
    { id: "duplicate-receipt", sourceId: "petty-cash-expense", expected: "pending", reason: "Same receipt also entered as operating expense" },
    { id: "estimated-payroll", sourceId: "payroll-recognition", expected: "exclude", reason: "Operational estimate is replaced by confirmed payroll" },
    { id: "foreign-company", sourceId: "foreign-company-sale", expected: "deny", reason: "Company A actor cannot read company-foreign" },
    { id: "hidden-branch", sourceId: "platform-sale", expected: "deny", reason: "Branch A manager cannot read branch B" },
    { id: "closed-period", expected: "deny", reason: "Posting to CLOSED month requires authorized reopening" },
    { id: "missing-permission", expected: "deny", reason: "Read permission alone does not allow posting" },
    { id: "cross-midnight", sourceId: "card-sale", expected: "october", occurredAt: "2026-11-01T05:30:00Z", reason: "Mexico City business date October 31" },
    { id: "rule-change", sourceId: "credit-expense", expected: "rules-v2", reason: "Effective October 16; earlier postings preserve rules-v1" },
    { id: "undocumented-tax", expected: "pending", reason: "Missing documented tax must not be inferred for posting" },
  ],
};
