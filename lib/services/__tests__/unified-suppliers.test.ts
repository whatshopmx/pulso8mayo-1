import { describe, expect, it } from "vitest";
import {
  paymentConditionsLabel,
  paymentMethodLabel,
  paymentTermsLabel,
  SUPPLIER_PAYMENT_METHODS,
} from "@/lib/inventory/supplier-payment";
import { bucketFor } from "../accounts-payable-types";

describe("Unified Suppliers & Payees - Payment Conditions Utilities", () => {
  it("formatos correctos de condiciones de pago", () => {
    expect(paymentTermsLabel(0)).toBe("Contado");
    expect(paymentTermsLabel(30)).toBe("Crédito 30 días");
    expect(paymentTermsLabel(null)).toBe("Contado");
  });

  it("formatos correctos de forma de pago", () => {
    expect(paymentMethodLabel("TRANSFER")).toBe("Transferencia electrónica");
    expect(paymentMethodLabel("CASH")).toBe("Efectivo");
    expect(paymentMethodLabel(null)).toBe("Sin especificar");
  });

  it("etiqueta unificada de condiciones de pago", () => {
    expect(paymentConditionsLabel(30, "TRANSFER")).toBe("Crédito 30 días · Transferencia electrónica");
    expect(paymentConditionsLabel(0, "CASH")).toBe("Contado · Efectivo");
    expect(paymentConditionsLabel(15, null)).toBe("Crédito 15 días");
  });

  it("códigos SAT para catálogo c_FormaPago", () => {
    expect(SUPPLIER_PAYMENT_METHODS.TRANSFER.satCode).toBe("03");
    expect(SUPPLIER_PAYMENT_METHODS.CASH.satCode).toBe("01");
    expect(SUPPLIER_PAYMENT_METHODS.CREDIT_CARD.satCode).toBe("04");
  });
});

describe("Unified Payees - Accounts Payable Aging Buckets", () => {
  it("asigna correctamente partidas al tramo de antigüedad según días hasta vencimiento", () => {
    expect(bucketFor(null)).toBe("NO_DUE_DATE");
    expect(bucketFor(0)).toBe("DUE_7");
    expect(bucketFor(5)).toBe("DUE_7");
    expect(bucketFor(12)).toBe("DUE_15");
    expect(bucketFor(25)).toBe("DUE_30");
    expect(bucketFor(45)).toBe("DUE_LATER");
  });

  it("asigna vencidos (días negativos) a OVERDUE", () => {
    expect(bucketFor(-1)).toBe("OVERDUE");
    expect(bucketFor(-30)).toBe("OVERDUE");
    expect(bucketFor(-100)).toBe("OVERDUE");
  });
});
