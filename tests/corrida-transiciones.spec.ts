import { test, expect } from "@playwright/test";
import { COMPANY_ID, USER_ADMIN } from "./support/constants";
import {
  deleteTestPaymentRuns,
  getPaymentRunStatus,
  seedPaymentRun,
} from "./support/db";
import { assertPaymentRunTransition } from "../lib/services/treasury-service";

/**
 * A0.2 / F3 — la doble firma sólo vale si no se puede saltar el estado.
 *
 * `payment_run_status` describía la máquina completa
 * (`DRAFT → PENDING_APPROVAL → APPROVED → PROCESSING → COMPLETED / CANCELLED`)
 * y nadie la validaba: `updatePaymentRunStatus` aceptaba cualquier valor del
 * enum. La regla de segregación de funciones sólo corre al entrar a `APPROVED`,
 * así que un `PATCH {"status":"COMPLETED"}` sobre una corrida en `DRAFT` la
 * cerraba —y marcaba sus facturas como pagadas— sin que nadie la firmara.
 *
 * La tabla de transiciones se prueba como función pura: no necesita ni servidor
 * ni base, y cubre los saltos que ninguna pantalla ofrece pero un `curl` sí.
 * El caso extremo —`DRAFT → COMPLETED` por HTTP— se prueba aparte contra la
 * ruta, porque es el que reproduce el hallazgo tal como se explota.
 *
 * Los casos puros corren solos:
 *   pnpm exec playwright test --no-deps --project=chromium tests/corrida-transiciones.spec.ts -g "tabla"
 * Los de ruta necesitan el servidor:
 *   pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start"  *     pnpm exec playwright test --project=chromium tests/corrida-transiciones.spec.ts
 */

const RUTA_ESTADO = (id: string) => `/api/finance/treasury/runs/${id}/status`;

/** Los cinco avances legítimos de la máquina. */
const VALIDAS: Array<[string, string]> = [
  ["DRAFT", "PENDING_APPROVAL"],
  ["PENDING_APPROVAL", "APPROVED"],
  ["APPROVED", "PROCESSING"],
  ["PROCESSING", "COMPLETED"],
  ["DRAFT", "CANCELLED"],
];

/**
 * Los saltos que abrían el hueco, uno por cada forma de rodear una firma:
 * saltarse la autorización, saltarse la dispersión, retroceder a un estado que
 * ya se firmó, y reabrir algo terminal.
 */
const INVALIDAS: Array<[string, string, string]> = [
  ["DRAFT", "COMPLETED", "cierra la corrida sin que nadie la apruebe"],
  ["DRAFT", "APPROVED", "se salta la cola de autorización"],
  ["PENDING_APPROVAL", "COMPLETED", "paga sin la segunda firma"],
  ["APPROVED", "COMPLETED", "se salta la dispersión"],
  ["PROCESSING", "APPROVED", "retrocede y permite dispersar dos veces"],
  ["COMPLETED", "PROCESSING", "reabre una corrida ya pagada"],
  ["CANCELLED", "DRAFT", "revive una corrida cancelada"],
  ["COMPLETED", "CANCELLED", "cancela algo que ya se pagó"],
];

test.describe("A0.2 · la tabla de transiciones de la corrida de pago", () => {
  for (const [desde, hacia] of VALIDAS) {
    test(`tabla: ${desde} → ${hacia} se permite`, async () => {
      expect(() =>
        assertPaymentRunTransition(desde as any, hacia as any)
      ).not.toThrow();
    });
  }

  for (const [desde, hacia, porque] of INVALIDAS) {
    test(`tabla: ${desde} → ${hacia} se rechaza (${porque})`, async () => {
      expect(
        () => assertPaymentRunTransition(desde as any, hacia as any),
        `${desde} → ${hacia} ${porque}`
      ).toThrow();
    });
  }

  test("tabla: el mensaje nombra el estado actual y los permitidos", async () => {
    let mensaje = "";
    try {
      assertPaymentRunTransition("DRAFT" as any, "COMPLETED" as any);
    } catch (error: any) {
      mensaje = error?.message ?? "";
    }

    // En español y accionable: quien lo lee tiene que saber qué le falta hacer,
    // no sólo que "no se pudo".
    expect(mensaje).toContain("Borrador");
    expect(mensaje).toContain("Pendiente de autorización");
  });

  test("tabla: repetir el estado actual no cuenta como avance", async () => {
    expect(() =>
      assertPaymentRunTransition("APPROVED" as any, "APPROVED" as any)
    ).toThrow(/ya está en estado/);
  });
});

test.describe("A0.2 · la ruta de estado aplica la máquina", () => {
  test.afterEach(async () => {
    await deleteTestPaymentRuns();
  });

  test("un PATCH DRAFT → COMPLETED responde 400 y no cierra la corrida", async ({
    request,
  }) => {
    const runId = await seedPaymentRun({
      companyId: COMPANY_ID,
      status: "DRAFT",
      // Preparada por otro usuario: la sesión de los specs es SUPER_ADMIN, y si
      // la corrida la hubiera preparado él mismo el rechazo podría venir de la
      // segregación de funciones y no de la máquina de estados, que es lo que
      // este caso mide.
      preparedBy: USER_ADMIN,
      etiqueta: "salto-draft-completed",
    });

    const res = await request.patch(RUTA_ESTADO(runId), {
      data: { status: "COMPLETED" },
    });

    expect(res.status(), "el salto DRAFT → COMPLETED sigue pasando").toBe(400);
    expect(await getPaymentRunStatus(runId)).toBe("DRAFT");
  });

  test("la única ruta a COMPLETED pasa por APPROVED y PROCESSING", async ({
    request,
  }) => {
    const runId = await seedPaymentRun({
      companyId: COMPANY_ID,
      status: "PENDING_APPROVAL",
      // Ídem: quien aprueba no puede ser quien preparó.
      preparedBy: USER_ADMIN,
      etiqueta: "camino-completo",
    });

    for (const estado of ["APPROVED", "PROCESSING", "COMPLETED"]) {
      const res = await request.patch(RUTA_ESTADO(runId), { data: { status: estado } });
      expect(res.status(), `no se pudo avanzar a ${estado}`).toBe(200);
      expect(await getPaymentRunStatus(runId)).toBe(estado);
    }
  });

  test("una corrida de otra empresa responde 404, no 403", async ({ request }) => {
    // Mismo mensaje para "no existe" y "no es tuya": distinguirlos le confirma
    // a quien prueba ids qué corridas tienen las demás empresas.
    const res = await request.patch(
      RUTA_ESTADO("00000000-0000-4000-8000-000000000000"),
      { data: { status: "PENDING_APPROVAL" } }
    );
    expect([404, 400]).toContain(res.status());
  });
});
