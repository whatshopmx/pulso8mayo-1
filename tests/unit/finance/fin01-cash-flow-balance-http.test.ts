import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockGetCashFlowProjection, mockRequirePermissionApi } = vi.hoisted(() => ({
  mockGetCashFlowProjection: vi.fn(),
  mockRequirePermissionApi: vi.fn(),
}));

vi.mock("@/lib/rbac/abac", () => ({
  requirePermissionApi: mockRequirePermissionApi,
}));

vi.mock("@/lib/rbac/masking", () => ({
  maskSensitive: <T,>(payload: T) => payload,
}));

vi.mock("@/lib/services/cash-flow-service", () => ({
  getCashFlowProjection: mockGetCashFlowProjection,
}));

import { GET as getCashFlowRoute } from "@/app/api/finance/cash-flow/route";
import { CashFlowHero } from "@/components/finance/cash-flow-hero";
import {
  CASH_FLOW_PROJECTION_DISCLAIMER,
  type CashFlowProjectionMeta,
} from "@/lib/services/cash-flow-balance-rules";
import type { CashFlowProjection } from "@/components/finance/cash-flow-calendar";

function makeProjection(overrides: Partial<CashFlowProjection>): CashFlowProjection {
  return {
    days: [
      {
        date: "2026-11-25",
        projectedInflowCents: 100_000,
        projectedOutflowCents: 40_000,
        netFlowCents: 60_000,
        cumulativeBalanceCents: 680_000,
        outflowItemsCount: 1,
        hasHighConcentration: false,
      },
    ],
    outflowItems: [],
    categorySummary: [],
    weeklyAggregation: [],
    overdueItems: [],
    upcomingItems: [],
    initialBalanceCents: 620_000,
    openingBalance: {
      source: "ACCOUNTS",
      balanceSource: "BANK_RECONCILED",
      sourceLabel: "Saldo bancario conciliado",
      isBankAnchored: true,
      reconciledBalanceCents: 620_000,
      unmatchedBankDeltaCents: -45_000,
      unmatchedBankCount: 2,
      asOfDate: "2026-11-20",
      ageInDays: 5,
      isStale: false,
      accountBreakdown: [
        {
          id: "acc-1",
          label: "Cuenta Operativa",
          bankName: "BBVA",
          accountLastFour: "4321",
          openingAsOfDate: "2026-11-01",
          asOfDate: "2026-11-20",
          openingBalanceCents: 500_000,
          reconciledBalanceCents: 620_000,
          statementBalanceCents: 575_000,
          unmatchedDeltaCents: -45_000,
          unmatchedCount: 2,
          balanceCents: 620_000,
        },
      ],
    },
    projectionMeta: {
      isEstimate: true,
      label: "Proyección estimada",
      hasAbsoluteBalance: true,
      hasBankAnchor: true,
      disclaimer: CASH_FLOW_PROJECTION_DISCLAIMER,
    } satisfies CashFlowProjectionMeta,
    inflow: {
      basis: "SEASONAL",
      historyDays: 28,
      lookbackDays: 56,
      avgDailyInflowCents: 100_000,
    },
    scope: { branchId: null, branchName: null },
    ...overrides,
  };
}

