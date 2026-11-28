import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@/lib/permissions";

const requireTenantAuthMock = vi.fn();
const listUsersMock = vi.fn();
const getUserMock = vi.fn();
const createUserMock = vi.fn();
const updateUserMock = vi.fn();
const deleteUserMock = vi.fn();

vi.mock("@/lib/api/with-auth", () => ({
  requireTenantAuth: (...args: unknown[]) => requireTenantAuthMock(...args),
  withTenantAuth:
    (
      handler: (
        req: NextRequest,
        ctx: { params: Promise<{ id: string }>; auth: unknown },
      ) => unknown,
    ) =>
    async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const auth = await requireTenantAuthMock();
    return handler(req, { params: ctx.params, auth });
  },
}));

vi.mock("@/lib/services/user-service", () => ({
  UserService: {
    listUsers: (...args: unknown[]) => listUsersMock(...args),
    getUser: (...args: unknown[]) => getUserMock(...args),
    createUser: (...args: unknown[]) => createUserMock(...args),
    updateUser: (...args: unknown[]) => updateUserMock(...args),
    deleteUser: (...args: unknown[]) => deleteUserMock(...args),
  },
}));

import { GET as listGET, POST as listPOST } from "@/app/api/users/route";
import {
  GET as detailGET,
  PATCH as detailPATCH,
  DELETE as detailDELETE,
} from "@/app/api/users/[id]/route";

const COMPANY_ID = "c1000001-0000-4000-8000-000000000001";
const BRANCH_CONDESA = "b1000001-0000-4000-8000-000000000001";
const BRANCH_POLANCO = "b1000001-0000-4000-8000-000000000002";

function mockAuth(role: Role, userId = "u-actor", branchId: string | null = BRANCH_CONDESA) {
  requireTenantAuthMock.mockResolvedValue({
    user: { id: userId, role, companyId: COMPANY_ID, branchId },
    tenantId: COMPANY_ID,
    branchId,
  });
}

