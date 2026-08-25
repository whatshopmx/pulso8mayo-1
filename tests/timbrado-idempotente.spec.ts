import { test, expect } from "@playwright/test";
import { COMPANY_ID, USER_SUPER_ADMIN } from "./support/constants";
import {
  countTimbrados,
  deleteTestTimbrados,
  findTimbrado,
  seedTimbrado,
} from "./support/db";
import {
  construirPayloadNomina,
  timbrarNomina,
} from "../lib/services/fiscal-service";

/**
 * Auditoría A6b — un folio fiscal no se pide dos veces por descuido.
 *
 * `timbrarNomina` llamaba al PAC y devolvía el resultado sin escribir nada. Dos
 * consecuencias, las dos caras:
 *
 * 1. El comprobante vivía en el estado de React de la pantalla fiscal, así que
 *    **recargar lo borraba**: el folio existía ante el SAT y en Pulso no quedaba
 *    rastro de que se hubiera timbrado.
 * 2. La única guarda contra timbrar dos veces era ese mismo estado de cliente,
 *    de modo que reintentar consumía **otro folio** por el mismo empleado y
 *    período. Los folios se compran.
 *
 * Además, el `status` se afirmaba: la función devolvía `"TIMBRADO"` fijo sin
 * mirar la respuesta, así que un rechazo del SAT se guardaba y se pintaba igual
 * que un comprobante válido.
 *
 * Este spec no toca el servidor ni el PAC real: sustituye `globalThis.fetch` y
 * **cuenta las llamadas salientes**, que es la única forma de probar que el
 * segundo intento no gastó folio.
 *
 *   pnpm exec playwright test --no-deps --project=chromium tests/timbrado-idempotente.spec.ts
 */

/** RFC de prueba. El prefijo `E2E` es lo que limpia `deleteTestTimbrados`. */
const RFC = "E2E010101AAA";
const PERIODO = "2026-99";

const fetchReal = globalThis.fetch;
let llamadasAlPac = 0;

/** Respuesta del PAC, controlada por cada caso. */
let respuestaPac: { ok: boolean; body: unknown; status?: number };

function montarPacFalso() {
  llamadasAlPac = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    // Sólo se intercepta el PAC; cualquier otra petición sigue su curso.
    if (String(url).includes("/api/v4/invoices")) {
      llamadasAlPac++;
      return {
        ok: respuestaPac.ok,
        status: respuestaPac.status ?? (respuestaPac.ok ? 200 : 400),
        json: async () => respuestaPac.body,
        text: async () => JSON.stringify(respuestaPac.body),
      } as any;
    }
    return fetchReal(url, init);
  }) as any;
}

const entrada = {
  companyId: COMPANY_ID,
  empleadoRfc: RFC,
  empleadoNombre: "[E2E] Empleada de Prueba",
  periodo: PERIODO,
  totalPercepciones: 1_500_000,
  totalDeducciones: 200_000,
  performedBy: USER_SUPER_ADMIN,
};

