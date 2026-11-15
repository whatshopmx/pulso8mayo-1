import { describe, expect, it, vi } from "vitest";
import {
  EvidenceSubjectService,
  buildEvidenceStorageKey,
  validateEvidenceStorageKey,
  type UserScope,
} from "@/lib/services/evidence-subject-service";
import { ApiError } from "@/lib/api/error";
import type { DbExecutor } from "@/lib/services/fefo-allocator";

// Mock R2 client
vi.mock("@/lib/storage/r2-client", () => ({
  isR2Configured: vi.fn(() => true),
  uploadToR2: vi.fn(async () => {}),
  generatePresignedUrl: vi.fn(async (key: string) => `https://r2.pulso.test/${key}?signed=true`),
}));

describe("EVI-02.a: EvidenceSubjectService — Aislamiento y Control de Acceso", () => {
  const companyA = "aaaaaaaa-0000-4000-8000-000000000001";
  const companyB = "bbbbbbbb-0000-4000-8000-000000000001";
  const branchA1 = "aaaaaaaa-0000-4000-8000-000000000011";
  const branchA2 = "aaaaaaaa-0000-4000-8000-000000000012";

  const userAdminA: UserScope = {
    id: "admin-a",
    role: "ADMIN",
    companyId: companyA,
    branchId: null,
  };

  const userGerenteA1: UserScope = {
    id: "gerente-a1",
    role: "GERENTE",
    companyId: companyA,
    branchId: branchA1,
  };

  const userEmpleadoA1: UserScope = {
    id: "empleado-a1",
    role: "EMPLEADO",
    companyId: companyA,
    branchId: branchA1,
  };

  const userGerenteSinBranch: UserScope = {
    id: "gerente-sin-branch",
    role: "GERENTE",
    companyId: companyA,
    branchId: null,
  };

  const invoiceA1Id = "11111111-0000-4000-8000-000000000001";
  const invoiceCorporateAId = "11111111-0000-4000-8000-000000000002";
  const invoiceB1Id = "11111111-0000-4000-8000-000000000003";

  const paymentRunA1Id = "22222222-0000-4000-8000-000000000001";
  const paymentRunCorporateAId = "22222222-0000-4000-8000-000000000002";
  const paymentItemA1Id = "22222222-0000-4000-8000-000000000003";

  const exceptionA1Id = "33333333-0000-4000-8000-000000000001";

  const saleRecoveryA1Id = "44444444-0000-4000-8000-000000000001";

  // Creación de mock executor con lookup de dominios
  function createDomainMockExecutor() {
    const mockDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => {
            return [];
          }),
          innerJoin: vi.fn(() => ({
            where: vi.fn(async () => []),
          })),
        })),
      })),
      execute: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    } as unknown as DbExecutor;

    return mockDb;
  }

  describe("1. Claves de Almacenamiento Canónicas R2 y Anti-Traversal", () => {
    it("buildEvidenceStorageKey genera la ruta jerárquica canónica correcta", () => {
      const keyBranch = buildEvidenceStorageKey({
        companyId: companyA,
        branchId: branchA1,
        subjectType: "INVOICE",
        entityId: invoiceA1Id,
        evidenceId: "99999999-0000-4000-8000-000000000001",
      });

      expect(keyBranch).toBe(
        `companies/${companyA}/branches/${branchA1}/invoice/${invoiceA1Id}/99999999-0000-4000-8000-000000000001`
      );

      const keyCorporate = buildEvidenceStorageKey({
        companyId: companyA,
        branchId: null,
        subjectType: "PAYMENT",
        entityId: paymentRunCorporateAId,
        evidenceId: "99999999-0000-4000-8000-000000000002",
      });

      expect(keyCorporate).toBe(
        `companies/${companyA}/branches/corporate/payment/${paymentRunCorporateAId}/99999999-0000-4000-8000-000000000002`
      );
    });

    it("validateEvidenceStorageKey aprueba claves canónicas legítimas", () => {
      const key = `companies/${companyA}/branches/${branchA1}/exception/${exceptionA1Id}/99999999-0000-4000-8000-000000000001.pdf`;

      const valid = validateEvidenceStorageKey(key, {
        companyId: companyA,
        branchId: branchA1,
        subjectType: "EXCEPTION",
        entityId: exceptionA1Id,
      });

      expect(valid).toBe(true);
    });

    it("validateEvidenceStorageKey rechaza intentos de path traversal y colisiones maliciosas", () => {
      // Intento ../
      expect(
        validateEvidenceStorageKey(
          `companies/${companyA}/branches/${branchA1}/invoice/${invoiceA1Id}/../../../etc/passwd`,
          {
            companyId: companyA,
            branchId: branchA1,
            subjectType: "INVOICE",
            entityId: invoiceA1Id,
          }
        )
      ).toBe(false);

      // Intento doble slash //
      expect(
        validateEvidenceStorageKey(
          `companies/${companyA}/branches/${branchA1}//invoice/${invoiceA1Id}/99999999-0000-4000-8000-000000000001`,
          {
            companyId: companyA,
            branchId: branchA1,
            subjectType: "INVOICE",
            entityId: invoiceA1Id,
          }
        )
      ).toBe(false);

      // Empresa falsificada en la clave
      expect(
        validateEvidenceStorageKey(
          `companies/${companyB}/branches/${branchA1}/invoice/${invoiceA1Id}/99999999-0000-4000-8000-000000000001`,
          {
            companyId: companyA,
            branchId: branchA1,
            subjectType: "INVOICE",
            entityId: invoiceA1Id,
          }
        )
      ).toBe(false);

      // Sucursal falsificada en la clave
      expect(
        validateEvidenceStorageKey(
          `companies/${companyA}/branches/${branchA2}/invoice/${invoiceA1Id}/99999999-0000-4000-8000-000000000001`,
          {
            companyId: companyA,
            branchId: branchA1,
            subjectType: "INVOICE",
            entityId: invoiceA1Id,
          }
        )
      ).toBe(false);
    });
  });

  describe("2. Control de Permisos por Rol y Capacidad de Dominio", () => {
    it("rol EMPLEADO es denegado al intentar acceder a evidencia de INVOICE o PAYMENT", async () => {
      const executor = createDomainMockExecutor();

      await expect(
        EvidenceSubjectService.validateSubjectAccess(
          {
            user: userEmpleadoA1,
            subjectType: "INVOICE",
            entityId: invoiceA1Id,
          },
          executor
        )
      ).rejects.toThrow(ApiError);

      await expect(
        EvidenceSubjectService.validateSubjectAccess(
          {
            user: userEmpleadoA1,
            subjectType: "PAYMENT",
            entityId: paymentRunA1Id,
          },
          executor
        )
      ).rejects.toThrow(ApiError);
    });

    it("rol EMPLEADO es denegado al intentar acceder a EXCEPTION", async () => {
      const executor = createDomainMockExecutor();

      await expect(
        EvidenceSubjectService.validateSubjectAccess(
          {
            user: userEmpleadoA1,
            subjectType: "EXCEPTION",
            entityId: exceptionA1Id,
          },
          executor
        )
      ).rejects.toThrow(ApiError);
    });

    it("usuario acotado a sucursal sin branchId asignado es denegado con 403 Forbidden (fail-closed)", async () => {
      const executor = createDomainMockExecutor();

      await expect(
        EvidenceSubjectService.validateSubjectAccess(
          {
            user: userGerenteSinBranch,
            subjectType: "INVOICE",
            entityId: invoiceA1Id,
          },
          executor
        )
      ).rejects.toThrow(ApiError);
    });
  });

  describe("3. Aislamiento Multi-Tenant y Acotamiento de Sucursales", () => {
    it("acceso a entidad de otra empresa es denegado con 404 (no filtra existencia)", async () => {
      const executor: DbExecutor = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => []), // No existe para companyA
          })),
        })),
        execute: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      } as unknown as DbExecutor;

      await expect(
        EvidenceSubjectService.validateSubjectAccess(
          {
            user: userAdminA,
            subjectType: "INVOICE",
            entityId: invoiceB1Id,
          },
          executor
        )
      ).rejects.toThrow(ApiError);
    });

    it("Gerente de Sucursal A1 no puede acceder a entidad perteneciente a Sucursal A2", async () => {
      const executor: DbExecutor = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [
              {
                id: invoiceA1Id,
                companyId: companyA,
                branchId: branchA2, // Pertenece a A2
                uuid: "cfdi-uuid-1",
                total: 5000,
              },
            ]),
          })),
        })),
        execute: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      } as unknown as DbExecutor;

      await expect(
        EvidenceSubjectService.validateSubjectAccess(
          {
            user: userGerenteA1, // Está asignado a A1
            subjectType: "INVOICE",
            entityId: invoiceA1Id,
          },
          executor
        )
      ).rejects.toThrow(ApiError);
    });

    it("Gerente de Sucursal A1 no puede acceder a entidad corporativa (branchId = null)", async () => {
      const executor: DbExecutor = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [
              {
                id: invoiceCorporateAId,
                companyId: companyA,
                branchId: null, // Corporativa / Holding
                uuid: "cfdi-corp-uuid",
                total: 15000,
              },
            ]),
          })),
        })),
        execute: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      } as unknown as DbExecutor;

      await expect(
        EvidenceSubjectService.validateSubjectAccess(
          {
            user: userGerenteA1,
            subjectType: "INVOICE",
            entityId: invoiceCorporateAId,
          },
          executor
        )
      ).rejects.toThrow(ApiError);
    });

    it("Admin corporativo puede acceder a entidades de cualquier sucursal y corporativas", async () => {
      // 1. Acceso a branch A1
      const executorA1: DbExecutor = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [
              {
                id: invoiceA1Id,
                companyId: companyA,
                branchId: branchA1,
                uuid: "cfdi-uuid-1",
                total: 5000,
              },
            ]),
          })),
        })),
        execute: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      } as unknown as DbExecutor;

      const resA1 = await EvidenceSubjectService.validateSubjectAccess(
        {
          user: userAdminA,
          subjectType: "INVOICE",
          entityId: invoiceA1Id,
        },
        executorA1
      );

      expect(resA1.allowed).toBe(true);
      expect(resA1.subject.branchId).toBe(branchA1);

      // 2. Acceso a entidad corporativa
      const executorCorp: DbExecutor = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [
              {
                id: invoiceCorporateAId,
                companyId: companyA,
                branchId: null,
                uuid: "cfdi-corp-uuid",
                total: 15000,
              },
            ]),
          })),
        })),
        execute: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      } as unknown as DbExecutor;

      const resCorp = await EvidenceSubjectService.validateSubjectAccess(
        {
          user: userAdminA,
          subjectType: "INVOICE",
          entityId: invoiceCorporateAId,
        },
        executorCorp
      );

      expect(resCorp.allowed).toBe(true);
      expect(resCorp.subject.branchId).toBeNull();
    });
  });

  describe("4. Sujetos PAYMENT (PaymentRun y PaymentRunItem)", () => {
    it("resuelve paymentRun correctamente cuando coincide el ID directo", async () => {
      const executor: DbExecutor = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [
              {
                id: paymentRunA1Id,
                companyId: companyA,
                branchId: branchA1,
                title: "Corrida Quincenal Pago Proveedores",
              },
            ]),
          })),
        })),
        execute: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      } as unknown as DbExecutor;

      const result = await EvidenceSubjectService.validateSubjectAccess(
        {
          user: userGerenteA1,
          subjectType: "PAYMENT",
          entityId: paymentRunA1Id,
        },
        executor
      );

      expect(result.allowed).toBe(true);
      expect(result.subject.subjectType).toBe("PAYMENT");
      expect(result.subject.entityId).toBe(paymentRunA1Id);
      expect(result.subject.branchId).toBe(branchA1);
    });

    it("resuelve paymentRunItem enlazando a su corrida si el ID es de una partida", async () => {
      let callCount = 0;
      const executor: DbExecutor = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => {
              callCount++;
              if (callCount === 1) return []; // No está en paymentRuns
              return [];
            }),
            innerJoin: vi.fn(() => ({
              where: vi.fn(async () => [
                {
                  id: paymentItemA1Id,
                  companyId: companyA,
                  branchId: branchA1,
                  itemType: "INVOICE",
                },
              ]),
            })),
          })),
        })),
        execute: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      } as unknown as DbExecutor;

      const result = await EvidenceSubjectService.validateSubjectAccess(
        {
          user: userGerenteA1,
          subjectType: "PAYMENT",
          entityId: paymentItemA1Id,
        },
        executor
      );

      expect(result.allowed).toBe(true);
      expect(result.subject.subjectType).toBe("PAYMENT");
      expect(result.subject.entityId).toBe(paymentItemA1Id);
      expect(result.subject.branchId).toBe(branchA1);
    });
  });

  describe("5. Sujeto EXCEPTION", () => {
    it("resuelve excepción válidamente para usuario autorizado", async () => {
      const executor: DbExecutor = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [
              {
                id: exceptionA1Id,
                companyId: companyA,
                branchId: branchA1,
                domain: "INVENTORY",
                reason: "Discrepancia en merma de corte",
              },
            ]),
          })),
        })),
        execute: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      } as unknown as DbExecutor;

      const result = await EvidenceSubjectService.validateSubjectAccess(
        {
          user: userGerenteA1,
          subjectType: "EXCEPTION",
          entityId: exceptionA1Id,
        },
        executor
      );

      expect(result.allowed).toBe(true);
      expect(result.subject.subjectType).toBe("EXCEPTION");
      expect(result.subject.entityId).toBe(exceptionA1Id);
      expect(result.subject.branchId).toBe(branchA1);
      expect(result.subject.metadata?.reason).toBe("Discrepancia en merma de corte");
    });
  });

  describe("6. Preservación de Sujeto SALE_RECOVERY", () => {
    it("resuelve venta de recuperación histórica respetando permisos de inventario", async () => {
      const executor: DbExecutor = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [
              {
                id: saleRecoveryA1Id,
                companyId: companyA,
                branchId: branchA1,
              },
            ]),
          })),
        })),
        execute: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      } as unknown as DbExecutor;

      const result = await EvidenceSubjectService.validateSubjectAccess(
        {
          user: userGerenteA1,
          subjectType: "SALE_RECOVERY",
          entityId: saleRecoveryA1Id,
        },
        executor
      );

      expect(result.allowed).toBe(true);
      expect(result.subject.subjectType).toBe("SALE_RECOVERY");
      expect(result.subject.entityId).toBe(saleRecoveryA1Id);
      expect(result.subject.branchId).toBe(branchA1);
    });
  });

  describe("7. Inserción y Consulta de Evidencias (attachEvidence y getEvidenceForSubject)", () => {
    it("attachEvidence inserta evidencia con almacenamiento privado y clave canónica", async () => {
      const executor: DbExecutor = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [
              {
                id: invoiceA1Id,
                companyId: companyA,
                branchId: branchA1,
                uuid: "cfdi-1234",
                total: 2500,
              },
            ]),
          })),
        })),
        execute: vi.fn(async () => {
          return {
            rows: [
              {
                id: "evid-001",
                companyId: companyA,
                branchId: branchA1,
                entityType: "INVOICE",
                entityId: invoiceA1Id,
                kind: "FILE",
                mimeType: "application/pdf",
                url: `companies/${companyA}/branches/${branchA1}/invoice/${invoiceA1Id}/evid-001`,
                storageKey: `companies/${companyA}/branches/${branchA1}/invoice/${invoiceA1Id}/evid-001`,
                aiMetadata: null,
                createdBy: userGerenteA1.id,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
              },
            ],
            rowCount: 1,
          };
        }),
      } as unknown as DbExecutor;

      const record = await EvidenceSubjectService.attachEvidence(
        {
          user: userGerenteA1,
          subjectType: "INVOICE",
          entityId: invoiceA1Id,
          mimeType: "application/pdf",
          buffer: Buffer.from("PDF-SYNTHETIC-CONTENT"),
        },
        executor
      );

      expect(record.id).toBe("evid-001");
      expect(record.entityType).toBe("INVOICE");
      expect(record.kind).toBe("FILE");
      expect(record.storageKey).toContain(`companies/${companyA}/branches/${branchA1}/invoice/${invoiceA1Id}/`);
    });

    it("getEvidenceForSubject excluye evidencias con borrado lógico por defecto", async () => {
      let executedSql = "";
      const executor: DbExecutor = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [
              {
                id: exceptionA1Id,
                companyId: companyA,
                branchId: branchA1,
                domain: "INVENTORY",
                reason: "Merma anómala",
              },
            ]),
          })),
        })),
        execute: vi.fn(async (q: unknown) => {
          executedSql = JSON.stringify(q);
          return { rows: [], rowCount: 0 };
        }),
      } as unknown as DbExecutor;

      await EvidenceSubjectService.getEvidenceForSubject(
        {
          user: userGerenteA1,
          subjectType: "EXCEPTION",
          entityId: exceptionA1Id,
        },
        executor
      );

      expect(executedSql).toContain("deleted_at IS NULL");
    });
  });

  describe("8. Presigned URL y Borrado Lógico", () => {
    it("getEvidencePresignedUrl genera URL firmada para evidencia autorizada", async () => {
      const evidId = "99999999-0000-4000-8000-000000000001";
      const key = `companies/${companyA}/branches/${branchA1}/invoice/${invoiceA1Id}/${evidId}`;

      const executor: DbExecutor = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [
              {
                id: invoiceA1Id,
                companyId: companyA,
                branchId: branchA1,
                uuid: "cfdi-1234",
                total: 2500,
              },
            ]),
          })),
        })),
        execute: vi.fn(async () => {
          return {
            rows: [
              {
                id: evidId,
                companyId: companyA,
                branchId: branchA1,
                entityType: "INVOICE",
                entityId: invoiceA1Id,
                kind: "PHOTO",
                mimeType: "image/jpeg",
                url: key,
                storageKey: key,
                aiMetadata: null,
                createdBy: userGerenteA1.id,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
              },
            ],
            rowCount: 1,
          };
        }),
      } as unknown as DbExecutor;

      const result = await EvidenceSubjectService.getEvidencePresignedUrl(
        {
          user: userGerenteA1,
          evidenceId: evidId,
        },
        executor
      );

      expect(result.id).toBe(evidId);
      expect(result.url).toContain("https://r2.pulso.test/");
      expect(result.url).toContain(key);
    });

    it("removeEvidence ejecuta soft delete actualizando deleted_at", async () => {
      const evidId = "99999999-0000-4000-8000-000000000001";
      let updateExecuted = false;

      const executor: DbExecutor = {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [
              {
                id: invoiceA1Id,
                companyId: companyA,
                branchId: branchA1,
                uuid: "cfdi-1234",
                total: 2500,
              },
            ]),
          })),
        })),
        execute: vi.fn(async (q: unknown) => {
          const s = JSON.stringify(q);
          if (s.includes("UPDATE evidence") || s.includes("update evidence")) {
            updateExecuted = true;
            return { rows: [], rowCount: 1 };
          }
          return {
            rows: [
              {
                id: evidId,
                companyId: companyA,
                branchId: branchA1,
                entityType: "INVOICE",
                entityId: invoiceA1Id,
                deletedAt: null,
              },
            ],
            rowCount: 1,
          };
        }),
      } as unknown as DbExecutor;

      const res = await EvidenceSubjectService.removeEvidence(
        {
          user: userGerenteA1,
          evidenceId: evidId,
        },
        executor
      );

      expect(res.id).toBe(evidId);
      expect(res.deleted).toBe(true);
      expect(updateExecuted).toBe(true);
    });
  });
});