describe("Task 7: /api/users and /api/users/[id] RBAC, branch scope, hierarchy & DTO hygiene", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUsersMock.mockResolvedValue({
      data: [
        {
          id: "u-pedro",
          name: "Pedro",
          email: "pedro@pulso.mx",
          role: "EMPLEADO",
          companyId: COMPANY_ID,
          branchId: BRANCH_CONDESA,
          pinCode: "9876",
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    getUserMock.mockResolvedValue({
      id: "u-pedro",
      name: "Pedro",
      email: "pedro@pulso.mx",
      role: "EMPLEADO",
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      pinCode: "9876",
    });
    updateUserMock.mockResolvedValue({
      id: "u-pedro",
      name: "Pedro Updated",
      role: "SUPERVISOR",
      companyId: COMPANY_ID,
      branchId: BRANCH_CONDESA,
      pinCode: "9876",
    });
    deleteUserMock.mockResolvedValue(true);
  });

  describe("GET /api/users", () => {
    it("denies EMPLEADO with 403", async () => {
      mockAuth("EMPLEADO", "u-pedro", BRANCH_CONDESA);
      const res = await listGET(new NextRequest("http://localhost/api/users"));
      expect(res.status).toBe(403);
      expect(listUsersMock).not.toHaveBeenCalled();
    });

    it("scopes GERENTE to own branch and strips pinCode", async () => {
      mockAuth("GERENTE", "u-juan", BRANCH_CONDESA);
      const res = await listGET(
        new NextRequest(`http://localhost/api/users?branchId=${BRANCH_POLANCO}`),
      );
      expect(res.status).toBe(200);
      expect(listUsersMock).toHaveBeenCalledWith(
        COMPANY_ID,
        expect.objectContaining({ branchId: BRANCH_CONDESA }),
      );
      const body = await res.json();
      expect(body.data.data[0].pinCode).toBeUndefined();
      expect(body.data.data[0].name).toBe("Pedro");
    });

    it("allows SUPER_ADMIN to list all branches without pinCode", async () => {
      mockAuth("SUPER_ADMIN", "u-carlos", BRANCH_CONDESA);
      const res = await listGET(new NextRequest("http://localhost/api/users"));
      expect(res.status).toBe(200);
      expect(listUsersMock).toHaveBeenCalledWith(
        COMPANY_ID,
        expect.objectContaining({ branchId: undefined }),
      );
      const body = await res.json();
      expect(body.data.data[0].pinCode).toBeUndefined();
    });
  });

  describe("GET /api/users/[id]", () => {
    it("denies EMPLEADO reading another user", async () => {
      mockAuth("EMPLEADO", "u-pedro", BRANCH_CONDESA);
      const res = await detailGET(new NextRequest("http://localhost/api/users/u-other"), {
        params: Promise.resolve({ id: "u-other" }),
      });
      expect(res.status).toBe(403);
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it("allows EMPLEADO reading own user without pinCode", async () => {
      mockAuth("EMPLEADO", "u-pedro", BRANCH_CONDESA);
      const res = await detailGET(new NextRequest("http://localhost/api/users/u-pedro"), {
        params: Promise.resolve({ id: "u-pedro" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.pinCode).toBeUndefined();
    });

    it("denies GERENTE reading a user in another branch", async () => {
      mockAuth("GERENTE", "u-juan", BRANCH_CONDESA);
      getUserMock.mockResolvedValueOnce({
        id: "u-luisa",
        role: "EMPLEADO",
        companyId: COMPANY_ID,
        branchId: BRANCH_POLANCO,
      });
      const res = await detailGET(new NextRequest("http://localhost/api/users/u-luisa"), {
        params: Promise.resolve({ id: "u-luisa" }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/users/[id]", () => {
    it.each<Role>(["EMPLEADO", "SUPERVISOR", "READONLY"])(
      "denies %s with 403",
      async (role) => {
        mockAuth(role);
        const res = await detailPATCH(
          new NextRequest("http://localhost/api/users/u-pedro", {
            method: "PATCH",
            body: JSON.stringify({ name: "Hacked" }),
          }),
          { params: Promise.resolve({ id: "u-pedro" }) },
        );
        expect(res.status).toBe(403);
        expect(updateUserMock).not.toHaveBeenCalled();
      },
    );

    it("returns 404 when target user belongs to another tenant", async () => {
      mockAuth("SUPER_ADMIN", "u-carlos", BRANCH_CONDESA);
      getUserMock.mockResolvedValueOnce({
        id: "u-foreign",
        role: "EMPLEADO",
        companyId: "c-other",
        branchId: BRANCH_CONDESA,
      });
      const res = await detailPATCH(
        new NextRequest("http://localhost/api/users/u-foreign", {
          method: "PATCH",
          body: JSON.stringify({ name: "Cross Tenant" }),
        }),
        { params: Promise.resolve({ id: "u-foreign" }) },
      );
      expect(res.status).toBe(404);
      expect(updateUserMock).not.toHaveBeenCalled();
    });

    it("denies GERENTE editing a user in Polanco or editing ADMIN/SUPER_ADMIN", async () => {
      mockAuth("GERENTE", "u-juan", BRANCH_CONDESA);
      getUserMock.mockResolvedValueOnce({
        id: "u-luisa",
        role: "EMPLEADO",
        companyId: COMPANY_ID,
        branchId: BRANCH_POLANCO,
      });
      const resBranch = await detailPATCH(
        new NextRequest("http://localhost/api/users/u-luisa", {
          method: "PATCH",
          body: JSON.stringify({ name: "Luisa" }),
        }),
        { params: Promise.resolve({ id: "u-luisa" }) },
      );
      expect(resBranch.status).toBe(403);

      getUserMock.mockResolvedValueOnce({
        id: "u-maria",
        role: "ADMIN",
        companyId: COMPANY_ID,
        branchId: BRANCH_CONDESA,
      });
      const resHigher = await detailPATCH(
        new NextRequest("http://localhost/api/users/u-maria", {
          method: "PATCH",
          body: JSON.stringify({ name: "Maria" }),
        }),
        { params: Promise.resolve({ id: "u-maria" }) },
      );
      expect(resHigher.status).toBe(403);
      expect(updateUserMock).not.toHaveBeenCalled();
    });

    it("denies ADMIN editing SUPER_ADMIN or OWNER", async () => {
      mockAuth("ADMIN", "u-maria", BRANCH_CONDESA);
      getUserMock.mockResolvedValueOnce({
        id: "u-carlos",
        role: "SUPER_ADMIN",
        companyId: COMPANY_ID,
        branchId: BRANCH_CONDESA,
      });
      const res = await detailPATCH(
        new NextRequest("http://localhost/api/users/u-carlos", {
          method: "PATCH",
          body: JSON.stringify({ name: "Demoted" }),
        }),
        { params: Promise.resolve({ id: "u-carlos" }) },
      );
      expect(res.status).toBe(403);
      expect(updateUserMock).not.toHaveBeenCalled();
    });

    it("allows GERENTE to promote own-branch EMPLEADO to SUPERVISOR and strips pinCode", async () => {
      mockAuth("GERENTE", "u-juan", BRANCH_CONDESA);
      const res = await detailPATCH(
        new NextRequest("http://localhost/api/users/u-pedro", {
          method: "PATCH",
          body: JSON.stringify({ role: "SUPERVISOR" }),
        }),
        { params: Promise.resolve({ id: "u-pedro" }) },
      );
      expect(res.status).toBe(200);
      expect(updateUserMock).toHaveBeenCalledWith("u-pedro", { role: "SUPERVISOR" });
      const body = await res.json();
      expect(body.data.pinCode).toBeUndefined();
    });

    it("denies GERENTE promoting EMPLEADO to GERENTE or ADMIN", async () => {
      mockAuth("GERENTE", "u-juan", BRANCH_CONDESA);
      const res = await detailPATCH(
        new NextRequest("http://localhost/api/users/u-pedro", {
          method: "PATCH",
          body: JSON.stringify({ role: "GERENTE" }),
        }),
        { params: Promise.resolve({ id: "u-pedro" }) },
      );
      expect(res.status).toBe(403);
      expect(updateUserMock).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/users/[id]", () => {
    it.each<Role>(["EMPLEADO", "SUPERVISOR", "READONLY", "GERENTE"])(
      "denies %s with 403",
      async (role) => {
        mockAuth(role);
        const res = await detailDELETE(
          new NextRequest("http://localhost/api/users/u-pedro", { method: "DELETE" }),
          { params: Promise.resolve({ id: "u-pedro" }) },
        );
        expect(res.status).toBe(403);
        expect(deleteUserMock).not.toHaveBeenCalled();
      },
    );

    it("returns 404 when deleting user from another tenant", async () => {
      mockAuth("SUPER_ADMIN", "u-carlos", BRANCH_CONDESA);
      getUserMock.mockResolvedValueOnce({
        id: "u-foreign",
        role: "EMPLEADO",
        companyId: "c-other",
        branchId: BRANCH_CONDESA,
      });
      const res = await detailDELETE(
        new NextRequest("http://localhost/api/users/u-foreign", { method: "DELETE" }),
        { params: Promise.resolve({ id: "u-foreign" }) },
      );
      expect(res.status).toBe(404);
      expect(deleteUserMock).not.toHaveBeenCalled();
    });

    it("denies ADMIN deleting SUPER_ADMIN or OWNER", async () => {
      mockAuth("ADMIN", "u-maria", BRANCH_CONDESA);
      getUserMock.mockResolvedValueOnce({
        id: "u-carlos",
        role: "SUPER_ADMIN",
        companyId: COMPANY_ID,
        branchId: BRANCH_CONDESA,
      });
      const res = await detailDELETE(
        new NextRequest("http://localhost/api/users/u-carlos", { method: "DELETE" }),
        { params: Promise.resolve({ id: "u-carlos" }) },
      );
      expect(res.status).toBe(403);
      expect(deleteUserMock).not.toHaveBeenCalled();
    });

    it("allows ADMIN to delete EMPLEADO in same tenant", async () => {
      mockAuth("ADMIN", "u-maria", BRANCH_CONDESA);
      const res = await detailDELETE(
        new NextRequest("http://localhost/api/users/u-pedro", { method: "DELETE" }),
        { params: Promise.resolve({ id: "u-pedro" }) },
      );
      expect(res.status).toBe(200);
      expect(deleteUserMock).toHaveBeenCalledWith("u-pedro");
    });
  });

  describe("POST /api/users", () => {
    it("denies GERENTE creating a user in another branch", async () => {
      mockAuth("GERENTE", "u-juan", BRANCH_CONDESA);
      const res = await listPOST(
        new NextRequest("http://localhost/api/users", {
          method: "POST",
          body: JSON.stringify({
            name: "Nuevo",
            email: "nuevo@pulso.mx",
            password: "password123",
            role: "EMPLEADO",
            branchId: BRANCH_POLANCO,
          }),
        }),
      );
      expect(res.status).toBe(403);
      expect(createUserMock).not.toHaveBeenCalled();
    });
  });
});
