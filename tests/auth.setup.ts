import { test as setup, expect } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, STORAGE_STATE } from "./support/constants";

/**
 * Inicia sesión una sola vez y guarda las cookies para todos los specs.
 * Depende de los usuarios sembrados por `pnpm seed` + `pnpm seed:pass`.
 */
// El primer golpe al dev server compila /sign-in y la ruta de auth: es lento.
setup.setTimeout(300_000);

setup("autenticar como admin", async ({ page }) => {
  await page.goto("/sign-in");

  await page.locator("#email").fill(ADMIN_EMAIL);
  await page.locator("#password").fill(ADMIN_PASSWORD);

  // El sign-in falla con `alert()`; convertirlo en error legible del test.
  page.on("dialog", async (dialog) => {
    await dialog.dismiss();
    throw new Error(`Sign-in rechazado: ${dialog.message()}`);
  });

  await page.getByRole("button", { name: /iniciar|sign in|entrar/i }).click();

  await page.waitForURL(/\/dashboard/, { timeout: 180_000 });
  await expect(page).toHaveURL(/\/dashboard/);

  await page.context().storageState({ path: STORAGE_STATE });
});
