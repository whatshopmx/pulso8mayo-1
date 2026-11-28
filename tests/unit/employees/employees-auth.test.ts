import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@/lib/permissions";

const requireTenantAuthMock = vi.fn();
const listEmployeesMock = vi.fn();
const getEmployeeMock = vi.fn();
const updateEmployeeMock = vi.fn();

vi.mock("@/lib/api/with-auth", () => ({
  requireTenantAuth: (...args: unknown[]) => requireTenantAuthMock(...args),
}));

vi.mock("@/lib/services/employee-service", () => ({
  EmployeeService: {
    listEmployees: (...args: unknown[]) => listEmployeesMock(...args),
    getEmployee: (...args: unknown[]) => getEmployeeMock(...args),
    updateEmployee: (...args: unknown[]) => updateEmployeeMock(...args),
  },
}));

import { GET as listGET, POST as listPOST } from "@/app/api/employees/route";
import {
  GET as detailGET,
  PUT as detailPUT,
  DELETE as detailDELETE,
} from "@/app/api/employees/[id]/route";

const BRANCH_CONDESA = "b1000001-0000-4000-8000-000000000001";
const BRANCH_POLANCO = "b1000001-0000-4000-8000-000000000002";

function mockAuth(role: Role, userId = "u-actor", branchId: string | null = BRANCH_CONDESA) {
  requireTenantAuthMock.mockResolvedValue({
    user: { id: userId, role, companyId: "c-1", branchId },
    tenantId: "c-1",
    branchId,
  });
}