test.describe("A6b · el timbrado se persiste y no se repite", () => {
  test.beforeAll(() => {
    // `getConfig()` lee el entorno en cada llamada: sin llave, el servicio
    // aborta antes de intentar nada y el spec no probaría el camino real.
    process.env.FISCALAPI_API_KEY = "e2e-fake-key";
  });

  test.afterAll(() => {
    globalThis.fetch = fetchReal;
    delete process.env.FISCALAPI_API_KEY;
  });

  test.beforeEach(async () => {
    await deleteTestTimbrados();
    montarPacFalso();
    respuestaPac = {
      ok: true,
      // Envoltura ApiResponse real de FiscalAPI v4 (POST /invoices).
      body: {
        succeeded: true,
        data: {
          id: "factura-e2e-1",
          uuid: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
          total: 13_000,
          seal: "SELLO-E2E",
          fechaTimbrado: "2026-08-21T12:00:00.000Z",
        },
      },
    };
  });

  test.afterEach(async () => {
    await deleteTestTimbrados();
  });

  test("timbrar deja la fila en la base, no sólo en la respuesta", async () => {
    const resultado = await timbrarNomina(entrada);

    expect(resultado.status).toBe("TIMBRADO");
    expect(resultado.uuid).toBe("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE");

    // Lo que prueba que recargar la pantalla ya no pierde el comprobante.
    const fila = await findTimbrado(COMPANY_ID, RFC, PERIODO);
    expect(fila).not.toBeNull();
    expect(fila!.uuid).toBe("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE");
    expect(fila!.status).toBe("TIMBRADO");
    expect(fila!.selloDigital).toBe("SELLO-E2E");
    expect(fila!.fechaTimbrado).not.toBeNull();
    expect(fila!.timbradoPor).toBe(USER_SUPER_ADMIN);
  });

  test("timbrar dos veces el mismo período gasta un solo folio", async () => {
    const primero = await timbrarNomina(entrada);
    expect(llamadasAlPac).toBe(1);

    // El PAC daría otro folio si se le pidiera; si el segundo intento lo
    // devuelve, es que no volvió a preguntar.
    respuestaPac = {
      ok: true,
      body: {
        succeeded: true,
        data: {
          uuid: "99999999-9999-9999-9999-999999999999",
          seal: "SELLO-OTRO",
          fechaTimbrado: "2026-08-21T13:00:00.000Z",
        },
      },
    };

    const segundo = await timbrarNomina(entrada);

    expect(llamadasAlPac, "el segundo intento volvió a pedir folio al PAC").toBe(1);
    expect(segundo.uuid).toBe(primero.uuid);
    expect(await countTimbrados(COMPANY_ID, RFC, PERIODO)).toBe(1);
  });

  test("un rechazo del PAC no se guarda como TIMBRADO", async () => {
    // succeeded=false con HTTP 200: rechazo de negocio del PAC.
    respuestaPac = {
      ok: true,
      body: { succeeded: false, message: "CSD vencido" },
    };

    const resultado = await timbrarNomina(entrada);

    expect(resultado.status).toBe("RECHAZADO");
    const fila = await findTimbrado(COMPANY_ID, RFC, PERIODO);
    expect(fila!.status).toBe("RECHAZADO");
    expect(fila!.uuid).toBeNull();
  });

  test("un período rechazado se puede reintentar, y al timbrarse deja de preguntar", async () => {
    // El índice único es por período, no por folio, justamente para esto: si
    // fuera por folio, un rechazo sin UUID bloquearía el reintento legítimo.
    respuestaPac = { ok: true, body: { succeeded: false, message: "rechazado" } };
    await timbrarNomina(entrada);
    expect(llamadasAlPac).toBe(1);

    respuestaPac = {
      ok: true,
      body: {
        succeeded: true,
        data: {
          uuid: "12345678-1234-1234-1234-123456789012",
          seal: "SELLO-OK",
          fechaTimbrado: "2026-08-21T14:00:00.000Z",
        },
      },
    };
    const reintento = await timbrarNomina(entrada);

    expect(llamadasAlPac, "el reintento de un rechazo no llegó al PAC").toBe(2);
    expect(reintento.status).toBe("TIMBRADO");
    expect(reintento.uuid).toBe("12345678-1234-1234-1234-123456789012");
    // Sigue siendo una sola fila: el reintento actualiza, no acumula.
    expect(await countTimbrados(COMPANY_ID, RFC, PERIODO)).toBe(1);

    // Y ya timbrado, un tercer intento no vuelve a preguntar.
    await timbrarNomina(entrada);
    expect(llamadasAlPac).toBe(2);
  });

  test("el folio fiscal (uuid) es la evidencia del timbre; sin él queda pendiente", async () => {
    // En el contrato v4 el `uuid` dentro de `data` lo asigna el SAT al
    // certificar: su presencia ES el timbre, con o sin sello en la respuesta.
    // Afirmar TIMBRADO sin folio es lo que hacía la versión anterior; la regla
    // sigue siendo no afirmar de más.
    respuestaPac = {
      ok: true,
      body: { succeeded: true, data: { uuid: "ABCDEFAB-1111-2222-3333-444444444444" } },
    };
    expect((await timbrarNomina(entrada)).status).toBe("TIMBRADO");

    await deleteTestTimbrados();
    respuestaPac = { ok: true, body: { succeeded: true, message: "en proceso", data: {} } };
    expect((await timbrarNomina(entrada)).status).toBe("PENDIENTE");
  });

  test("dos timbrados simultáneos del mismo período dejan una sola fila", async () => {
    // La guarda real es el índice único: sin él, las dos peticiones pasarían
    // el SELECT previo y escribirían dos filas.
    const resultados = await Promise.allSettled([
      timbrarNomina(entrada),
      timbrarNomina(entrada),
    ]);

    expect(resultados.filter((r) => r.status === "fulfilled").length).toBeGreaterThan(0);
    expect(
      await countTimbrados(COMPANY_ID, RFC, PERIODO),
      "una carrera dejó dos comprobantes para el mismo período"
    ).toBe(1);
  });
});

/**
 * El desglose fiscal real y los datos reales del empleado son una función
 * pura (`construirPayloadNomina`): no tocan PAC, base de datos ni servidor.
 *
 *   pnpm exec playwright test --no-deps --project=chromium tests/timbrado-idempotente.spec.ts
 */
