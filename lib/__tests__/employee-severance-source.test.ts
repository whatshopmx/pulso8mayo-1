import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/security/employee-cipher", () => ({
  decryptProfileRecord: async (_company: string, row: unknown) => row,
  encryptProfileRecord: async (_company: string, row: unknown) => row,
}));
import { EmployeeService } from "@/lib/services/employee-service";

describe("FIS-03C — salario del listado consumido por finiquito", () => {
  const pg = new PGlite();
  beforeAll(async () => {
    state.db = drizzle(pg);
    await pg.exec(`
      CREATE TABLE users (id text, name text, email text, role text, image text, company_id text,
        branch_id text, phone text, deleted_at timestamp, created_at timestamp);
      CREATE TABLE employee_profiles (user_id text, employee_number text, department text, position text,
        employee_status text, is_active boolean, hire_date timestamp, personal_email text,
        personal_phone text, city text, state text, curp text, rfc text);
      CREATE TABLE employee_contracts (user_id text, company_id text, base_salary integer,
        effective_salary_cents integer, status text, start_date timestamp);
      INSERT INTO users (id, name, email, company_id) VALUES
        ('formal', 'Formal prueba', 'formal@example.test', 'company-a'),
        ('mixed', 'Efectivo prueba', 'mixed@example.test', 'company-a'),
        ('missing', 'Sin contrato', 'missing@example.test', 'company-a'),
        ('foreign', 'Otra empresa', 'foreign@example.test', 'company-b');
      INSERT INTO employee_contracts VALUES
        ('formal', 'company-a', 60000, NULL, 'ACTIVE', '2026-01-01'),
        ('mixed', 'company-a', 31504, 100000, 'ACTIVE', '2026-01-01'),
        ('mixed', 'company-a', 100, 100, 'INACTIVE', '2026-02-01'),
        ('formal', 'company-b', 999999, NULL, 'ACTIVE', '2026-03-01');
    `);
  }, 60_000);
  afterAll(async () => { await pg.close(); });

  it("ejecuta SQL válido y devuelve registro/efectivo del contrato activo de la misma empresa", async () => {
    const result = await EmployeeService.listEmployees("company-a");
    expect(result.data).toHaveLength(3);
    expect(result.data.find((row) => row.id === "formal")).toMatchObject({
      userName: "Formal prueba", contractBaseSalary: 60000, effectiveSalaryCents: null,
    });
    expect(result.data.find((row) => row.id === "mixed")).toMatchObject({
      contractBaseSalary: 31504, effectiveSalaryCents: 100000,
    });
    expect(result.data.find((row) => row.id === "missing")).toMatchObject({
      contractBaseSalary: null, effectiveSalaryCents: null,
    });
  });
});
