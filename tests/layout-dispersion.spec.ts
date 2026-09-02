import { test, expect } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  BRANCH_CONDESA,
  COMPANY_ID,
  E2E_TAG,
  GERENTE_EMAIL,
  USER_ADMIN,
} from "./support/constants";
import {
  cleanupClabeVerificationFixture,
  contarDescargasDeLayout,
  findUserIdByEmail,
  seedMatchedInvoice,
  seedPaymentRun,
  seedPaymentRunItem,
  seedTestSupplier,
} from "./support/db";
import {
  registerSupplierBankAccount,
  verifySupplierBankAccount,
} from "../lib/services/supplier-bank-account-service";
import { computeClabeCheckDigit } from "../lib/banking/clabe";
import { TreasuryService } from "../lib/services/treasury-service";

/**
 * Fase 2 / F2 · F10 · F13 — el archivo de dispersión se puede subir al banco.
 *
 * Antes de esta fase el layout emitía `************1234` en vez de la CLABE
 * —un archivo que ningún banco acepta—, una referencia igual para toda la
 * corrida y distinta en cada descarga, y sólo las partidas `INVOICE`: nómina,
 * caja chica e impuestos se descartaban en silencio con un `recordCount` que no
 * cuadraba con el total de la corrida. Y la ruta que lo servía se autorizaba
 * con `reports:read`, que un GERENTE tiene.
 *
 * Los casos de servicio corren solos (sin servidor ni Inngest):
 *   pnpm exec playwright test --no-deps --project=chromium tests/layout-dispersion.spec.ts -g "servicio"
 * Los de ruta necesitan el servidor levantado.
 */

const TAG = `${E2E_TAG} layout`;

/** CLABE sintética válida: 17 dígitos + su dígito verificador. */
function clabeValida(semilla: string): string {
  const first17 = `002180${semilla}`.padEnd(17, "0").slice(0, 17);
  return `${first17}${computeClabeCheckDigit(first17)}`;
}

let secuencia = 0;

/**
 * Proveedor con cuenta CLABE verificada, sembrado **por los servicios reales**.
 *
 * La CLABE vive cifrada con el DEK del inquilino y con una huella HMAC para el
 * índice único, así que un `INSERT` a mano dejaría una fila que el layout no
 * puede descifrar — y el spec pasaría contra un montaje que no existe en
 * producción. Registrar y verificar son además dos personas distintas: la
 * segregación de funciones de la cuenta bancaria lo exige.
 */
async function seedProveedorConCuentaVerificada(opts: {
  companyId: string;
  nombre: string;
  titular?: string;
}): Promise<{ supplierId: string; clabe: string }> {
  const capturista = await findUserIdByEmail(GERENTE_EMAIL);
  const verificador = await findUserIdByEmail(ADMIN_EMAIL);

  const supplierId = await seedTestSupplier(opts.companyId, opts.nombre);
  const titular = opts.titular ?? opts.nombre;
  const clabe = clabeValida(String(Date.now()).slice(-6) + String(secuencia++).padStart(2, "0"));

  const registro = await registerSupplierBankAccount({
    companyId: opts.companyId,
    supplierId,
    clabe,
    accountHolderName: titular,
    registeredBy: capturista,
  });

  await verifySupplierBankAccount({
    companyId: opts.companyId,
    accountId: registro.account.id,
    verifiedBy: verificador,
    holderNameFromCep: titular,
    evidenceUrl: `local://${TAG}/cep.pdf`,
  });

  return { supplierId, clabe };
}

/** Factura conciliada y pendiente de pago, en Condesa. */
function seedInvoiceParaPago(opts: {
  companyId: string;
  supplierId: string;
  totalCents: number;
}) {
  return seedMatchedInvoice({
    companyId: opts.companyId,
    branchId: BRANCH_CONDESA,
    supplierId: opts.supplierId,
    totalCents: opts.totalCents,
  });
}

/** Limpia corridas, partidas, cuentas, facturas y proveedores del fixture. */
const deleteTestTreasuryFixtures = cleanupClabeVerificationFixture;

/** Partes en las que se divide una línea CSV respetando las comillas. */
function camposCsv(linea: string): string[] {
  const campos: string[] = [];
  let actual = "";
  let dentro = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (dentro && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        dentro = !dentro;
      }
      continue;
    }
    if (c === "," && !dentro) {
      campos.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  campos.push(actual);
  return campos;
}

