import { describe, expect, it } from "vitest";
import { inventoryPlan, movementValue, proratedMovementValue } from "@/lib/services/accounting/inventory-contract";
import { totalsOf } from "@/lib/services/accounting/amounts";

describe("frozen inventory valuation", () => {
  it("values physical quantities with four decimals and exact half-up cents", () => {
    expect(movementValue("-1.2345", 100)).toBe(123);
    expect(movementValue("-0.0050", 100)).toBe(1);
    expect(movementValue("0.0049", 100)).toBe(0);
    expect(movementValue("-2.5000", 6000)).toBe(15000);
  });
  it.each(["0", "-0.0000", "1.00001", "1e-4", "NaN", "100000000.0000"])("rejects invalid movement quantity %s", quantity => {
    expect(() => movementValue(quantity, 100)).toThrow(RangeError);
  });
  it.each([null, -1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("never invents a cost from %s", cost => {
    expect(() => movementValue("-1", cost)).toThrow(RangeError);
  });
  it("rejects unsafe extended values even with individually safe inputs", () => {
    expect(() => movementValue("99999999.9999", Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });
  it("distributes returns by original value without losing a cent across partial returns", () => {
    const original = { quantity: "3.0000", amountCents: 2 };
    const first = proratedMovementValue(original, { quantity: "0", amountCents: 0 }, "1");
    const second = proratedMovementValue(original, { quantity: "1", amountCents: first }, "1");
    const third = proratedMovementValue(original, { quantity: "2", amountCents: first + second }, "1");
    expect([first, second, third]).toEqual([1, 0, 1]);
    expect(first + second + third).toBe(original.amountCents);
  });
  it("retains source value across received stock and transport waste", () => {
    const shipped = { quantity: "1.5000", amountCents: 101 };
    const received = proratedMovementValue(shipped, { quantity: "0", amountCents: 0 }, "1.2500");
    const waste = proratedMovementValue(shipped, { quantity: "1.2500", amountCents: received }, "0.2500");
    expect([received, waste]).toEqual([84, 17]);
    expect(received + waste).toBe(101);
  });
  it("rejects over-return and a prior return amount that does not match the frozen original", () => {
    const source = { quantity: "2", amountCents: 101 };
    expect(() => proratedMovementValue(source, { quantity: "1", amountCents: 51 }, "1.0001")).toThrow(RangeError);
    expect(() => proratedMovementValue(source, { quantity: "1", amountCents: 50 }, "1")).toThrow(RangeError);
  });
  it.each(["USAGE", "USAGE_RETURN", "WASTE", "TRANSFER_OUT", "TRANSFER_IN", "TRANSFER_WASTE"] as const)("balances %s without recognizing another sale", kind => {
    const lines = inventoryPlan(kind, 101);
    expect(totalsOf(lines)).toEqual({ debitCents: 101, creditCents: 101, balanced: true });
    expect(lines.map(line => line.role)).not.toContain("INCOME");
  });
  it("keeps waste separate from normal consumption and clears transit only once", () => {
    expect(inventoryPlan("WASTE", 25).map(line => line.role)).toEqual(["WASTE", "INVENTORY"]);
    expect(inventoryPlan("TRANSFER_WASTE", 25).map(line => line.role)).toEqual(["WASTE", "IN_TRANSIT"]);
    expect(inventoryPlan("TRANSFER_OUT", 25).map(line => line.role)).toEqual(["IN_TRANSIT", "INVENTORY"]);
    expect(inventoryPlan("TRANSFER_IN", 25).map(line => line.role)).toEqual(["INVENTORY", "IN_TRANSIT"]);
    expect(inventoryPlan("USAGE_RETURN", 25).map(line => line.role)).toEqual(["INVENTORY", "COGS"]);
    expect(() => inventoryPlan("USAGE", 0)).toThrow(RangeError);
  });
});
