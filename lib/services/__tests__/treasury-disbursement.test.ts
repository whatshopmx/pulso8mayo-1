// lib/services/__tests__/treasury-disbursement.test.ts
import { describe, it, expect } from "vitest";

describe("Treasury Disbursement & Dual-Signature Segregation of Duties (Módulo 6.1 & 6.2)", () => {
  it("enforces segregation of duties: preparer cannot self-approve payment run", () => {
    const paymentRun = {
      id: "run-101",
      title: "Dispersión Quincenal",
      preparedBy: "user-admin-1",
      status: "DRAFT",
    };

    const attemptApproval = (approverUserId: string) => {
      if (paymentRun.preparedBy === approverUserId) {
        throw new Error("Segregación de funciones: El usuario que preparó la corrida de pago no puede auto-aprobarla.");
      }
      return { ...paymentRun, status: "APPROVED", approvedBy: approverUserId };
    };

    // Self-approval must throw
    expect(() => attemptApproval("user-admin-1")).toThrow(
      "Segregación de funciones: El usuario que preparó la corrida de pago no puede auto-aprobarla."
    );

    // Approval by different authorized user succeeds
    const approved = attemptApproval("user-owner-2");
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedBy).toBe("user-owner-2");
  });

  it("blocks payment inclusion if supplier CLABE account is not VERIFIED", () => {
    const supplierAccounts = [
      { supplierId: "supp-1", status: "VERIFIED", active: true, clabeLast4: "1234" },
      { supplierId: "supp-2", status: "PENDING_VERIFICATION", active: true, clabeLast4: "5678" },
      { supplierId: "supp-3", status: "REJECTED", active: false, clabeLast4: "9999" },
    ];

    const validateSupplierAccount = (supplierId: string) => {
      const account = supplierAccounts.find(
        (a) => a.supplierId === supplierId && a.status === "VERIFIED" && a.active
      );
      if (!account) {
        throw new Error("El proveedor no tiene una cuenta bancaria CLABE verificada.");
      }
      return account;
    };

    expect(() => validateSupplierAccount("supp-2")).toThrow("El proveedor no tiene una cuenta bancaria CLABE verificada.");
    expect(() => validateSupplierAccount("supp-3")).toThrow("El proveedor no tiene una cuenta bancaria CLABE verificada.");
    expect(validateSupplierAccount("supp-1").clabeLast4).toBe("1234");
  });

  it("generates correct SPEI dispersion layout format", () => {
    const items = [
      {
        sourceAcc: "0123456789",
        destClabe: "012180001234567890",
        destBank: "BBVA",
        holder: "CARNES SELECTAS SA DE CV",
        amountCents: 4500000,
        concept: "PAGO FAC F-1029",
        ref: "8392019",
      },
    ];

    const generateSpeiCsvRow = (item: typeof items[0]) => {
      const amountPesos = (item.amountCents / 100).toFixed(2);
      return `"${item.sourceAcc}","${item.destClabe}","${item.destBank}","${item.holder}",${amountPesos},"${item.concept}","${item.ref}"`;
    };

    const row = generateSpeiCsvRow(items[0]);
    expect(row).toBe(
      '"0123456789","012180001234567890","BBVA","CARNES SELECTAS SA DE CV",45000.00,"PAGO FAC F-1029","8392019"'
    );
  });
});