test.describe("Fase 2 · servicio: el archivo de dispersión", () => {
  test.afterEach(async () => {
    await deleteTestTreasuryFixtures();
  });

  test("servicio: lleva CLABEs de 18 dígitos, no asteriscos", async () => {
    const { supplierId, clabe } = await seedProveedorConCuentaVerificada({
      companyId: COMPANY_ID,
      nombre: `${TAG} Proveedor Simple`,
    });
    const invoiceId = await seedInvoiceParaPago({
      companyId: COMPANY_ID,
      supplierId,
      totalCents: 150_000,
    });
    const runId = await seedPaymentRun({
      companyId: COMPANY_ID,
      status: "APPROVED",
      preparedBy: USER_ADMIN,
      etiqueta: "clabe",
      totalAmountCents: 150_000,
    });
    await seedPaymentRunItem({
      paymentRunId: runId,
      itemType: "INVOICE",
      referenceId: invoiceId,
      amountCents: 150_000,
    });

    const layout = await TreasuryService.generateBankDisbursementLayout(runId, COMPANY_ID);

    expect(layout.recordCount).toBe(1);
    expect(layout.content, "el layout sigue emitiendo la CLABE enmascarada").not.toContain("****");

    const [, fila] = layout.content.split("\n");
    const campos = camposCsv(fila);
    expect(campos[1], "la CLABE destino no son 18 dígitos").toBe(clabe);
  });

  test("servicio: un proveedor con comillas en el nombre no rompe la fila", async () => {
    // `Distribuidora "El Norte", S.A.` partía la fila en dos: el banco leía el
    // nombre como monto y la línea quedaba desalineada entera.
    const nombreHostil = `${TAG} Distribuidora "El Norte", S.A.`;
    const { supplierId } = await seedProveedorConCuentaVerificada({
      companyId: COMPANY_ID,
      nombre: nombreHostil,
      titular: nombreHostil,
    });
    const invoiceId = await seedInvoiceParaPago({
      companyId: COMPANY_ID,
      supplierId,
      totalCents: 99_900,
    });
    const runId = await seedPaymentRun({
      companyId: COMPANY_ID,
      status: "APPROVED",
      preparedBy: USER_ADMIN,
      etiqueta: "comillas",
      totalAmountCents: 99_900,
    });
    await seedPaymentRunItem({
      paymentRunId: runId,
      itemType: "INVOICE",
      referenceId: invoiceId,
      amountCents: 99_900,
    });

    const layout = await TreasuryService.generateBankDisbursementLayout(runId, COMPANY_ID);
    const lineas = layout.content.split("\n");

    expect(lineas.length, "el nombre con comillas partió la fila").toBe(2);
    const campos = camposCsv(lineas[1]);
    expect(campos.length, "la fila no tiene las 7 columnas del encabezado").toBe(7);
    expect(campos[4], "el monto se corrió de columna").toBe("999.00");
  });

  test("servicio: la referencia es estable entre descargas y distinta por partida", async () => {
    const { supplierId } = await seedProveedorConCuentaVerificada({
      companyId: COMPANY_ID,
      nombre: `${TAG} Proveedor Referencias`,
    });
    const runId = await seedPaymentRun({
      companyId: COMPANY_ID,
      status: "APPROVED",
      preparedBy: USER_ADMIN,
      etiqueta: "referencias",
      totalAmountCents: 300_000,
    });
    for (let i = 0; i < 3; i++) {
      const invoiceId = await seedInvoiceParaPago({
        companyId: COMPANY_ID,
        supplierId,
        totalCents: 100_000,
      });
      await seedPaymentRunItem({
        paymentRunId: runId,
        itemType: "INVOICE",
        referenceId: invoiceId,
        amountCents: 100_000,
      });
    }

    const primera = await TreasuryService.generateBankDisbursementLayout(runId, COMPANY_ID);
    const segunda = await TreasuryService.generateBankDisbursementLayout(runId, COMPANY_ID);

    const refs = (layout: { content: string }) =>
      layout.content
        .split("\n")
        .slice(1)
        .map((l) => camposCsv(l)[6]);

    const refsPrimera = refs(primera);

    // Distintas entre sí: antes era `Date.now().slice(-7)` para toda la corrida,
    // así que las tres transferencias llevaban la misma referencia.
    expect(new Set(refsPrimera).size, "dos partidas comparten referencia").toBe(3);

    // E iguales entre descargas: sin una referencia estable no hay con qué
    // conciliar el depósito cuando el proveedor llama a preguntar.
    expect(refs(segunda), "la referencia cambió entre dos descargas").toEqual(refsPrimera);
  });

  test("servicio: una corrida sin firmar no genera archivo", async () => {
    const { supplierId } = await seedProveedorConCuentaVerificada({
      companyId: COMPANY_ID,
      nombre: `${TAG} Proveedor Borrador`,
    });
    const invoiceId = await seedInvoiceParaPago({
      companyId: COMPANY_ID,
      supplierId,
      totalCents: 50_000,
    });
    const runId = await seedPaymentRun({
      companyId: COMPANY_ID,
      status: "DRAFT",
      preparedBy: USER_ADMIN,
      etiqueta: "sin-firmar",
      totalAmountCents: 50_000,
    });
    await seedPaymentRunItem({
      paymentRunId: runId,
      itemType: "INVOICE",
      referenceId: invoiceId,
      amountCents: 50_000,
    });

    await expect(
      TreasuryService.generateBankDisbursementLayout(runId, COMPANY_ID)
    ).rejects.toThrow(/autorizado|aprobada/i);
  });

  test("servicio: los impuestos quedan fuera y se declaran", async () => {
    const { supplierId } = await seedProveedorConCuentaVerificada({
      companyId: COMPANY_ID,
      nombre: `${TAG} Proveedor Mixto`,
    });
    const invoiceId = await seedInvoiceParaPago({
      companyId: COMPANY_ID,
      supplierId,
      totalCents: 200_000,
    });
    const runId = await seedPaymentRun({
      companyId: COMPANY_ID,
      status: "APPROVED",
      preparedBy: USER_ADMIN,
      etiqueta: "mixta",
      totalAmountCents: 350_000,
    });
    await seedPaymentRunItem({
      paymentRunId: runId,
      itemType: "INVOICE",
      referenceId: invoiceId,
      amountCents: 200_000,
    });
    await seedPaymentRunItem({
      paymentRunId: runId,
      itemType: "TAXES",
      referenceId: "LC-2026-0001",
      amountCents: 150_000,
      notes: `${TAG} línea de captura`,
    });

    const layout = await TreasuryService.generateBankDisbursementLayout(runId, COMPANY_ID);

    // La factura sí viaja; el impuesto no, y se dice por qué. Antes se
    // descartaba en silencio y el toast reportaba "1 registro listo" sobre una
    // corrida de dos partidas.
    expect(layout.recordCount).toBe(1);
    expect(layout.itemCount).toBe(2);
    expect(layout.excludedCount).toBe(1);
    expect(layout.excluded[0].itemType).toBe("TAXES");
    expect(layout.excluded[0].motivo).toMatch(/línea de captura/i);
    expect(layout.excludedAmountCents).toBe(150_000);
    expect(layout.totalPesos).toBe("2000.00");
    expect(layout.runTotalPesos).toBe("3500.00");
  });

  test("servicio: el número de consultas no crece con las partidas", async () => {
    // F13: eran tres consultas por partida dentro del bucle —600 viajes a Neon
    // para una corrida de 200 facturas. Lo que se afirma aquí no es un número
    // mágico sino la propiedad: una corrida de 40 facturas hace exactamente las
    // mismas consultas que una de 2.
    const { supplierId } = await seedProveedorConCuentaVerificada({
      companyId: COMPANY_ID,
      nombre: `${TAG} Proveedor Volumen`,
    });

    const armar = async (cuantas: number, etiqueta: string) => {
      const runId = await seedPaymentRun({
        companyId: COMPANY_ID,
        status: "APPROVED",
        preparedBy: USER_ADMIN,
        etiqueta,
        totalAmountCents: cuantas * 10_000,
      });
      for (let i = 0; i < cuantas; i++) {
        const invoiceId = await seedInvoiceParaPago({
          companyId: COMPANY_ID,
          supplierId,
          totalCents: 10_000,
        });
        await seedPaymentRunItem({
          paymentRunId: runId,
          itemType: "INVOICE",
          referenceId: invoiceId,
          amountCents: 10_000,
        });
      }
      return runId;
    };

    const chica = await armar(2, "volumen-2");
    const grande = await armar(40, "volumen-40");

    // El pool vive en `globalThis` (`lib/db/index.ts`) para sobrevivir al
    // hot-reload; eso permite contar las consultas desde el spec sin tocar
    // código de producción.
    const pool = (globalThis as any).__pulsoPool;
    expect(pool, "no se encontró el pool de conexiones para contar consultas").toBeTruthy();

    const original = pool.query.bind(pool);
    let contador = 0;
    pool.query = (...args: any[]) => {
      contador++;
      return original(...args);
    };

    try {
      contador = 0;
      const layoutChica = await TreasuryService.generateBankDisbursementLayout(chica, COMPANY_ID);
      const consultasChica = contador;

      contador = 0;
      const layoutGrande = await TreasuryService.generateBankDisbursementLayout(grande, COMPANY_ID);
      const consultasGrande = contador;

      expect(layoutChica.recordCount).toBe(2);
      expect(layoutGrande.recordCount).toBe(40);

      expect(
        consultasGrande,
        `40 facturas costaron ${consultasGrande} consultas y 2 costaron ${consultasChica}: el N+1 sigue ahí`
      ).toBe(consultasChica);

      // Y el costo constante es chico: corrida, partidas, facturas con su
      // proveedor, cuentas bancarias del lote y el DEK.
      expect(consultasGrande).toBeLessThanOrEqual(6);
    } finally {
      pool.query = original;
    }
  });
});

