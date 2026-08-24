import "dotenv/config";
import { test, expect, type Browser } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import { COMPANY_ID } from "../support/constants";

/**
 * Regresión: el expediente laboral filtra por el tenant de la SESIÓN.
 *
 * Historia: las cuatro rutas `app/api/employees/[id]/*` resolvían el tenant
 * como `session.user.companyId || companyIdParam` — un usuario autenticado sin
 * companyId pasaba cualquier `?companyId=` y leía CURP, IMSS y contratos de
 * otra empresa. El arreglo usa `getCurrentTenant()` (solo sesión; el header
 * `x-pulso-tenant-id` tiene que coincidir con la sesión) y la consulta final
 * filtra por ese companyId.
 *
 * El control positivo es parte del contrato: un ADMIN sigue viendo el
 * expediente de SU gente — un fail-closed que también cierra a quien sí tiene
 * permiso es una regresión, no un arreglo.
 *
 * Corre serial contra la base de dev como el resto de specs; siembra empresa B
 * con datos `[E2E]` por SQL directo y limpia en `afterAll`.
 */

test.describe.configure({ mode: "serial" });

const sql = neon(process.env.DATABASE_URL!);

const EMPRESA_B = "e2e00000-0000-4000-8000-00000000b001";
const EMP_A = "u000000e-0000-4000-8000-000000000a01";
const EMP_B = "u000000e-0000-4000-8000-000000000b01";

const RUTAS = ["documents", "benefits", "contracts", "training"] as const;

async function seed() {
  await sql`
    INSERT INTO companies (id, name)
    VALUES (${EMPRESA_B}, ${"[E2E] Empresa B aislamiento"})
    ON CONFLICT (id) DO NOTHING
  `;

  for (const [userId, companyId] of [
    [EMP_A, COMPANY_ID],
    [EMP_B, EMPRESA_B],
  ] as const) {
    await sql`
      INSERT INTO users (id, name, email, email_verified, created_at, updated_at, role, company_id)
      VALUES (${userId}, ${"[E2E] Empleado"}, ${`e2e-${userId.toLowerCase()}@pulso.test`},
              true, now(), now(), 'EMPLEADO', ${companyId})
      ON CONFLICT (id) DO NOTHING
    `;
    await sql`
      INSERT INTO employee_profiles (user_id, created_by)
      VALUES (${userId}, ${userId})
      ON CONFLICT DO NOTHING
    `;
  }

  await sql`
    INSERT INTO employee_documents (user_id, company_id, document_type, document_name, document_url, uploaded_by)
    VALUES
      (${EMP_A}, ${COMPANY_ID}, 'CONTRACT', ${"[E2E] doc A"}, 'https://e2e.invalid/a.pdf', ${EMP_A}),
      (${EMP_B}, ${EMPRESA_B}, 'CONTRACT', ${"[E2E] doc B — PII ajena"}, 'https://e2e.invalid/b.pdf', ${EMP_B})
  `;
  await sql`
    INSERT INTO employee_benefits (user_id, company_id, benefit_type, start_date, created_by)
    VALUES
      (${EMP_A}, ${COMPANY_ID}, 'FOOD_VOUCHERS', now(), ${EMP_A}),
      (${EMP_B}, ${EMPRESA_B}, 'FOOD_VOUCHERS', now(), ${EMP_B})
  `;
  await sql`
    INSERT INTO employee_contracts (user_id, company_id, contract_number, start_date, base_salary, created_by)
    VALUES
      (${EMP_A}, ${COMPANY_ID}, '[E2E]-CTR-A', now(), 10000, ${EMP_A}),
      (${EMP_B}, ${EMPRESA_B}, '[E2E]-CTR-B', now(), 10000, ${EMP_B})
  `;
  await sql`
    INSERT INTO employee_training (user_id, company_id, training_name, training_type, start_date, created_by)
    VALUES
      (${EMP_A}, ${COMPANY_ID}, '[E2E] capacitación A', 'MANDATORY', now(), ${EMP_A}),
      (${EMP_B}, ${EMPRESA_B}, '[E2E] capacitación B', 'MANDATORY', now(), ${EMP_B})
  `;
}

async function cleanup() {
  for (const userId of [EMP_A, EMP_B]) {
    await sql`DELETE FROM employee_documents WHERE user_id = ${userId}`;
    await sql`DELETE FROM employee_benefits WHERE user_id = ${userId}`;
    await sql`DELETE FROM employee_contracts WHERE user_id = ${userId}`;
    await sql`DELETE FROM employee_training WHERE user_id = ${userId}`;
    await sql`DELETE FROM employee_profiles WHERE user_id = ${userId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
  }
  await sql`DELETE FROM companies WHERE id = ${EMPRESA_B}`;
}

test.describe("Expediente laboral aislado por tenant", () => {
  let contextoAnonimo: Awaited<ReturnType<Browser["newContext"]>>;

  test.beforeAll(async () => {
    // Por si una corrida anterior murió a medias: limpiar antes y después.
    await cleanup();
    await seed();
  });

  test.afterAll(async () => {
    await cleanup();
    if (contextoAnonimo) await contextoAnonimo.close();
  });

  test("sin sesión, ninguna ruta del expediente responde datos", async ({ browser }) => {
    contextoAnonimo = await browser.newContext({ storageState: undefined });
    for (const ruta of RUTAS) {
      const res = await contextoAnonimo.request.get(`/api/employees/${EMP_B}/${ruta}`);
      expect(res.status(), `${ruta} sin sesión`).toBe(401);
    }
  });

  for (const ruta of RUTAS) {
    test(`el expediente de la empresa B no se alcanza desde la empresa A (${ruta})`, async ({
      request,
    }) => {
      // Sesión admin de la empresa A (storageState global), pidiendo al
      // empleado de B por id. La respuesta puede ser lista vacía (ADMIN) o
      // 404 (roles con chequeo de perfil) — lo que NO puede haber son filas.
      const res = await request.get(`/api/employees/${EMP_B}/${ruta}`);
      expect(res.status()).toBeLessThan(300);
      const body = await res.json();
      const filas = body.data ?? [];
      expect(filas, `${ruta} no debe filtrar filas de otra empresa`).toHaveLength(0);
    });
  }

  for (const ruta of RUTAS) {
    test(`el parámetro ?companyId= nunca le gana a la sesión (${ruta})`, async ({
      request,
    }) => {
      // Pedir explícitamente el tenant de B con el empleado de A: ni con el
      // parámetro en la URL cruza la frontera.
      const res = await request.get(
        `/api/employees/${EMP_A}/${ruta}?companyId=${EMPRESA_B}`
      );
      expect(res.status()).toBeLessThan(300);
      const body = await res.json();
      for (const fila of body.data ?? []) {
        expect(fila.companyId).toBe(COMPANY_ID);
      }
    });
  }

  test("control positivo: el ADMIN sí ve el expediente de su propia gente", async ({
    request,
  }) => {
    const res = await request.get(`/api/employees/${EMP_A}/documents`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    const propias = (body.data ?? []).filter((d: { documentName: string }) =>
      d.documentName.includes("[E2E]")
    );
    expect(propias.length).toBeGreaterThanOrEqual(1);
    for (const fila of propias) {
      expect(fila.companyId).toBe(COMPANY_ID);
    }
  });
});
