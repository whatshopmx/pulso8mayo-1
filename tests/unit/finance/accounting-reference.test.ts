import { describe, expect, it } from "vitest";
import { month } from "../../fixtures/accounting/month";

// Oracle checks only: these tests do not exercise a production accounting engine.
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const october = () => month.journals.filter(j => j.companyId === "company-a" && j.date >= month.period.start && j.date <= month.period.end);
const balances = () => {
  const result: Record<string, number> = {};
  for (const journal of october()) for (const line of journal.lines) {
    result[line.account] = (result[line.account] ?? 0) + line.debit - line.credit;
  }
  return result;
};

describe("FC-02 synthetic reference month", () => {
  it("has two branches and a foreign company, with no live data", () => {
    expect(month.branches).toEqual([
      { id: "branch-a", companyId: "company-a" },
      { id: "branch-b", companyId: "company-a" },
      { id: "branch-foreign", companyId: "company-foreign" },
    ]);
    expect(month.journals.some(j => j.companyId === "company-foreign")).toBe(true);
  });

  it("balances every journal in safe integer cents", () => {
    for (const journal of month.journals) {
      expect(sum(journal.lines.map(l => l.debit)), journal.id).toBe(sum(journal.lines.map(l => l.credit)));
      for (const line of journal.lines) {
        expect(Number.isSafeInteger(line.debit) && Number.isSafeInteger(line.credit)).toBe(true);
        expect(line.debit >= 0 && line.credit >= 0).toBe(true);
        expect((line.debit > 0) !== (line.credit > 0)).toBe(true);
        expect(month.branches.find(b => b.id === line.branchId)?.companyId).toBe(journal.companyId);
      }
    }
  });

  it("reproduces independently specified closing balances and trial totals", () => {
    expect(balances()).toEqual(month.expected.closingBalances);
    expect(sum(Object.values(balances()).filter(v => v > 0))).toBe(2_776_400);
    expect(-sum(Object.values(balances()).filter(v => v < 0))).toBe(2_776_400);
    expect(sum(october().flatMap(j => j.lines.map(l => l.debit)))).toBe(month.expected.totalDebits);
    expect(sum(october().flatMap(j => j.lines.map(l => l.credit)))).toBe(month.expected.totalCredits);
  });

  it("explains assets, liabilities, equity and profit without a balancing plug", () => {
    const b = balances();
    const assets = b.bank + b.cash + b.pettyCash + b.inventory + b.receivable + b.inputVat + b.equipment;
    const liabilities = -(b.payable + b.outputVat + b.tipsPayable + b.payrollPayable + b.deductionsPayable + b.loan);
    const expenses = b.foodCost + b.waste + b.labor + b.expense + b.commission;
    const profit = -b.revenue - expenses;
    expect({ assets, liabilities, profit, equity: -b.equity }).toEqual(month.expected.statements);
    expect(assets).toBe(liabilities - b.equity + profit);
  });

  it("explains cash movement and excludes both legs of own transfers", () => {
    const cashAccounts = new Set(["bank", "cash", "pettyCash"]);
    const flow = { opening: 0, operating: 0, investing: 0, financing: 0, internal: 0 };
    for (const j of october()) {
      flow[j.flow] += sum(j.lines.filter(l => cashAccounts.has(l.account)).map(l => l.debit - l.credit));
    }
    expect(flow).toEqual(month.expected.cashFlow);
    const b = balances();
    expect(b.bank + b.cash + b.pettyCash).toBe(sum(Object.values(flow)));
  });

  it("keeps receipt/invoice, partial payments and next-month settlement distinct", () => {
    const b = balances();
    expect(b.receivingPending).toBe(0);
    expect(b.payable).toBe(-229_800); // opening 150000 + receipt 60000 + expense 34800 - payments 15000
    expect(b.receivable).toBe(232_000); // October card sale settles in November
    const sale = month.journals.find(j => j.id === "card-sale")!;
    expect(sale.date).toBe("2026-10-31");
    expect(month.sourceCases.find(c => c.id === "cross-midnight")?.occurredAt).toBe("2026-11-01T05:30:00Z");
    expect(month.journals.find(j => j.id === "card-settlement")?.date).toBe("2026-11-02");
  });

  it("includes version changes and all required exclusion and denial examples", () => {
    expect(month.ruleVersions.map(r => r.effectiveFrom)).toEqual(["2026-10-01", "2026-10-16"]);
    expect(month.sourceCases.map(c => c.id)).toEqual(expect.arrayContaining([
      "duplicate-cut", "recipe-overlap", "duplicate-bank-import", "failed-payment", "unconfirmed-payment",
      "pending-expense", "duplicate-receipt", "estimated-payroll", "foreign-company", "hidden-branch",
      "closed-period", "missing-permission", "cross-midnight", "rule-change", "undocumented-tax",
    ]));
    for (const example of month.sourceCases.filter(c => c.expected === "deny" || c.expected === "pending")) {
      expect(month.journals.some(j => j.id === example.id)).toBe(false);
    }
  });

  it("links documents without inventing another acquisition or settlement", () => {
    const documents = new Map(month.documents.map(d => [d.id, d]));
    for (const document of month.documents) {
      const journal = month.journals.find(j => j.id === document.journalId)!;
      expect(journal, document.id).toBeDefined();
      const rule = month.ruleVersions.filter(r => r.effectiveFrom <= journal.date).at(-1)!;
      expect(document.ruleVersion).toBe(rule.id);
      if (document.relatesTo) expect(documents.has(document.relatesTo)).toBe(true);
    }
    expect(documents.get("supplier-invoice")?.relatesTo).toBe("receiving-report");
    expect(documents.get("payment-1")?.relatesTo).toBe("approved-expense");
    expect(documents.get("payment-2")?.relatesTo).toBe("approved-expense");
    expect(documents.get("bank-match")?.journalId).toBe(documents.get("gateway-deposit")?.journalId);
  });

  it("preserves opening balances and value of inventory and own cash transfers", () => {
    const opening = october().filter(j => j.flow === "opening");
    expect(sum(opening.flatMap(j => j.lines.map(l => l.debit)))).toBe(1_980_000);
    for (const id of ["inventory-transfer", "own-bank-transfer", "petty-cash-replenishment"]) {
      const journal = month.journals.find(j => j.id === id)!;
      expect(journal.flow).toBe("internal");
      expect(journal.lines.every(l => ["inventory", "bank", "pettyCash"].includes(l.account))).toBe(true);
      expect(sum(journal.lines.map(l => l.debit - l.credit))).toBe(0);
    }
  });
});