test.describe("Fase 2 · ruta: quién puede bajar las CLABEs del grupo", () => {
  test.afterEach(async () => {
    await deleteTestTreasuryFixtures();
  });

  test("un GERENTE recibe 403 en la ruta del layout", async ({ browser }) => {
    const runId = await seedPaymentRun({
      companyId: COMPANY_ID,
      status: "APPROVED",
      preparedBy: USER_ADMIN,
      etiqueta: "gate-gerente",
    });

    const contexto = await browser.newContext({ storageState: undefined });
    try {
      const login = await contexto.request.post("/api/auth/sign-in/email", {
        data: { email: GERENTE_EMAIL, password: ADMIN_PASSWORD },
      });
      expect(login.ok(), `no se pudo iniciar sesión como ${GERENTE_EMAIL}`).toBe(true);

      const res = await contexto.request.get(`/api/finance/treasury/runs/${runId}/layout`);
      expect(
        res.status(),
        "un GERENTE bajó las CLABEs de todos los proveedores del grupo"
      ).toBe(403);
    } finally {
      await contexto.close();
    }
  });

  test("un ADMIN sobre una corrida en DRAFT recibe 400 con el motivo", async ({ request }) => {
    const runId = await seedPaymentRun({
      companyId: COMPANY_ID,
      status: "DRAFT",
      preparedBy: USER_ADMIN,
      etiqueta: "gate-draft",
    });

    const res = await request.get(`/api/finance/treasury/runs/${runId}/layout`);
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(String(json.error)).toMatch(/autorizad/i);
  });

  test("la descarga de un ADMIN queda en data_access_logs", async ({ request }) => {
    const { supplierId } = await seedProveedorConCuentaVerificada({
      companyId: COMPANY_ID,
      nombre: `${TAG} Proveedor Auditado`,
    });
    const invoiceId = await seedInvoiceParaPago({
      companyId: COMPANY_ID,
      supplierId,
      totalCents: 75_000,
    });
    const runId = await seedPaymentRun({
      companyId: COMPANY_ID,
      status: "APPROVED",
      preparedBy: USER_ADMIN,
      etiqueta: "auditada",
      totalAmountCents: 75_000,
    });
    await seedPaymentRunItem({
      paymentRunId: runId,
      itemType: "INVOICE",
      referenceId: invoiceId,
      amountCents: 75_000,
    });

    const antes = await contarDescargasDeLayout(runId);
    const res = await request.get(`/api/finance/treasury/runs/${runId}/layout`);
    expect(res.status()).toBe(200);

    expect(
      await contarDescargasDeLayout(runId),
      "la descarga del archivo bancario no dejó rastro"
    ).toBe(antes + 1);
  });

  test("un formato que ya no existe recibe 400, no un archivo inventado", async ({ request }) => {
    const runId = await seedPaymentRun({
      companyId: COMPANY_ID,
      status: "APPROVED",
      preparedBy: USER_ADMIN,
      etiqueta: "formato",
    });

    const res = await request.get(
      `/api/finance/treasury/runs/${runId}/layout?format=BANORTE_TXT`
    );
    expect(res.status()).toBe(400);
  });
});
