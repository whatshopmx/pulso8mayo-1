import { test, expect } from "@playwright/test";
import {
  ADMIN_EMAIL,
  BRANCH_CONDESA,
  COMPANY_ID,
  GERENTE_EMAIL,
} from "./support/constants";
import {
  cleanupClabeVerificationFixture,
  findPaymentRunItems,
  findUserIdByEmail,
  seedMatchedInvoice,
  seedPaymentRun,
  seedTestSupplier,
} from "./support/db";
import {
  getVerifiedBankAccountForPayment,
  registerSupplierBankAccount,
  rejectSupplierBankAccount,
  verifySupplierBankAccount,
} from "../lib/services/supplier-bank-account-service";
import { TreasuryService } from "../lib/services/treasury-service";
import { computeClabeCheckDigit } from "../lib/banking/clabe";

/**
 * F1.3 — el desbloqueo de tesorería, probado por su consecuencia.
 *
 * El valor de la fase no es "se puede verificar una cuenta", es "se le puede
 * pagar a un proveedor". Antes de F1 el único lugar del repo que escribía
 * `status = VERIFIED` era el seed, así que en una instalación real
 * `addItemToRun` rechazaba **todas** las facturas: nadie podía cobrar.
 *
 * Nota sobre el alcance de la aserción: el criterio original pedía comprobar
 * también que `getUnpaidMatchedInvoices` no devolviera la factura bloqueada.
 * No es lo que hace el código —esa consulta filtra por `match_status` y
 * `payment_status`, y no mira la cuenta bancaria— y tampoco es lo que debería
 * hacer: esconderle al tesorero una factura legítima porque falta verificar la
 * CLABE le quita justamente el aviso que necesita. El punto donde la regla se
 * impone es `addItemToRun`, y es ahí donde se afirma.
 *
 * No necesita servidor ni Inngest: llama servicios y SQL directamente.
 *   pnpm exec playwright test --no-deps --project=chromium tests/clabe-verificacion.spec.ts
 */

function makeValidClabe(bankPrefix: string, accountSeed: string): string {
  const first17 = `${bankPrefix}${accountSeed}`.padEnd(17, "0").slice(0, 17);
  return `${first17}${computeClabeCheckDigit(first17)}`;
}

const MENSAJE_BLOQUEO = /no tiene una cuenta bancaria CLABE verificada/i;

