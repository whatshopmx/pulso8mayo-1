import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  inserted: [] as unknown[],
  scope: null as unknown,
}));

vi.mock("@/lib/services/accounting/sales-cut-capture", () => ({
  persistSalesCutInScope: async (
    scope: unknown,
    operation: (writer: unknown) => Promise<unknown>
  ) => {
    captured.scope = scope;
    const writer = {
      select: () => ({
        from: () => ({
          where: async () => [],
        }),
      }),
      insert: () => ({
        values: (rows: unknown) => {
          captured.inserted.push(rows);
          return {
            returning: async () => [
              { id: "r1000000-0000-4000-8000-000000000001", channel: "TOTAL", status: "VALIDATED", totalSales: 1000 },
            ],
          };
        },
      }),
    };
    return operation(writer);
  },
}));

import {
  ingestSalesCut,
  SalesIngestionError,
  type BuildResult,
} from "@/lib/services/sales-ingestion-service";

const companyId = "c1000000-0000-4000-8000-000000000001";
const branchId = "b1000000-0000-4000-8000-000000000001";
const rawFileUrl = `companies/${companyId}/branches/${branchId}/pos/2026-11-12/1_corte.csv`;

const precomputed: BuildResult = {
  fileShape: "summary",
  businessDate: "2026-11-12",
  cuts: [
    {
      channel: "TOTAL",
      data: {
        businessDate: "2026-11-12",
        totalSales: 1000,
        cashSales: 1000,
        cardSales: null,
        otherPayments: null,
        ticketCount: 2,
        taxAmount: null,
        discounts: null,
        cancellations: null,
        aggregatorSales: null,
      },
    },
  ],
  issues: [],
  errors: [],
  mapping: [],
  previewRows: [],
};

beforeEach(() => {
  captured.inserted.length = 0;
  captured.scope = null;
});

describe("ingestSalesCut con resultado precomputado", () => {
  it("reutiliza el build del preview y persiste su fecha y la key durable", async () => {
    const result = await ingestSalesCut({
      companyId,
      branchId,
      // El archivo no es parseable: si el servicio volviera a parsear, lanzaría
      // UNSUPPORTED_FORMAT en vez de llegar a la persistencia.
      buffer: Buffer.alloc(0),
      fileName: "corte.pdf",
      shift: "MATUTINO",
      source: "UPLOAD",
      businessDate: "2026-11-10",
      receivedBy: "u1000000-0000-4000-8000-000000000001",
      rawFileUrl,
      precomputed,
    });

    expect(result.businessDate).toBe("2026-11-12");
    expect(result.fileName).toBe("corte.pdf");
    expect(result.status).toBe("VALIDATED");
    expect(captured.scope).toEqual({
      companyId,
      branchId,
      actorId: "u1000000-0000-4000-8000-000000000001",
      businessDate: "2026-11-12",
    });
    expect(captured.inserted[0]).toMatchObject([
      {
        companyId,
        branchId,
        businessDate: "2026-11-12",
        rawFileUrl,
        channel: "TOTAL",
        source: "UPLOAD",
        status: "VALIDATED",
      },
    ]);
  });

  it("sin precomputed sigue parseando y rechazando el archivo ilegible", async () => {
    await expect(
      ingestSalesCut({
        companyId,
        branchId,
        buffer: Buffer.alloc(0),
        fileName: "corte.pdf",
        shift: "MATUTINO",
        source: "UPLOAD",
      })
    ).rejects.toBeInstanceOf(SalesIngestionError);
    expect(captured.inserted).toHaveLength(0);
  });
});
