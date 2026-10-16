import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { branches, dailySalesCuts, temperatureLogs } from '@/lib/db/schema';
import { CrossBranchService } from '@/lib/services/cross-branch-service';
import { calculateFinancialKPIs } from '@/lib/services/financial-kpi-service';
import { getFoodCostByBranch } from '@/lib/services/food-cost-service';
import { getLaborCostByBranch } from '@/lib/services/labor-cost-service';
import { getVatRatePercent } from '@/lib/services/sales-base';
import { getLaborBurden } from '@/lib/services/labor-burden';
import { getFinancialTargets, getTenantOperatingConfig } from '@/lib/services/tenant-config-service';
import { DEFAULT_FINANCIAL_TARGETS } from '@/lib/services/financial-kpi-types';

vi.mock('@/lib/db', () => ({ db: { select: vi.fn() } }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/services/food-cost-service', () => ({ getFoodCostByBranch: vi.fn() }));
vi.mock('@/lib/services/labor-cost-service', () => ({ getLaborCostByBranch: vi.fn() }));
vi.mock('@/lib/services/labor-burden', () => ({ getLaborBurden: vi.fn() }));
vi.mock('@/lib/services/tenant-config-service', () => ({
  getTenantOperatingConfig: vi.fn(),
  getFinancialTargets: vi.fn(),
}));
vi.mock('@/lib/services/sales-base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/sales-base')>();
  return { ...actual, getVatRatePercent: vi.fn() };
});

// Misma empresa, mismo período y los mismos insumos en los dos motores.
const BRANCH = { id: 'b1', name: 'Centro', ownershipType: 'OWNED', franchiseeUserId: null };
const QSR_SALES = [
  { branchId: 'b1', totalSales: 1_000_000, taxSum: 100_000, cutsWithTax: 30, totalCuts: 30, balancedCuts: 30 },
];
const KPI_AGG = [{ totalSales: 1_000_000, taxSum: 100_000, cutsWithTax: 30, cutsCount: 30 }];

function filasDe(tabla: unknown, agrupado: boolean): unknown[] {
  if (tabla === branches) return [BRANCH];
  if (tabla === temperatureLogs) return [];
  if (tabla === dailySalesCuts) return agrupado ? QSR_SALES : KPI_AGG;
  return [];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.select).mockImplementation((() => {
    let tabla: unknown;
    const cadena: Record<string, unknown> = {
      from: (t: unknown) => { tabla = t; return cadena; },
      where: () => cadena,
      groupBy: () => Promise.resolve(filasDe(tabla, true)),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(filasDe(tabla, false)).then(resolve, reject),
    };
    return cadena;
  }) as never);

  vi.mocked(getTenantOperatingConfig).mockResolvedValue({ tenantType: 'GRUPO_PROPIO' } as never);
  vi.mocked(getFinancialTargets).mockResolvedValue(DEFAULT_FINANCIAL_TARGETS);
  vi.mocked(getVatRatePercent).mockResolvedValue(16);
  vi.mocked(getLaborBurden).mockResolvedValue({
    factorPercent: 10, stateTaxPercent: 10, totalPercent: 20, nota: 'Cifra CARGADA.',
  });
  vi.mocked(getFoodCostByBranch).mockResolvedValue([
    { branchId: 'b1', foodCostCents: 200_000, wasteCents: 20_000, source: 'CONSUMPTION', usedCostFallback: false } as never,
  ]);
  vi.mocked(getLaborCostByBranch).mockResolvedValue([
    { branchId: 'b1', totalCostCents: 150_000, source: 'MEASURED' } as never,
  ]);
});

describe('C29 — Conciliación entre el motor financiero y la Liga de Sucursales', () => {
  it('los dos motores dan el mismo food/labor con los mismos datos', async () => {
    const kpi = await calculateFinancialKPIs({ companyId: 'c1' });
    const qsr = await CrossBranchService.getBranchQSRRanking('c1', 30);
    const sucursal = qsr.branches[0];

    // Base neta compartida: 1,000,000 − 100,000 de IVA medido.
    expect(sucursal.salesBaseCents).toBe(900_000);
    expect(sucursal.salesBaseKind).toBe('NET_MEASURED');

    // Food cost con merma y nómina con carga, sobre la misma base.
    expect(sucursal.foodCostPercent).toBe(kpi.foodCost.percent);
    expect(sucursal.laborCostPercent).toBe(kpi.laborCost.percent);
    expect(sucursal.foodCostPercent).toBe(24.4);
    expect(sucursal.laborCostPercent).toBe(20);
  });

  it('la carga patronal y los objetivos configurados llegan a la Liga', async () => {
    const qsr = await CrossBranchService.getBranchQSRRanking('c1', 30);
    const sucursal = qsr.branches[0];

    // Con carga, la procedencia del agregado baja a DERIVED en ambos motores.
    expect(sucursal.laborCostSource).toBe('DERIVED');
    expect(sucursal.laborCostCents).toBe(180_000);
    // El umbral sale de los objetivos (30+28 / 35+32), no de 60/65.
    expect(qsr.primeCostTargetPercent).toBe(58);
    expect(qsr.primeCostWarnPercent).toBe(67);
    expect(sucursal.primeCostStatus).toBe('HEALTHY');
  });

  it('la base conserva la procedencia cuando el IVA se estima', async () => {
    vi.mocked(getVatRatePercent).mockResolvedValue(16);
    // Ningún corte trae IVA capturado: la base se estima con la tasa del grupo.
    vi.mocked(db.select).mockImplementation((() => {
      let tabla: unknown;
      const cadena: Record<string, unknown> = {
        from: (t: unknown) => { tabla = t; return cadena; },
        where: () => cadena,
        groupBy: () =>
          Promise.resolve(
            tabla === dailySalesCuts
              ? [{ branchId: 'b1', totalSales: 1_000_000, taxSum: 0, cutsWithTax: 0, totalCuts: 30, balancedCuts: 30 }]
              : filasDe(tabla, true)
          ),
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(
            tabla === dailySalesCuts
              ? [{ totalSales: 1_000_000, taxSum: 0, cutsWithTax: 0, cutsCount: 30 }]
              : filasDe(tabla, false)
          ).then(resolve, reject),
      };
      return cadena;
    }) as never);

    const kpi = await calculateFinancialKPIs({ companyId: 'c1' });
    const qsr = await CrossBranchService.getBranchQSRRanking('c1', 30);

    expect(qsr.branches[0].salesBaseKind).toBe('NET_DERIVED');
    expect(qsr.branches[0].foodCostPercent).toBe(kpi.foodCost.percent);
    // La base estimada degrada la procedencia del numerador medido.
    expect(qsr.branches[0].foodCostSource).toBe('DERIVED');
    expect(kpi.foodCost.source).toBe('DERIVED');
  });
});