test.describe("F1 — verificación de CLABE y desbloqueo de tesorería", () => {
  test.beforeEach(async () => {
    await cleanupClabeVerificationFixture();
  });

  test.afterEach(async () => {
    await cleanupClabeVerificationFixture();
  });

  test("una factura solo entra al lote de pago cuando la cuenta está verificada", async () => {
    const capturista = await findUserIdByEmail(GERENTE_EMAIL);
    const verificador = await findUserIdByEmail(ADMIN_EMAIL);
    expect(capturista).not.toBe(verificador);

    const supplierId = await seedTestSupplier(COMPANY_ID, "Proveedor CLABE pendiente");
    const invoiceId = await seedMatchedInvoice({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      supplierId,
      totalCents: 250_00,
    });
    const runId = await seedPaymentRun({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      createdBy: verificador,
    });

    // 1. Sin ninguna cuenta: la factura no es pagable.
    await expect(
      TreasuryService.addItemToRun(runId, "INVOICE", invoiceId, 250_00),
    ).rejects.toThrow(MENSAJE_BLOQUEO);

    // 2. Capturada pero sin verificar: sigue sin ser pagable. Capturar no paga.
    const { account } = await registerSupplierBankAccount({
      companyId: COMPANY_ID,
      supplierId,
      clabe: makeValidClabe("012180", "7788990011"),
      accountHolderName: "Proveedor CLABE Pendiente SA de CV",
      registeredBy: capturista,
    });
    expect(account.status).toBe("PENDING_VERIFICATION");

    await expect(
      TreasuryService.addItemToRun(runId, "INVOICE", invoiceId, 250_00),
    ).rejects.toThrow(MENSAJE_BLOQUEO);

    // 3. Quien capturó no puede verificar su propia captura.
    await expect(
      verifySupplierBankAccount({
        companyId: COMPANY_ID,
        accountId: account.id,
        verifiedBy: capturista,
        holderNameFromCep: "Proveedor CLABE Pendiente SA de CV",
        evidenceUrl: "local://cep/e2e.pdf",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    // 4. Sin CEP tampoco se verifica: la evidencia no es opcional.
    await expect(
      verifySupplierBankAccount({
        companyId: COMPANY_ID,
        accountId: account.id,
        verifiedBy: verificador,
        holderNameFromCep: "Proveedor CLABE Pendiente SA de CV",
        evidenceUrl: "",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    // 5. Otra persona, con CEP: queda verificada y trazada.
    const verificada = await verifySupplierBankAccount({
      companyId: COMPANY_ID,
      accountId: account.id,
      verifiedBy: verificador,
      holderNameFromCep: "PROVEEDOR CLABE PENDIENTE SA DE CV",
      evidenceUrl: "companies/e2e/clabe-verification-cep/cep.pdf",
    });
    expect(verificada.account.status).toBe("VERIFIED");
    expect(verificada.account.verifiedBy).toBe(verificador);
    expect(verificada.account.verificationMethod).toBe("MANUAL_CEP");
    expect(verificada.account.verificationEvidenceUrl).toBeTruthy();
    // La respuesta del servicio no puede llevar la CLABE en claro.
    expect(verificada.account).not.toHaveProperty("clabe");

    // 6. Ahora sí: la factura entra al lote.
    await TreasuryService.addItemToRun(runId, "INVOICE", invoiceId, 250_00);
    const items = await findPaymentRunItems(runId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      itemType: "INVOICE",
      referenceId: invoiceId,
      amountCents: 250_00,
    });
  });

  test("una cuenta rechazada no paga, igual que una pendiente", async () => {
    const capturista = await findUserIdByEmail(GERENTE_EMAIL);
    const verificador = await findUserIdByEmail(ADMIN_EMAIL);

    const supplierId = await seedTestSupplier(COMPANY_ID, "Proveedor CLABE rechazada");
    const invoiceId = await seedMatchedInvoice({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      supplierId,
      totalCents: 500_00,
    });
    const runId = await seedPaymentRun({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      createdBy: verificador,
    });

    const { account } = await registerSupplierBankAccount({
      companyId: COMPANY_ID,
      supplierId,
      clabe: makeValidClabe("072180", "1122334455"),
      accountHolderName: "Proveedor CLABE Rechazada SA de CV",
      registeredBy: capturista,
    });

    await rejectSupplierBankAccount({
      companyId: COMPANY_ID,
      accountId: account.id,
      rejectedBy: verificador,
      reason: "[E2E] el CEP trae otro titular",
    });

    // Rechazada y dada de baja: no paga...
    await expect(
      TreasuryService.addItemToRun(runId, "INVOICE", invoiceId, 500_00),
    ).rejects.toThrow(MENSAJE_BLOQUEO);

    // ...y tampoco se puede resucitar verificándola.
    await expect(
      verifySupplierBankAccount({
        companyId: COMPANY_ID,
        accountId: account.id,
        verifiedBy: verificador,
        holderNameFromCep: "Proveedor CLABE Rechazada SA de CV",
        evidenceUrl: "local://cep/e2e.pdf",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(await findPaymentRunItems(runId)).toHaveLength(0);
  });

  test("verificar una cuenta nueva desplaza a la vigente sin dejar hueco", async () => {
    const capturista = await findUserIdByEmail(GERENTE_EMAIL);
    const verificador = await findUserIdByEmail(ADMIN_EMAIL);

    const supplierId = await seedTestSupplier(COMPANY_ID, "Proveedor CLABE cambio");

    const primera = await registerSupplierBankAccount({
      companyId: COMPANY_ID,
      supplierId,
      clabe: makeValidClabe("014180", "5566778899"),
      accountHolderName: "Proveedor CLABE Cambio SA de CV",
      registeredBy: capturista,
    });
    await verifySupplierBankAccount({
      companyId: COMPANY_ID,
      accountId: primera.account.id,
      verifiedBy: verificador,
      holderNameFromCep: "Proveedor CLABE Cambio SA de CV",
      evidenceUrl: "local://cep/primera.pdf",
    });

    // Capturar la segunda no desplaza a la primera: eso es lo que impide que
    // quien solo logra capturar redirija un pago.
    const segunda = await registerSupplierBankAccount({
      companyId: COMPANY_ID,
      supplierId,
      clabe: makeValidClabe("002180", "9988776655"),
      accountHolderName: "Proveedor CLABE Cambio SA de CV",
      registeredBy: capturista,
    });
    expect(segunda.isChange).toBe(true);
    expect(segunda.supersedesAccountId).toBe(primera.account.id);

    const cuentaVigente = await getVerifiedBankAccountForPayment({
      companyId: COMPANY_ID,
      supplierId,
    });
    expect(cuentaVigente?.accountId).toBe(primera.account.id);

    // Verificar la segunda sí desplaza, y en la misma transacción: nunca hay un
    // instante sin cuenta pagable.
    const resultado = await verifySupplierBankAccount({
      companyId: COMPANY_ID,
      accountId: segunda.account.id,
      verifiedBy: verificador,
      holderNameFromCep: "Proveedor CLABE Cambio SA de CV",
      evidenceUrl: "local://cep/segunda.pdf",
    });
    expect(resultado.supersededAccountId).toBe(primera.account.id);

    const nuevaVigente = await getVerifiedBankAccountForPayment({
      companyId: COMPANY_ID,
      supplierId,
    });
    expect(nuevaVigente?.accountId).toBe(segunda.account.id);
  });
});
