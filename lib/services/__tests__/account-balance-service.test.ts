import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  return {
    db: {
      select: vi.fn(),
    },
  };
});

import { db } from "@/lib/db";
import {
    getAccountAnchorStatus,
    getComputedAccountBalances,
} from "../company-bank-account-service";

/**
 * Invariantes aritméticos del saldo computado por cuenta (Fase D):
 * sin servidor ni navegador. La firma del monto ya trae el signo — here the
 * only job is apertura + SUM desde el ancla, y excluir cuentas sin ancla en
 * lugar de inventarles un cero.
 */

const accountsRows = [
    { id: "acc-1", openingBalanceCents: 100000, openingAsOfDate: "2026-01-01" },
    { id: "acc-2", openingBalanceCents: -5000, openingAsOfDate: "2026-02-01" },
    { id: "acc-3", openingBalanceCents: null, openingAsOfDate: null },
];

describe("getComputedAccountBalances", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("saldo computado = apertura + SUM(firmado) desde el ancla; cuenta sin ancla no aparece", async () => {
        const accountsChain = {
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValueOnce(
                    accountsRows.filter((a) => a.openingBalanceCents !== null)
                ),
            }),
        };
        const sumsChain = {
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    groupBy: vi.fn().mockResolvedValueOnce([
                        { accountId: "acc-1", netCents: 25000 },
                        { accountId: "acc-2", netCents: -3000 },
                    ]),
                }),
            }),
        };

        vi.mocked(db.select)
            .mockReturnValueOnce(accountsChain as never)
            .mockReturnValueOnce(sumsChain as never);

        const result = await getComputedAccountBalances("comp-1");

        expect(result.get("acc-1")).toEqual({
            balanceCents: 125000,
            asOfDate: "2026-01-01",
            openingBalanceCents: 100000,
        });
        // Sobregiro: apertura negativa + salidas = más rojo, no un absurdo.
        expect(result.get("acc-2")).toEqual({
            balanceCents: -8000,
            asOfDate: "2026-02-01",
            openingBalanceCents: -5000,
        });
        // La cuenta sin ancla NO existe en el mapa: cero no se inventa.
        expect(result.has("acc-3")).toBe(false);
    });

    it("catálogo sin anclas devuelve mapa vacío sin tocar bank_transactions", async () => {
        const accountsChain = {
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValueOnce([]),
            }),
        };
        vi.mocked(db.select).mockReturnValueOnce(accountsChain as never);

        const result = await getComputedAccountBalances("comp-1");

        expect(result.size).toBe(0);
        // Segunda select no ocurre: no hay nada que sumar.
        expect(vi.mocked(db.select)).toHaveBeenCalledTimes(1);
    });
});

describe("getAccountAnchorStatus (interruptor del cash-flow)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("100% anclado activa la conmutación; 1 cuenta sin ancla la aborta", async () => {
        const fullChain = {
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValueOnce([{ activeCount: 3, anchoredCount: 3 }]),
            }),
        };
        vi.mocked(db.select).mockReturnValueOnce(fullChain as never);
        expect(await getAccountAnchorStatus("comp-1")).toEqual({
            activeCount: 3,
            anchoredCount: 3,
        });

        const partialChain = {
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValueOnce([{ activeCount: 4, anchoredCount: 3 }]),
            }),
        };
        vi.mocked(db.select).mockReturnValueOnce(partialChain as never);
        const partial = await getAccountAnchorStatus("comp-1");
        // 4 activas, 3 ancladas: el fallback resta y debe nombrar el 1 faltante.
        expect(partial.activeCount - partial.anchoredCount).toBe(1);
    });
});