describe("Task 6: /api/employees and /api/employees/[id] RBAC & branch scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEmployeesMock.mockResolvedValue({
      data: [
        {
          id: "emp-1",
          userId: "emp-1",
          userName: "Pedro",
          branchId: BRANCH_CONDESA,
          contractBaseSalary: 12000,
          effectiveSalaryCents: 1200000,
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    getEmployeeMock.mockResolvedValue({
      id: "emp-other",
      userId: "emp-other",
      userRole: "EMPLEADO",
      branchId: BRANCH_CONDESA,
      rfc: "XAXX010101000",
      curp: "CURP1234567890",
      clabe: "012180001234567890",
      bankName: "BBVA",
    });
    updateEmployeeMock.mockResolvedValue({ id: "emp-other", updated: true });
  });

  describe("GET /api/employees", () => {
    it("denies EMPLEADO with 403 before querying EmployeeService", async () => {
      mockAuth("EMPLEADO", "u-emp", BRANCH_CONDESA);
      const res = await listGET(new NextRequest("http://localhost/api/employees"));
      expect(res.status).toBe(403);
      expect(listEmployeesMock).not.toHaveBeenCalled();
    });

    it("forces GERENTE to own branch even when ?branchId= of another branch is passed", async () => {
      mockAuth("GERENTE", "u-ger", BRANCH_CONDESA);
      const res = await listGET(
        new NextRequest(`http://localhost/api/employees?branchId=${BRANCH_POLANCO}`),
      );
      expect(res.status).toBe(200);
      expect(listEmployeesMock).toHaveBeenCalledWith(
        "c-1",
        expect.objectContaining({ branchId: BRANCH_CONDESA }),
      );
      const body = await res.json();
      expect(body.data[0].contractBaseSalary).toBe(12000);
    });

    it("forces SUPERVISOR to own branch AND redacts salary fields", async () => {
      mockAuth("SUPERVISOR", "u-sup", BRANCH_POLANCO);
      const res = await listGET(
        new NextRequest(`http://localhost/api/employees?branchId=${BRANCH_CONDESA}`),
      );
      expect(res.status).toBe(200);
      expect(listEmployeesMock).toHaveBeenCalledWith(
        "c-1",
        expect.objectContaining({ branchId: BRANCH_POLANCO }),
      );
      const body = await res.json();
      expect(body.data[0].contractBaseSalary).toBeNull();
      expect(body.data[0].effectiveSalaryCents).toBeNull();
    });

    it("allows SUPER_ADMIN to list all branches when no ?branchId= filter is provided", async () => {
      mockAuth("SUPER_ADMIN", "u-sa", BRANCH_CONDESA);
      const res = await listGET(new NextRequest("http://localhost/api/employees"));
      expect(res.status).toBe(200);
      expect(listEmployeesMock).toHaveBeenCalledWith(
        "c-1",
        expect.objectContaining({ branchId: undefined }),
      );
    });

    it("returns empty fail-closed when GERENTE has no assigned branch", async () => {
      mockAuth("GERENTE", "u-ger", null);
      const res = await listGET(new NextRequest("http://localhost/api/employees"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
      expect(listEmployeesMock).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/employees", () => {
    it.each<Role>(["EMPLEADO", "SUPERVISOR", "READONLY"])(
      "denies %s with 403",
      async (role) => {
        mockAuth(role);
        const res = await listPOST(
          new NextRequest("http://localhost/api/employees", {
            method: "POST",
            body: JSON.stringify({ name: "Test", email: "test@pulso.mx" }),
          }),
        );
        expect(res.status).toBe(403);
      },
    );
  });

  describe("GET /api/employees/[id]", () => {
    it("denies EMPLEADO requesting another employee with includeSalary/includeDocuments", async () => {
      mockAuth("EMPLEADO", "u-pedro", BRANCH_CONDESA);
      const res = await detailGET(
        new NextRequest("http://localhost/api/employees/emp-other?includeSalary=true&includeDocuments=true"),
        { params: Promise.resolve({ id: "emp-other" }) },
      );
      expect(res.status).toBe(403);
      expect(getEmployeeMock).not.toHaveBeenCalled();
    });

    it("allows EMPLEADO to fetch their own record", async () => {
      mockAuth("EMPLEADO", "u-pedro", BRANCH_CONDESA);
      getEmployeeMock.mockResolvedValueOnce({
        id: "u-pedro",
        userId: "u-pedro",
        userRole: "EMPLEADO",
        branchId: BRANCH_CONDESA,
        rfc: "PEDR010101000",
      });
      const res = await detailGET(
        new NextRequest("http://localhost/api/employees/u-pedro?includeSalary=true"),
        { params: Promise.resolve({ id: "u-pedro" }) },
      );
      expect(res.status).toBe(200);
      expect(getEmployeeMock).toHaveBeenCalledWith(
        "u-pedro",
        expect.objectContaining({ includeSalary: true }),
      );
    });

    it("denies GERENTE/SUPERVISOR fetching an employee from another branch", async () => {
      mockAuth("GERENTE", "u-ger", BRANCH_CONDESA);
      getEmployeeMock.mockResolvedValueOnce({
        id: "emp-polanco",
        userId: "emp-polanco",
        userRole: "EMPLEADO",
        branchId: BRANCH_POLANCO,
      });
      const res = await detailGET(
        new NextRequest("http://localhost/api/employees/emp-polanco?includeSalary=true"),
        { params: Promise.resolve({ id: "emp-polanco" }) },
      );
      expect(res.status).toBe(403);
    });

    it("strips includeSalary and masks sensitive PII for SUPERVISOR within own branch", async () => {
      mockAuth("SUPERVISOR", "u-sup", BRANCH_CONDESA);
      const res = await detailGET(
        new NextRequest("http://localhost/api/employees/emp-other?includeSalary=true&includeContracts=true"),
        { params: Promise.resolve({ id: "emp-other" }) },
      );
      expect(res.status).toBe(200);
      expect(getEmployeeMock).toHaveBeenCalledWith(
        "emp-other",
        expect.objectContaining({ includeSalary: false, includeContracts: false }),
      );
      const body = await res.json();
      expect(body.data.rfc).toBe("••••••••");
      expect(body.data.clabe).toBe("••••••••");
      expect(body.data.curp).toBe("••••••••");
    });
  });

  describe("PUT /api/employees/[id]", () => {
    it.each<Role>(["EMPLEADO", "READONLY", "SUPERVISOR"])(
      "denies %s with 403",
      async (role) => {
        mockAuth(role);
        const res = await detailPUT(
          new NextRequest("http://localhost/api/employees/emp-other", {
            method: "PUT",
            body: JSON.stringify({ position: "Chef" }),
          }),
          { params: Promise.resolve({ id: "emp-other" }) },
        );
        expect(res.status).toBe(403);
        expect(updateEmployeeMock).not.toHaveBeenCalled();
      },
    );

    it("denies GERENTE editing an employee from another branch", async () => {
      mockAuth("GERENTE", "u-ger", BRANCH_CONDESA);
      getEmployeeMock.mockResolvedValueOnce({
        id: "emp-pol",
        userId: "emp-pol",
        userRole: "EMPLEADO",
        branchId: BRANCH_POLANCO,
      });
      const res = await detailPUT(
        new NextRequest("http://localhost/api/employees/emp-pol", {
          method: "PUT",
          body: JSON.stringify({ position: "Chef" }),
        }),
        { params: Promise.resolve({ id: "emp-pol" }) },
      );
      expect(res.status).toBe(403);
      expect(updateEmployeeMock).not.toHaveBeenCalled();
    });

    it("denies GERENTE editing a higher role (ADMIN) or promoting to ADMIN", async () => {
      mockAuth("GERENTE", "u-ger", BRANCH_CONDESA);
      getEmployeeMock.mockResolvedValueOnce({
        id: "u-admin",
        userId: "u-admin",
        userRole: "ADMIN",
        branchId: BRANCH_CONDESA,
      });
      const res1 = await detailPUT(
        new NextRequest("http://localhost/api/employees/u-admin", {
          method: "PUT",
          body: JSON.stringify({ position: "X" }),
        }),
        { params: Promise.resolve({ id: "u-admin" }) },
      );
      expect(res1.status).toBe(403);

      const res2 = await detailPUT(
        new NextRequest("http://localhost/api/employees/emp-other", {
          method: "PUT",
          body: JSON.stringify({ role: "ADMIN" }),
        }),
        { params: Promise.resolve({ id: "emp-other" }) },
      );
      expect(res2.status).toBe(403);
      expect(updateEmployeeMock).not.toHaveBeenCalled();
    });

    it("allows GERENTE to edit an employee in own branch using authenticated user id", async () => {
      mockAuth("GERENTE", "u-ger", BRANCH_CONDESA);
      const res = await detailPUT(
        new NextRequest("http://localhost/api/employees/emp-other", {
          method: "PUT",
          headers: { "x-user-id": "spoofed-id" },
          body: JSON.stringify({ position: "Mesero Senior" }),
        }),
        { params: Promise.resolve({ id: "emp-other" }) },
      );
      expect(res.status).toBe(200);
      expect(updateEmployeeMock).toHaveBeenCalledWith(
        "emp-other",
        "c-1",
        { position: "Mesero Senior" },
        "u-ger",
      );
    });
  });

  describe("DELETE /api/employees/[id]", () => {
    it.each<Role>(["EMPLEADO", "READONLY", "SUPERVISOR", "GERENTE"])(
      "denies %s with 403",
      async (role) => {
        mockAuth(role);
        const res = await detailDELETE(
          new NextRequest("http://localhost/api/employees/emp-other", { method: "DELETE" }),
          { params: Promise.resolve({ id: "emp-other" }) },
        );
        expect(res.status).toBe(403);
      },
    );

    it("denies ADMIN from archiving SUPER_ADMIN", async () => {
      mockAuth("ADMIN", "u-admin", BRANCH_CONDESA);
      getEmployeeMock.mockResolvedValueOnce({
        id: "u-sa",
        userId: "u-sa",
        userRole: "SUPER_ADMIN",
        branchId: BRANCH_CONDESA,
      });
      const res = await detailDELETE(
        new NextRequest("http://localhost/api/employees/u-sa", { method: "DELETE" }),
        { params: Promise.resolve({ id: "u-sa" }) },
      );
      expect(res.status).toBe(403);
    });

    it("allows ADMIN to archive EMPLEADO", async () => {
      mockAuth("ADMIN", "u-admin", BRANCH_CONDESA);
      const res = await detailDELETE(
        new NextRequest("http://localhost/api/employees/emp-other", { method: "DELETE" }),
        { params: Promise.resolve({ id: "emp-other" }) },
      );
      expect(res.status).toBe(200);
    });
  });
});
