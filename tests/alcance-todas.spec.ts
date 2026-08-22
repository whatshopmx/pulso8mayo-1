import { test, expect, type Browser, type BrowserContext } from "@playwright/test";

import { ADMIN_PASSWORD, GERENTE_EMAIL } from "./support/constants";

/**
 * B7 — El alcance "Todas" **fuera** de Finanzas.
 *
 * `lib/branch-context.tsx` lo leen 25 módulos y los specs de la auditoría de
 * Finanzas y Ventas sólo miran su propio módulo. Este spec ejerce el alcance en
 * pantallas de otros dominios, que es donde una regresión del contexto saldría
 * sin que nadie la viera.
 *
 * Los tres primeros casos **fallan contra el código anterior a B4**: elegir
 * "Todas" borraba `pulso_selected_branch` y ya, así que al recargar esa ausencia
 * era indistinguible de "el usuario nunca eligió" y `setBranches` reponía la
 * primera sucursal de la lista. El cuarto falla contra el anterior a B6.
 *
 * Se corre con el build, no con `next dev`:
 *   pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" \
 *     pnpm exec playwright test --project=chromium tests/alcance-todas.spec.ts
 */

/** Pantallas de dominios distintos a Finanzas que montan el control de alcance. */
const PANTALLAS_FUERA_DE_FINANZAS = [
  { ruta: "/dashboard/inventory", nombre: "Inventario" },
  { ruta: "/dashboard/operations", nombre: "Operaciones" },
  { ruta: "/dashboard/compliance", nombre: "Cumplimiento" },
];

const control = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^Sucursal:/ });

/**
 * Fija una sucursal concreta y **después** elige "Todas", con las manos del
 * usuario.
 *
 * Los dos pasos importan. Con AD-B7 un ADMIN ya abre en "Todas", así que pulsar
 * "Todas" de entrada sería un no-op sobre el estado que ya está: el caso pasaría
 * sin haber probado nada. Pasando primero por una sucursal concreta se escribe
 * `pulso_selected_branch`, y entonces elegir "Todas" tiene que **borrarla** y
 * dejar `pulso_branch_scope=all` en su lugar. Eso es lo que el recargado pone a
 * prueba, y es más de lo que probaría el default por sí solo.
 */
async function elegirTodas(page: import("@playwright/test").Page) {
  await expect(control(page)).toBeVisible({ timeout: 15_000 });

  await control(page).click();
  await page.getByRole("menuitem").nth(1).click(); // 0 es "Todas"
  await expect(control(page)).not.toContainText(/Todas/, { timeout: 15_000 });

  await control(page).click();
  await page.getByRole("menuitem", { name: "Todas" }).click();
  await expect(control(page)).toContainText(/Todas/);
}

test.describe("B7 · el alcance «Todas» sobrevive fuera de Finanzas", () => {
  for (const { ruta, nombre } of PANTALLAS_FUERA_DE_FINANZAS) {
    test(`en ${nombre} sigue en «Todas» después de recargar`, async ({ page }) => {
      await page.goto(ruta);
      await elegirTodas(page);

      await page.reload();

      // El caso entero está aquí: antes de B4, recargar reponía `branches[0]`
      // y el usuario volvía a una sucursal sola sin que nada se lo dijera.
      await expect(control(page)).toContainText(/Todas/, { timeout: 15_000 });
    });
  }

  test("«Todas» viaja entre secciones sin volver a una sucursal", async ({ page }) => {
    await page.goto(PANTALLAS_FUERA_DE_FINANZAS[0].ruta);
    await elegirTodas(page);

    for (const { ruta, nombre } of PANTALLAS_FUERA_DE_FINANZAS.slice(1)) {
      await page.goto(ruta);
      await expect(control(page), `${nombre} perdió el alcance`).toContainText(/Todas/, {
        timeout: 15_000,
      });
    }
  });

  test("un ADMIN sin cookies abre en «Todas», no en la primera sucursal", async ({ browser }) => {
    // AD-B7: para un rol no fijado a sucursal, la ausencia de elección significa
    // "todas" — lo que `lib/branch-scope.ts:82` ya aplica del lado del servidor.
    // Elegir `branches[0]` era el cliente inventando una sucursal.
    const contexto = await browser.newContext({
      storageState: "tests/.auth/admin.json",
    });
    // Se borran sólo las cookies de alcance; la sesión tiene que sobrevivir.
    const cookies = await contexto.cookies();
    await contexto.clearCookies();
    await contexto.addCookies(
      cookies.filter(
        (c) => c.name !== "pulso_selected_branch" && c.name !== "pulso_branch_scope"
      )
    );

    const page = await contexto.newPage();
    try {
      await page.goto("/dashboard/inventory");
      await expect(control(page)).toContainText(/Todas/, { timeout: 15_000 });
    } finally {
      await contexto.close();
    }
  });
});

test.describe("B6 · un rol fijado a sucursal no recibe un menú que no hace nada", () => {
  let sesionGerente: Awaited<ReturnType<BrowserContext["storageState"]>>;

  // Una sola sesión para todo el describe: better-auth limita `/sign-in/email`
  // a 3 intentos cada 10 s, y ese límite sólo se activa con `npm run start`,
  // que es justo como se verifica esto. Ver `ventas-rbac.spec.ts:33`.
  test.beforeAll(async ({ browser }) => {
    const contexto = await browser.newContext({ storageState: undefined });
    try {
      let login = await contexto.request.post("/api/auth/sign-in/email", {
        data: { email: GERENTE_EMAIL, password: ADMIN_PASSWORD },
      });
      for (let intento = 0; intento < 3 && login.status() === 429; intento++) {
        await new Promise((r) => setTimeout(r, 11_000));
        login = await contexto.request.post("/api/auth/sign-in/email", {
          data: { email: GERENTE_EMAIL, password: ADMIN_PASSWORD },
        });
      }
      expect(
        login.ok(),
        `no se pudo iniciar sesión como ${GERENTE_EMAIL} (HTTP ${login.status()})`
      ).toBe(true);
      sesionGerente = await contexto.storageState();
    } finally {
      await contexto.close();
    }
  });

  async function paginaDeGerente(browser: Browser) {
    const contexto = await browser.newContext({ storageState: sesionGerente });
    return { contexto, page: await contexto.newPage() };
  }

  test("ve su sucursal como rótulo y no como desplegable", async ({ browser }) => {
    const { contexto, page } = await paginaDeGerente(browser);
    try {
      await page.goto("/dashboard/inventory");

      // El rótulo dice la sucursal…
      await expect(page.getByText(/^Sucursal: /)).toBeVisible({ timeout: 15_000 });

      // …y no hay botón que abra un menú de sucursales. Antes de B6 el control
      // ofrecía "Todas" a un rol al que `lib/branch-scope.ts:85` le impone la
      // suya: la pantalla prometía una elección que el servidor descartaba.
      await expect(control(page)).toHaveCount(0);
    } finally {
      await contexto.close();
    }
  });

  test("no se le ofrece «Todas» por ningún lado", async ({ browser }) => {
    const { contexto, page } = await paginaDeGerente(browser);
    try {
      await page.goto("/dashboard/inventory");
      await expect(page.getByText(/^Sucursal: /)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("menuitem", { name: "Todas" })).toHaveCount(0);
    } finally {
      await contexto.close();
    }
  });
});