test.describe("desglose real de nómina en el payload", () => {
  test("con desglose, el CFDI refleja cada concepto y el total cuadra con las líneas", () => {
    const { payload, expectedTotal } = construirPayloadNomina({
      ...entrada,
      // Totales agregados que NO corresponden al desglose: si se usaran,
      // el comprobante no cuadraría línea por línea ante el SAT.
      totalPercepciones: 999_999_999,
      totalDeducciones: 111_111_111,
      desglosePercepciones: [
        { earningTypeCode: "001", code: "001", concept: "Sueldo nominal", taxedAmount: 1_200_000, exemptAmount: 0 },
        { earningTypeCode: "038", code: "038", concept: "Propinas asignadas", taxedAmount: 0, exemptAmount: 300_000 },
      ],
      desgloseDeducciones: [
        { deductionTypeCode: "002", code: "002", concept: "ISR retenido", amount: 150_000 },
        { deductionTypeCode: "004", code: "004", concept: "Cuota IMSS", amount: 50_000 },
      ],
    });

    const payroll = (payload as any).complement.payroll;
    const earnings = payroll.earnings.earnings;
    expect(earnings).toHaveLength(2);
    expect(earnings[0].earningTypeCode).toBe("001");
    expect(earnings[0].taxedAmount).toBe(12_000);
    expect(earnings[1].exemptAmount).toBe(3_000);

    expect(payroll.deductions).toHaveLength(2);
    expect(payroll.deductions[1].deductionTypeCode).toBe("004");
    expect(payroll.deductions[1].amount).toBe(500);

    // Σ percepciones (gravado+exento) − Σ deducciones, en pesos.
    expect(expectedTotal).toBe(13_000);
  });

  test("sin desglose cae al agregado de siempre (una percepción gravada)", () => {
    const { payload, expectedTotal } = construirPayloadNomina(entrada);

    const earnings = (payload as any).complement.payroll.earnings.earnings;
    expect(earnings).toHaveLength(1);
    expect(earnings[0].earningTypeCode).toBe("001");
    expect(earnings[0].taxedAmount).toBe(15_000);
    expect(expectedTotal).toBe(13_000);
  });

  test("los datos reales del empleado sustituyen a los sintéticos", () => {
    const { payload } = construirPayloadNomina({
      ...entrada,
      empleadoNss: "98765432109",
      empleadoFechaContratacion: "2022-03-01",
      empleadoSalarioDiarioCents: 45_000,
      registroPatronal: "REG-PAT-E2E",
    });

    const emp = (payload as any).recipient.employeeData;
    expect(emp.socialSecurityNumber).toBe("98765432109");
    expect(emp.laborRelationStartDate).toBe("2022-03-01");
    expect(emp.baseSalaryForContributions).toBe(450);
    expect((payload as any).issuer.employerData.employerRegistration).toBe("REG-PAT-E2E");
  });
});

/**
 * Auditoría A6c — el comprobante sobrevive a recargar la pantalla.
 *
 * La pantalla fiscal guardaba el resultado sólo en el estado de React, así que
 * recargar lo borraba: el folio existía ante el SAT y Pulso se quedaba en
 * blanco. `GET /api/finance/fiscal/timbrar-nomina` es lo que la pantalla
 * consulta para recuperarlo y para avisar de un período ya timbrado en vez de
 * ofrecer gastar otro folio.
 *
 * Estos casos **sí necesitan el servidor** (usan la sesión de admin):
 *   pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" \
 *     pnpm exec playwright test --project=chromium tests/timbrado-idempotente.spec.ts
 */
test.describe("A6c · el comprobante se recupera del servidor", () => {
  const RFC_C = "E2E020202BBB";
  const PERIODO_C = "2026-98";

  test.afterEach(async () => {
    await deleteTestTimbrados();
  });

  test("un período timbrado se recupera con UUID y fecha", async ({ request }) => {
    await seedTimbrado({
      companyId: COMPANY_ID,
      empleadoRfc: RFC_C,
      periodo: PERIODO_C,
      uuid: "11112222-3333-4444-5555-666677778888",
      status: "TIMBRADO",
    });

    const res = await request.get(
      `/api/finance/fiscal/timbrar-nomina?empleadoRfc=${RFC_C}&periodo=${PERIODO_C}`
    );
    expect(res.status()).toBe(200);
    const { data } = await res.json();

    expect(data, "recargar la pantalla perdería el comprobante").not.toBeNull();
    expect(data.uuid).toBe("11112222-3333-4444-5555-666677778888");
    expect(data.status).toBe("TIMBRADO");
    expect(Number.isNaN(Date.parse(data.fechaTimbrado))).toBe(false);
  });

  test("un período rechazado se recupera como RECHAZADO, no como timbre", async ({
    request,
  }) => {
    // Es lo que impide que el badge verde se pinte sobre un rechazo del SAT.
    await seedTimbrado({
      companyId: COMPANY_ID,
      empleadoRfc: RFC_C,
      periodo: PERIODO_C,
      uuid: null,
      status: "RECHAZADO",
    });

    const res = await request.get(
      `/api/finance/fiscal/timbrar-nomina?empleadoRfc=${RFC_C}&periodo=${PERIODO_C}`
    );
    const { data } = await res.json();

    expect(data.status).toBe("RECHAZADO");
    expect(data.uuid).toBe("");
  });

  test("un período sin timbrar devuelve null, no un error", async ({ request }) => {
    const res = await request.get(
      `/api/finance/fiscal/timbrar-nomina?empleadoRfc=${RFC_C}&periodo=SIN-TIMBRAR`
    );

    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();
  });

  test("sin RFC o sin período la consulta se rechaza con 400", async ({ request }) => {
    const res = await request.get("/api/finance/fiscal/timbrar-nomina?empleadoRfc=" + RFC_C);
    expect(res.status()).toBe(400);
  });
});
