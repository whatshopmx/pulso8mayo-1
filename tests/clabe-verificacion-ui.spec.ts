import { test, expect } from "@playwright/test";
import { ADMIN_EMAIL, BRANCH_CONDESA, COMPANY_ID, GERENTE_EMAIL } from "./support/constants";
import {
  cleanupClabeVerificationFixture,
  findUserIdByEmail,
  seedTestSupplier,
} from "./support/db";
import { registerSupplierBankAccount } from "../lib/services/supplier-bank-account-service";
import { computeClabeCheckDigit } from "../lib/banking/clabe";

/**
 * F1.2 — lo que la pantalla tiene que decir antes de dejar verificar.
 *
 * Complementa a `clabe-verificacion.spec.ts`, que prueba la regla en el
 * servicio. Aquí se afirma lo que solo existe en la UI y que el servicio no
 * puede cubrir: que quien capturó la cuenta vea el botón **deshabilitado con el
 * motivo** —enterarse de la segregación de funciones después de conseguir el
 * CEP y llenar el formulario es la peor forma de aprender la regla— y que los
 * dos nombres del titular se vean juntos antes de que haya nada que confirmar.
 *
 * Necesita el servidor (no Inngest). Contra un build es mucho más rápido:
 *   pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" \
 *     pnpm exec playwright test tests/clabe-verificacion-ui.spec.ts
 */

function makeValidClabe(prefix: string, seed: string): string {
  const first17 = `${prefix}${seed}`.padEnd(17, "0").slice(0, 17);
  return `${first17}${computeClabeCheckDigit(first17)}`;
}

test("F1.2 — la pantalla ofrece verificar y explica cuándo no se puede", async ({ page }) => {
  await cleanupClabeVerificationFixture();

  const gerente = await findUserIdByEmail(GERENTE_EMAIL);
  const admin = await findUserIdByEmail(ADMIN_EMAIL);

  const otroCapturista = await seedTestSupplier(COMPANY_ID, "Capturada por otro");
  await registerSupplierBankAccount({
    companyId: COMPANY_ID,
    supplierId: otroCapturista,
    clabe: makeValidClabe("012180", "3344556677"),
    accountHolderName: "Capturada Por Otro SA de CV",
    registeredBy: gerente,
  });

  const propia = await seedTestSupplier(COMPANY_ID, "Capturada por mi");
  await registerSupplierBankAccount({
    companyId: COMPANY_ID,
    supplierId: propia,
    clabe: makeValidClabe("072180", "4455667788"),
    accountHolderName: "Capturada Por Mi SA de CV",
    registeredBy: admin,
  });

  await page.goto("/dashboard/finance/supplier-bank-accounts");
  await page.waitForLoadState("networkidle");

  const filaOtro = page.getByRole("row", { name: /Capturada por otro/ });
  const filaPropia = page.getByRole("row", { name: /Capturada por mi/ });

  const botonHabilitado = filaOtro.getByRole("button", { name: /Verificar titularidad/ });
  const botonDeshabilitado = filaPropia.getByRole("button", { name: /Verificar titularidad/ });

  await expect(botonHabilitado).toBeEnabled();
  await expect(botonDeshabilitado).toBeDisabled();
  await expect(filaPropia).toContainText("Tú capturaste esta cuenta");

  await botonHabilitado.click();
  const dialogo = page.getByRole("dialog");
  // El procedimiento, no solo el formulario: nadie debería tener que adivinar
  // qué es un CEP ni de dónde se baja.
  await expect(dialogo).toContainText("cep.banxico.org.mx");
  // Sin CEP cargado no hay nada que confirmar.
  await expect(dialogo.getByRole("button", { name: /^Verificar titularidad$/ })).toBeDisabled();

  // "SA" contra "SAPI" es el ataque que este paso existe para detener: se
  // parecen lo bastante como para que un fuzzy match los apruebe.
  await dialogo.getByLabel("Titular según el CEP").fill("Capturada Por Otro SAPI de CV");
  await expect(dialogo).toContainText("Se parecen, pero no son iguales");
  await expect(dialogo).toContainText("Capturada Por Otro SA de CV");

  await cleanupClabeVerificationFixture();
});