describe("FIN-01 — Aceptación V3 HTTP y UI: saldo conciliado vs caja proyectada", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePermissionApi.mockResolvedValue({
      ctx: {
        userCompanyId: "11111111-1111-4111-8111-111111111111",
        userRole: "ADMIN",
        userBranchId: null,
      },
      decision: { allow: true },
    });
  });

  it("GET /api/finance/cash-flow y UI con ancla bancaria declaran fecha, cuenta, fuente conciliada y etiquetan la proyección como estimación", async () => {
    const anchored = makeProjection({});
    mockGetCashFlowProjection.mockResolvedValue(anchored);

    const req = new NextRequest("http://localhost:3000/api/finance/cash-flow?days=30");
    const res = await getCashFlowRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.openingBalance).toMatchObject({
      source: "ACCOUNTS",
      balanceSource: "BANK_RECONCILED",
      sourceLabel: "Saldo bancario conciliado",
      isBankAnchored: true,
      asOfDate: "2026-11-20",
      reconciledBalanceCents: 620_000,
      unmatchedBankDeltaCents: -45_000,
      unmatchedBankCount: 2,
    });
    expect(json.data.projectionMeta).toMatchObject({
      isEstimate: true,
      label: "Proyección estimada",
      hasAbsoluteBalance: true,
      hasBankAnchor: true,
    });

    const html = renderToStaticMarkup(
      React.createElement(CashFlowHero, {
        projection: json.data,
        horizonDays: 30,
      }),
    );

    // Declara explícitamente fuente, fecha y cuenta del saldo conciliado
    expect(html).toContain("Saldo bancario conciliado");
    expect(html).toContain("2026-11-20");
    expect(html).toContain("BBVA · Cuenta Operativa ····4321");
    expect(html).toContain("movimiento(s) bancario(s) importado(s) sin conciliar");

    // Proyección identificada explícitamente como estimación
    expect(html).toContain("Caja Proyectada (Estimación)");
    expect(html).toContain("Estimación operativa");
    expect(html).toContain("Saldo Mínimo Proyectado (Estimación)");
  });

  it("GET /api/finance/cash-flow y UI sin ancla bancaria NO calculan saldo absoluto aparente ni runway aparente, y bloquean alcance NONE (403)", async () => {
    const unanchored = makeProjection({
      initialBalanceCents: null,
      days: [
        {
          date: "2026-11-25",
          projectedInflowCents: 100_000,
          projectedOutflowCents: 40_000,
          netFlowCents: 60_000,
          cumulativeBalanceCents: null,
          outflowItemsCount: 1,
          hasHighConcentration: false,
        },
      ],
      openingBalance: {
        source: "NONE",
        balanceSource: "NO_ANCHOR",
        sourceLabel: "Sin ancla bancaria",
        isBankAnchored: false,
        reconciledBalanceCents: null,
        unmatchedBankDeltaCents: 0,
        unmatchedBankCount: 0,
        asOfDate: null,
        ageInDays: null,
        isStale: false,
        accountBreakdown: null,
        unanchoredAccountsCount: 2,
      },
      projectionMeta: {
        isEstimate: true,
        label: "Proyección estimada",
        hasAbsoluteBalance: false,
        hasBankAnchor: false,
        disclaimer: CASH_FLOW_PROJECTION_DISCLAIMER,
      },
    });
    mockGetCashFlowProjection.mockResolvedValue(unanchored);

    const req = new NextRequest("http://localhost:3000/api/finance/cash-flow?days=30");
    const res = await getCashFlowRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.data.initialBalanceCents).toBeNull();
    expect(json.data.openingBalance.isBankAnchored).toBe(false);
    expect(json.data.openingBalance.asOfDate).toBeNull();
    expect(json.data.days[0].cumulativeBalanceCents).toBeNull();
    expect(json.data.projectionMeta.hasAbsoluteBalance).toBe(false);

    const html = renderToStaticMarkup(
      React.createElement(CashFlowHero, {
        projection: json.data,
        horizonDays: 30,
      }),
    );

    expect(html).toContain("Sin ancla bancaria");
    expect(html).toContain("Sin saldo base");
    expect(html).toContain("Sin ancla no se calcula saldo aparente");
    expect(html).not.toContain("30+ Días");
    expect(html).not.toContain("Cobertura Estable");
    expect(html).not.toContain("$0.00");

    // Gerente sin sucursal asignada -> 403 Forbidden
    mockRequirePermissionApi.mockResolvedValueOnce({
      ctx: {
        userCompanyId: "11111111-1111-4111-8111-111111111111",
        userRole: "MANAGER",
        userBranchId: null,
      },
      decision: { allow: true },
    });
    const forbiddenRes = await getCashFlowRoute(req);
    expect(forbiddenRes.status).toBe(403);
  });
});
