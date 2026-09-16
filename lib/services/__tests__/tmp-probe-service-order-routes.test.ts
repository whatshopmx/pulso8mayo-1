/**
 * SONDA TEMPORAL (patrón T03): valida la capa HTTP de service-orders SIN
 * servidor. Mockea `@/lib/tenant-context` (la sesión real exige better-auth),
 * usa la base de desarrollo real y se BORRA después de correr.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { E2E_TAG, USER_SUPER_ADMIN } from "../../../tests/support/constants";

const sql = neon(process.env.DATABASE_URL!);

const estado = {
  empresaA: "",
  sucursalA1: "",
  sucursalA2: "",
  empresaB: "",
  sucursalB1: "",
  equipoB: "",
  fallarAuth: false,
};

vi.mock("@/lib/tenant-context", () => ({
  requireTenant: async () => ({
    id: estado.empresaA,
    userId: USER_SUPER_ADMIN,
    branchId: null,
  }),
  requireAuth: async () => {
    if (estado.fallarAuth) {
      const { ApiError } = await import("@/lib/api/error");
      throw new ApiError("No autorizado", 401);
    }
    return {
      user: { id: USER_SUPER_ADMIN, role: "SUPER_ADMIN", branchId: null },
    };
  },
}));

describe("sonda T04 · rutas HTTP de service-orders sin servidor", () => {
  let empresaIds: string[] = [];

  beforeEach(async () => {
    estado.fallarAuth = false;
    const [a] = await sql`INSERT INTO companies (name) VALUES (${`${E2E_TAG} sonda A`}) RETURNING id`;
    const [b] = await sql`INSERT INTO companies (name) VALUES (${`${E2E_TAG} sonda B`}) RETURNING id`;
    estado.empresaA = a.id;
    estado.empresaB = b.id;
    empresaIds = [a.id, b.id];
    const [a1] = await sql`INSERT INTO branches (company_id, name) VALUES (${a.id}, ${`${E2E_TAG} sonda A1`}) RETURNING id`;
    const [a2] = await sql`INSERT INTO branches (company_id, name) VALUES (${a.id}, ${`${E2E_TAG} sonda A2`}) RETURNING id`;
    const [b1] = await sql`INSERT INTO branches (company_id, name) VALUES (${b.id}, ${`${E2E_TAG} sonda B1`}) RETURNING id`;
    estado.sucursalA1 = a1.id;
    estado.sucursalA2 = a2.id;
    estado.sucursalB1 = b1.id;
    const [eq] = await sql`
      INSERT INTO branch_equipments (company_id, branch_id, name, equipment_code, type, created_by)
      VALUES (${b.id}, ${b1.id}, ${`${E2E_TAG} equipo B`}, ${`E2E-SONDA-${Date.now()}`}, 'REFRIGERATOR', ${USER_SUPER_ADMIN})
      RETURNING id
    `;
    estado.equipoB = eq.id;
  });

  afterEach(async () => {
    await sql`DELETE FROM service_orders WHERE company_id = ANY(${empresaIds})`;
    await sql`DELETE FROM branch_equipments WHERE company_id = ANY(${empresaIds})`;
    await sql`DELETE FROM branches WHERE company_id = ANY(${empresaIds})`;
    await sql`DELETE FROM companies WHERE id = ANY(${empresaIds})`;
  });
});

