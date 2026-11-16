/**
 * EVI-02.b — Pruebas de Integración en Base de Datos Aislada (Neon Postgres).
 *
 * Valida la persistencia, consulta, retiro (borrado lógico), aislamiento multi-tenant,
 * acotamiento de sucursal, control de roles y validaciones de archivo para la ruta
 * `app/api/exceptions/[id]/evidence/route.ts` (V2 DB y V3 Route).
 *
 * Entorno: Neon Postgres aislado (.env.test, pulso_app con NOBYPASSRLS).
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  companies,
  branches,
  users,
  exceptions,
  evidence,
} from "@/lib/db/schema";
import {
  EvidenceSubjectService,
  type UserScope,
} from "@/lib/services/evidence-subject-service";

const currentActor = vi.hoisted(() => ({
  user: {
    id: "default-actor",
    role: "ADMIN" as string,
    companyId: "00000000-0000-0000-0000-000000000001",
    branchId: null as string | null,
    email: "default@test.com",
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: currentActor.user,
      })),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

import { POST, GET, DELETE } from "@/app/api/exceptions/[id]/evidence/route";

describe("EVI-02.b: Integración de Evidencia de Excepciones (V2 DB y V3 Route)", () => {
  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA1 = randomUUID();
  const branchA2 = randomUUID();
  const branchB1 = randomUUID();

  const userAdminA: UserScope = {
    id: randomUUID(),
    role: "ADMIN",
    companyId: companyA,
    branchId: null,
  };

  const userGerenteA1: UserScope = {
    id: randomUUID(),
    role: "GERENTE",
    companyId: companyA,
    branchId: branchA1,
  };

  const userGerenteA2: UserScope = {
    id: randomUUID(),
    role: "GERENTE",
    companyId: companyA,
    branchId: branchA2,
  };

  const userEmpleadoA1: UserScope = {
    id: randomUUID(),
    role: "EMPLEADO",
    companyId: companyA,
    branchId: branchA1,
  };

  const userGerenteB1: UserScope = {
    id: randomUUID(),
    role: "GERENTE",
    companyId: companyB,
    branchId: branchB1,
  };

  const exceptionA1Id = randomUUID();
  const exceptionA2Id = randomUUID();
  const exceptionB1Id = randomUUID();

  function setAuth(scope: UserScope) {
    currentActor.user = {
      id: scope.id,
      role: scope.role,
      companyId: scope.companyId,
      branchId: scope.branchId ?? null,
      email: `${scope.id}@test.com`,
    };
  }

  beforeAll(async () => {
    // 1. Guardias de base de datos aislada
    const testUrl = process.env.TEST_DATABASE_URL;
    expect(testUrl).toBeDefined();
    const host = new URL(testUrl!).hostname.replace(/-pooler(?=\.)/, "");
    expect(host).toBe("ep-cold-morning-bewqoz3o.c-9.us-east-2.aws.neon.tech");

    if (existsSync(".env")) {
      const op = parse(readFileSync(".env")).DATABASE_URL;
      if (op) {
        expect(new URL(op).hostname.replace(/-pooler(?=\.)/, "")).not.toBe(host);
      }
    }

    // 2. Rol pulso_app verificado sin bypass de RLS ni superusuario
    const [role] = (
      await db.execute(
        sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'pulso_app'`
      )
    ).rows as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });

    // 3. DDL aditivo en harness aislado si hiciera falta
    await db.execute(
      sql`ALTER TYPE "public"."evidence_entity_type" ADD VALUE IF NOT EXISTS 'EXCEPTION'`
    );

    // 4. Grants a pulso_app para operaciones del harness
    const tables = ["companies", "branches", "users", "exceptions", "evidence"];
    for (const t of tables) {
      await db.execute(
        sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${t}" TO "pulso_app"`)
      );
    }

    // 5. Sembrado de empresas y sucursales
    await db.insert(companies).values([
      { id: companyA, name: "Empresa EVI-02.b A" },
      { id: companyB, name: "Empresa EVI-02.b B" },
    ]);

    await db.insert(branches).values([
      { id: branchA1, companyId: companyA, name: "Sucursal A1" },
      { id: branchA2, companyId: companyA, name: "Sucursal A2" },
      { id: branchB1, companyId: companyB, name: "Sucursal B1" },
    ]);

    // 6. Sembrado de usuarios
    await db.insert(users).values([
      {
        id: userAdminA.id,
        name: "Admin Empresa A",
        email: `${userAdminA.id}@test.com`,
        emailVerified: false,
        role: "ADMIN",
        companyId: companyA,
        branchId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userGerenteA1.id,
        name: "Gerente Sucursal A1",
        email: `${userGerenteA1.id}@test.com`,
        emailVerified: false,
        role: "GERENTE",
        companyId: companyA,
        branchId: branchA1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userGerenteA2.id,
        name: "Gerente Sucursal A2",
        email: `${userGerenteA2.id}@test.com`,
        emailVerified: false,
        role: "GERENTE",
        companyId: companyA,
        branchId: branchA2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userEmpleadoA1.id,
        name: "Empleado Sucursal A1",
        email: `${userEmpleadoA1.id}@test.com`,
        emailVerified: false,
        role: "EMPLEADO",
        companyId: companyA,
        branchId: branchA1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: userGerenteB1.id,
        name: "Gerente Sucursal B1",
        email: `${userGerenteB1.id}@test.com`,
        emailVerified: false,
        role: "GERENTE",
        companyId: companyB,
        branchId: branchB1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // 7. Sembrado de excepciones reales
    await db.insert(exceptions).values([
      {
        id: exceptionA1Id,
        companyId: companyA,
        branchId: branchA1,
        domain: "operacion",
        qsrCategory: "DINERO",
        severity: "high",
        subjectType: "cash_discrepancy",
        subjectId: randomUUID(),
        reason: "Discrepancia en arqueo de caja A1",
        status: "OPEN",
      },
      {
        id: exceptionA2Id,
        companyId: companyA,
        branchId: branchA2,
        domain: "cumplimiento",
        qsrCategory: "INOCUIDAD",
        severity: "critical",
        subjectType: "temperature_alert",
        subjectId: randomUUID(),
        reason: "Temperatura fuera de rango en cámara fría A2",
        status: "OPEN",
      },
      {
        id: exceptionB1Id,
        companyId: companyB,
        branchId: branchB1,
        domain: "equipos",
        qsrCategory: "ABASTO",
        severity: "warning",
        subjectType: "stockout",
        subjectId: randomUUID(),
        reason: "Desabasto crítico en sucursal B1",
        status: "OPEN",
      },
    ]);
  });

  // 1. V2 DB: Persistencia directa y soft-delete con EvidenceSubjectService
  it("V2 DB: Persistencia directa y soft-delete con EvidenceSubjectService en excepción real", async () => {
    const attached = await EvidenceSubjectService.attachEvidence({
      user: userGerenteA1,
      subjectType: "EXCEPTION",
      entityId: exceptionA1Id,
      mimeType: "image/jpeg",
      url: `local://exceptions/${exceptionA1Id}/ticket-caja.jpg`,
    });

    expect(attached.id).toBeDefined();
    expect(attached.entityType).toBe("EXCEPTION");
    expect(attached.entityId).toBe(exceptionA1Id);
    expect(attached.companyId).toBe(companyA);
    expect(attached.branchId).toBe(branchA1);

    // Consulta activa
    const listBefore = await EvidenceSubjectService.getEvidenceForSubject({
      user: userGerenteA1,
      subjectType: "EXCEPTION",
      entityId: exceptionA1Id,
    });
    expect(listBefore.some((e) => e.id === attached.id)).toBe(true);

    // Soft delete
    const removed = await EvidenceSubjectService.removeEvidence({
      user: userGerenteA1,
      evidenceId: attached.id,
    });
    expect(removed.deleted).toBe(true);

    // Consulta activa post-delete: no debe aparecer
    const listAfter = await EvidenceSubjectService.getEvidenceForSubject({
      user: userGerenteA1,
      subjectType: "EXCEPTION",
      entityId: exceptionA1Id,
    });
    expect(listAfter.some((e) => e.id === attached.id)).toBe(false);

    // Fila permanece en DB con deleted_at no nulo
    const [row] = (
      await db.execute(
        sql`SELECT id, deleted_at as "deletedAt" FROM evidence WHERE id = ${attached.id}`
      )
    ).rows as Array<{ id: string; deletedAt: string | null }>;
    expect(row).toBeDefined();
    expect(row.deletedAt).not.toBeNull();
  });

  // 2. V3 Route POST: Subida de archivo (multipart/form-data)
  let routeEvidenceId = "";
  it("V3 Route POST: Subida de archivo multipart a excepción retorna 201 y persiste en DB", async () => {
    setAuth(userGerenteA1);

    const formData = new FormData();
    const syntheticBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const file = new File([syntheticBytes], "arqueo-ticket.png", {
      type: "image/png",
    });
    formData.set("file", file);

    const req = new Request(
      `http://localhost/api/exceptions/${exceptionA1Id}/evidence`,
      {
        method: "POST",
        body: formData,
      }
    ) as unknown as NextRequest;

    const res = await POST(req, {
      params: Promise.resolve({ id: exceptionA1Id }),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      success: boolean;
      evidence: { id: string; entityType: string; mimeType: string };
    };

    expect(json.success).toBe(true);
    expect(json.evidence).toBeDefined();
    expect(json.evidence.entityType).toBe("EXCEPTION");
    expect(json.evidence.mimeType).toBe("image/png");

    routeEvidenceId = json.evidence.id;

    // Verificar en tabla evidence
    const [dbRow] = (
      await db.execute(
        sql`SELECT id, entity_type as "entityType", mime_type as "mimeType", company_id as "companyId", branch_id as "branchId" FROM evidence WHERE id = ${routeEvidenceId}`
      )
    ).rows as Array<{
      id: string;
      entityType: string;
      mimeType: string;
      companyId: string;
      branchId: string;
    }>;

    expect(dbRow).toBeDefined();
    expect(dbRow.entityType).toBe("EXCEPTION");
    expect(dbRow.companyId).toBe(companyA);
    expect(dbRow.branchId).toBe(branchA1);
  });

  // 3. V3 Route GET: Listado de evidencias
  it("V3 Route GET: Listado de evidencias retorna 200, Cache-Control privado y URLs resueltas", async () => {
    setAuth(userGerenteA1);

    const req = new Request(
      `http://localhost/api/exceptions/${exceptionA1Id}/evidence`,
      {
        method: "GET",
      }
    ) as unknown as NextRequest;

    const res = await GET(req, {
      params: Promise.resolve({ id: exceptionA1Id }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    const json = (await res.json()) as {
      success: boolean;
      items: Array<{ id: string; resolvedUrl?: string; url: string }>;
      total: number;
    };

    expect(json.success).toBe(true);
    expect(json.total).toBeGreaterThanOrEqual(1);
    const found = json.items.find((item) => item.id === routeEvidenceId);
    expect(found).toBeDefined();
    expect(found?.resolvedUrl || found?.url).toBeDefined();
  });

  // 4. V3 Route DELETE: Retiro de evidencia
  it("V3 Route DELETE: Retiro de evidencia retorna 200, soft-delete en DB y ya no la lista", async () => {
    setAuth(userGerenteA1);

    const req = new Request(
      `http://localhost/api/exceptions/${exceptionA1Id}/evidence?evidenceId=${routeEvidenceId}`,
      {
        method: "DELETE",
      }
    ) as unknown as NextRequest;

    const res = await DELETE(req, {
      params: Promise.resolve({ id: exceptionA1Id }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; removedId: string };
    expect(json.success).toBe(true);
    expect(json.removedId).toBe(routeEvidenceId);

    // Verificar en DB que deleted_at no es null
    const [row] = (
      await db.execute(
        sql`SELECT id, deleted_at as "deletedAt" FROM evidence WHERE id = ${routeEvidenceId}`
      )
    ).rows as Array<{ id: string; deletedAt: string | null }>;
    expect(row.deletedAt).not.toBeNull();

    // Comprobar que GET ya no la incluye
    const getReq = new Request(
      `http://localhost/api/exceptions/${exceptionA1Id}/evidence`,
      {
        method: "GET",
      }
    ) as unknown as NextRequest;

    const getRes = await GET(getReq, {
      params: Promise.resolve({ id: exceptionA1Id }),
    });
    const getJson = (await getRes.json()) as {
      items: Array<{ id: string }>;
    };
    expect(getJson.items.some((i) => i.id === routeEvidenceId)).toBe(false);
  });

  // 5. Aislamiento Cross-Tenant: Company B a excepción de Company A -> 404 fail-closed
  it("Aislamiento Cross-Tenant: Usuario de Company B recibe 404 en GET, POST y DELETE contra excepción de Company A", async () => {
    setAuth(userGerenteB1);

    // GET
    const getReq = new Request(
      `http://localhost/api/exceptions/${exceptionA1Id}/evidence`,
      { method: "GET" }
    ) as unknown as NextRequest;
    const getRes = await GET(getReq, {
      params: Promise.resolve({ id: exceptionA1Id }),
    });
    expect(getRes.status).toBe(404);

    // POST
    const formData = new FormData();
    formData.set(
      "file",
      new File([new Uint8Array([1, 2])], "intruder.png", { type: "image/png" })
    );
    const postReq = new Request(
      `http://localhost/api/exceptions/${exceptionA1Id}/evidence`,
      { method: "POST", body: formData }
    ) as unknown as NextRequest;
    const postRes = await POST(postReq, {
      params: Promise.resolve({ id: exceptionA1Id }),
    });
    expect(postRes.status).toBe(404);

    // DELETE
    const delReq = new Request(
      `http://localhost/api/exceptions/${exceptionA1Id}/evidence?evidenceId=${routeEvidenceId}`,
      { method: "DELETE" }
    ) as unknown as NextRequest;
    const delRes = await DELETE(delReq, {
      params: Promise.resolve({ id: exceptionA1Id }),
    });
    expect(delRes.status).toBe(404);
  });

  // 6. Aislamiento Cross-Branch: Gerente A1 a excepción de Branch A2 -> 404 fail-closed
  it("Aislamiento Cross-Branch: Gerente de Branch A1 recibe 404 en GET, POST y DELETE contra excepción de Branch A2", async () => {
    setAuth(userGerenteA1);

    // GET
    const getReq = new Request(
      `http://localhost/api/exceptions/${exceptionA2Id}/evidence`,
      { method: "GET" }
    ) as unknown as NextRequest;
    const getRes = await GET(getReq, {
      params: Promise.resolve({ id: exceptionA2Id }),
    });
    expect(getRes.status).toBe(404);

    // POST
    const formData = new FormData();
    formData.set(
      "file",
      new File([new Uint8Array([1, 2])], "cross-branch.png", {
        type: "image/png",
      })
    );
    const postReq = new Request(
      `http://localhost/api/exceptions/${exceptionA2Id}/evidence`,
      { method: "POST", body: formData }
    ) as unknown as NextRequest;
    const postRes = await POST(postReq, {
      params: Promise.resolve({ id: exceptionA2Id }),
    });
    expect(postRes.status).toBe(404);

    // DELETE
    const delReq = new Request(
      `http://localhost/api/exceptions/${exceptionA2Id}/evidence?evidenceId=${routeEvidenceId}`,
      { method: "DELETE" }
    ) as unknown as NextRequest;
    const delRes = await DELETE(delReq, {
      params: Promise.resolve({ id: exceptionA2Id }),
    });
    expect(delRes.status).toBe(404);
  });

  // 7. Control de Roles: Empleado sin permisos -> 403 Forbidden al intentar POST o DELETE
  it("Control de Roles: Empleado recibe 403 Forbidden en POST y DELETE pero 200 en GET", async () => {
    setAuth(userEmpleadoA1);

    // GET: EMPLEADO tiene permiso 'read' sobre excepciones
    const getReq = new Request(
      `http://localhost/api/exceptions/${exceptionA1Id}/evidence`,
      { method: "GET" }
    ) as unknown as NextRequest;
    const getRes = await GET(getReq, {
      params: Promise.resolve({ id: exceptionA1Id }),
    });
    expect(getRes.status).toBe(200);

    // POST: EMPLEADO carece de 'update' / 'manage'
    const formData = new FormData();
    formData.set(
      "file",
      new File([new Uint8Array([1, 2])], "empleado-doc.pdf", {
        type: "application/pdf",
      })
    );
    const postReq = new Request(
      `http://localhost/api/exceptions/${exceptionA1Id}/evidence`,
      { method: "POST", body: formData }
    ) as unknown as NextRequest;
    const postRes = await POST(postReq, {
      params: Promise.resolve({ id: exceptionA1Id }),
    });
    expect(postRes.status).toBe(403);

    // DELETE: EMPLEADO carece de 'update' / 'manage'
    const delReq = new Request(
      `http://localhost/api/exceptions/${exceptionA1Id}/evidence?evidenceId=${routeEvidenceId}`,
      { method: "DELETE" }
    ) as unknown as NextRequest;
    const delRes = await DELETE(delReq, {
      params: Promise.resolve({ id: exceptionA1Id }),
    });
    expect(delRes.status).toBe(403);
  });

  // 8. Validación de tamaño: archivo > 10MB -> 413 Payload Too Large
  it("Validación de tamaño: archivo que excede 10MB retorna 413 Payload Too Large", async () => {
    setAuth(userGerenteA1);

    // Creamos un archivo sintético que declara 11MB
    const oversizedBytes = new Uint8Array(11 * 1024 * 1024);
    const oversizedFile = new File([oversizedBytes], "archivo-pesado.pdf", {
      type: "application/pdf",
    });

    const formData = new FormData();
    formData.set("file", oversizedFile);

    const req = new Request(
      `http://localhost/api/exceptions/${exceptionA1Id}/evidence`,
      {
        method: "POST",
        body: formData,
      }
    ) as unknown as NextRequest;

    const res = await POST(req, {
      params: Promise.resolve({ id: exceptionA1Id }),
    });

    expect(res.status).toBe(413);
  });

  // 9. Validación de tipo: archivo .exe o script -> 400 Bad Request
  it("Validación de tipo: ejecutables y scripts son rechazados con 400 Bad Request", async () => {
    setAuth(userGerenteA1);

    // Intento con .exe
    const exeFormData = new FormData();
    exeFormData.set(
      "file",
      new File([new Uint8Array([0x4d, 0x5a])], "malware.exe", {
        type: "application/x-msdownload",
      })
    );
    const exeReq = new Request(
      `http://localhost/api/exceptions/${exceptionA1Id}/evidence`,
      { method: "POST", body: exeFormData }
    ) as unknown as NextRequest;
    const exeRes = await POST(exeReq, {
      params: Promise.resolve({ id: exceptionA1Id }),
    });
    expect(exeRes.status).toBe(400);

    // Intento con script shell
    const shFormData = new FormData();
    shFormData.set(
      "file",
      new File([Buffer.from("#!/bin/sh\necho hack")], "script.sh", {
        type: "text/x-shellscript",
      })
    );
    const shReq = new Request(
      `http://localhost/api/exceptions/${exceptionA1Id}/evidence`,
      { method: "POST", body: shFormData }
    ) as unknown as NextRequest;
    const shRes = await POST(shReq, {
      params: Promise.resolve({ id: exceptionA1Id }),
    });
    expect(shRes.status).toBe(400);
  });
});
