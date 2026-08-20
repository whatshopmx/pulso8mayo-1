import { test, expect, type Browser } from "@playwright/test";
import {
  COMPANY_ID,
  BRANCH_CONDESA,
  BRANCH_POLANCO,
  ADMIN_PASSWORD,
  GERENTE_EMAIL,
  GERENTE_BRANCH,
} from "./support/constants";
import {
  seedIncidentWithRemediationAction,
  cleanupIncidentRemediation,
} from "./support/db";

/**
 * Alcance por sucursal en el circuito de incidentes.
 *
 * `findIncidentForTenant` filtraba solo por tenant, así que un GERENTE fijado a
 * Condesa leía, editaba, remediaba y escalaba incidentes de **cualquier**
 * sucursal de su empresa. La lista, además, tomaba la sucursal de una cookie sin
 * mirar el rol: bastaba cambiar de sucursal para verla.
 *
 * El control positivo (ADMIN sigue alcanzando todo) es tan importante como el
 * negativo: un fail-closed que también cierra para quien sí tiene permiso es una
 * regresión, no un arreglo.
 *
 * Corre serial contra la base de dev como el resto de specs; siembra por SQL
 * directo con el tag `[E2E]` y limpia en `afterAll`.
 */

const COOKIE_SUCURSAL = "pulso_selected_branch";

/**
 * Abre un contexto con la sesión de otro rol. El `storageState: undefined` es lo
 * que descarta las cookies de admin que `auth.setup.ts` dejó para todos los
 * specs — sin eso la petición se haría como SUPER_ADMIN y el test pasaría por la
 * razón equivocada. Mismo patrón que `gastos-autorizaciones.spec.ts:49`.
 */
async function sesionDe(browser: Browser, email: string) {
  const contexto = await browser.newContext({ storageState: undefined });
  const login = await contexto.request.post("/api/auth/sign-in/email", {
    data: { email, password: ADMIN_PASSWORD },
  });
  expect(login.ok(), `no se pudo iniciar sesión como ${email}`).toBe(true);
  return contexto;
}

test.describe.configure({ mode: "serial" });

test.describe("Alcance por sucursal en incidentes", () => {
  /** Incidente sembrado en Polanco: la sucursal ajena al GERENTE de Condesa. */
  let incidentePolanco: string;
  /** Incidente sembrado en Condesa: la propia, control de que no cerramos de más. */
  let incidenteCondesa: string;

  test.beforeAll(async () => {
    // Por si una corrida anterior murió a medias: el spec tiene que poder
    // correrse dos veces seguidas sin limpiar a mano.
    await cleanupIncidentRemediation();

    const polanco = await seedIncidentWithRemediationAction({
      companyId: COMPANY_ID,
      branchId: BRANCH_POLANCO,
    });
    incidentePolanco = polanco.incidentId;

    const condesa = await seedIncidentWithRemediationAction({
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
    });
    incidenteCondesa = condesa.incidentId;

    expect(GERENTE_BRANCH).toBe(BRANCH_CONDESA);
  });

  test.afterAll(async () => {
    await cleanupIncidentRemediation();
  });

  test("el GERENTE no alcanza un incidente de otra sucursal por ninguna de sus rutas", async ({
    browser,
  }) => {
    const contexto = await sesionDe(browser, GERENTE_EMAIL);

    // Las cuatro superficies que comparten `findIncidentForTenant`. El 404 tiene
    // que ser indistinguible del de un id inexistente: un 403 confirmaría que el
    // incidente existe.
    const detalle = await contexto.request.get(`/api/incidents/${incidentePolanco}`);
    expect(detalle.status(), "detalle de un incidente ajeno").toBe(404);

    const acciones = await contexto.request.get(
      `/api/incidents/${incidentePolanco}/actions`
    );
    expect(acciones.status(), "acciones de un incidente ajeno").toBe(404);

    const remediar = await contexto.request.post(
      `/api/incidents/${incidentePolanco}/remediate`,
      { data: {} }
    );
    expect(remediar.status(), "remediar un incidente ajeno").toBe(404);

    const escalar = await contexto.request.post(
      `/api/incidents/${incidentePolanco}/escalate`,
      { data: {} }
    );
    expect(escalar.status(), "escalar un incidente ajeno").toBe(404);

    await contexto.close();
  });

  test("el GERENTE sí alcanza el incidente de su propia sucursal", async ({ browser }) => {
    // Control positivo: si esto falla, el fail-closed cerró de más.
    const contexto = await sesionDe(browser, GERENTE_EMAIL);

    const detalle = await contexto.request.get(`/api/incidents/${incidenteCondesa}`);
    expect(detalle.status(), "detalle de un incidente propio").toBe(200);

    const acciones = await contexto.request.get(
      `/api/incidents/${incidenteCondesa}/actions`
    );
    expect(acciones.status(), "acciones de un incidente propio").toBe(200);

    await contexto.close();
  });

  test("la lista no muestra otra sucursal aunque la cookie apunte allí", async ({
    browser,
  }) => {
    const contexto = await sesionDe(browser, GERENTE_EMAIL);

    // La cookie es justo el vector: antes la página la aplicaba tal cual.
    await contexto.addCookies([
      {
        name: COOKIE_SUCURSAL,
        value: BRANCH_POLANCO,
        url: "http://localhost:3000",
      },
    ]);

    const page = await contexto.newPage();
    await page.goto("/dashboard/incidents");

    // El incidente de Polanco no debe aparecer por id en el HTML de la lista.
    await expect(page.locator("body")).not.toContainText(incidentePolanco);

    await page.close();
    await contexto.close();
  });

  test("ADMIN conserva el acceso a las dos sucursales", async ({ request }) => {
    // Usa el storageState compartido (SUPER_ADMIN): el control de que ningún rol
    // de grupo perdió alcance con este trabajo.
    const polanco = await request.get(`/api/incidents/${incidentePolanco}`);
    expect(polanco.status(), "ADMIN sobre Polanco").toBe(200);

    const condesa = await request.get(`/api/incidents/${incidenteCondesa}`);
    expect(condesa.status(), "ADMIN sobre Condesa").toBe(200);
  });
});
