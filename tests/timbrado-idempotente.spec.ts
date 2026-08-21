import { test, expect } from "@playwright/test";
import { COMPANY_ID, USER_SUPER_ADMIN } from "./support/constants";
import {
  countTimbrados,
  deleteTestTimbrados,
  findTimbrado,
} from "./support/db";
import { timbrarNomina } from "../lib/services/fiscal-service";

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
    if (String(url).includes("/cfdi/nomina/timbrar")) {
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
      body: {
        uuid: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
        status: "TIMBRADO",
        cadena_original: "||1.1|E2E||",
        sello_digital: "SELLO-E2E",
        fecha_timbrado: "2026-08-21T12:00:00.000Z",
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
        uuid: "99999999-9999-9999-9999-999999999999",
        status: "TIMBRADO",
        cadena_original: "||1.1|OTRO||",
        sello_digital: "SELLO-OTRO",
        fecha_timbrado: "2026-08-21T13:00:00.000Z",
      },
    };

    const segundo = await timbrarNomina(entrada);

    expect(llamadasAlPac, "el segundo intento volvió a pedir folio al PAC").toBe(1);
    expect(segundo.uuid).toBe(primero.uuid);
    expect(await countTimbrados(COMPANY_ID, RFC, PERIODO)).toBe(1);
  });

  test("un rechazo del PAC no se guarda como TIMBRADO", async () => {
    respuestaPac = {
      ok: true,
      body: {
        uuid: null,
        status: "RECHAZADO",
        mensaje: "CSD vencido",
      },
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
    respuestaPac = { ok: true, body: { uuid: null, status: "RECHAZADO" } };
    await timbrarNomina(entrada);
    expect(llamadasAlPac).toBe(1);

    respuestaPac = {
      ok: true,
      body: {
        uuid: "12345678-1234-1234-1234-123456789012",
        status: "TIMBRADO",
        sello_digital: "SELLO-OK",
        fecha_timbrado: "2026-08-21T14:00:00.000Z",
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

  test("sin `status` en la respuesta, un folio con sello es timbre y lo demás queda pendiente", async () => {
    // El PAC no promete el campo. Afirmar TIMBRADO sin evidencia es lo que
    // hacía la versión anterior; la regla es no afirmar de más.
    respuestaPac = {
      ok: true,
      body: { uuid: "ABCDEFAB-1111-2222-3333-444444444444", sello_digital: "SELLO" },
    };
    expect((await timbrarNomina(entrada)).status).toBe("TIMBRADO");

    await deleteTestTimbrados();
    respuestaPac = { ok: true, body: { mensaje: "en proceso" } };
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
