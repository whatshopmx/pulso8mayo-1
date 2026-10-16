import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { branches, dailySalesCuts, temperatureLogs } from '@/lib/db/schema';
import { CrossBranchService } from '@/lib/services/cross-branch-service';
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

// C30 — V1: la Liga distingue dato real, estimado y ausente. Con el mismo
// conjunto de mocks se recorren los cuatro escenarios que pide el plan:
// conjunto vacío, ventas sin costos, cero real y datos completos.

const B1 = { id: 'b1', name: 'Centro', ownershipType: 'OWNED', franchiseeUserId: null };
const B2 = { id: 'b2', name: 'Norte', ownershipType: 'OWNED', franchiseeUserId: null };

interface Escenario {
  branches: unknown[];
  sales?: unknown[];
  temps?: unknown[];
}

function porTabla(tabla: unknown, agrupado: boolean, opts: Escenario): unknown[] {
  if (tabla === branches) return opts.branches;
  if (tabla === dailySalesCuts) return agrupado ? (opts.sales ?? []) : [];
  if (tabla === temperatureLogs) return opts.temps ?? [];
  return [];
}

function mockDb(opts: Escenario) {
  vi.mocked(db.select).mockImplementation((() => {
    let tabla: unknown;
    const cadena: Record<string, unknown> = {
      from: (t: unknown) => {
        tabla = t;
        return cadena;
      },
      where: () => cadena,
      groupBy: () => Promise.resolve(porTabla(tabla, true, opts)),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(porTabla(tabla, false, opts)).then(resolve, reject),
    };
    return cadena;
  }) as never);
}

/** Un corte con IVA capturado, todo cuadrado. */
const CORTE = {
  branchId: 'b1',
  totalSales: 1_000_000,
  taxSum: 100_000,
  cutsWithTax: 30,
  totalCuts: 30,
  balancedCuts: 30,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTenantOperatingConfig).mockResolvedValue({ tenantType: 'GRUPO_PROPIO' } as never);
  vi.mocked(getFinancialTargets).mockResolvedValue(DEFAULT_FINANCIAL_TARGETS);
  vi.mocked(getVatRatePercent).mockResolvedValue(16);
  vi.mocked(getLaborBurden).mockResolvedValue({
    factorPercent: null,
    stateTaxPercent: null,
    totalPercent: null,
    nota: 'Sin factor de carga capturado.',
  } as never);
  vi.mocked(getFoodCostByBranch).mockResolvedValue([]);
  vi.mocked(getLaborCostByBranch).mockResolvedValue([]);
});

describe('C30 — calidad del dato en la Liga de Sucursales', () => {
  it('conjunto vacío: la ausencia es explícita, no un 31.5/24.5 inventado', async () => {
    mockDb({ branches: [B1] }); // sin ventas, sin costos, sin temperaturas

    const qsr = await CrossBranchService.getBranchQSRRanking('c1', 30);
    const b = qsr.branches[0];

    // Lo que H06 mandaba retirar: porcentajes sectoriales presentados como propios.
    expect(b.foodCostPercent).not.toBe(31.5);
    expect(b.laborCostPercent).not.toBe(24.5);
    expect(b.foodCostPercent).toBeNull();
    expect(b.laborCostPercent).toBeNull();
    expect(b.primeCostPercent).toBeNull();
    expect(b.primeCostStatus).toBeNull();

    // Indicadores de cumplimiento sin evidencia: ausencia, no 100.
    expect(b.nom251ComplianceRate).toBeNull();
    expect(b.cashReconciliationRate).toBeNull();

    expect(b.dataQuality).toBe('MISSING');
    expect(b.quality).toEqual({
      sales: 'MISSING',
      foodCost: 'MISSING',
      laborCost: 'MISSING',
      nom251: 'MISSING',
      cashReconciliation: 'MISSING',
    });
    expect(b.compositeScore).toBeNull();
    expect(b.foodCostSource).toBe('NO_DATA');
    expect(b.laborCostSource).toBe('NO_DATA');

    // Promedio sin observaciones: null, no 0.
    expect(qsr.networkAveragePrimeCost).toBeNull();
    expect(qsr.networkAverageFoodCost).toBeNull();
    expect(qsr.networkAverageLaborCost).toBeNull();
  });

  it('ventas sin costos: la venta es real y el costo ausente, no estimado', async () => {
    mockDb({ branches: [B1], sales: [CORTE] });

    const b = (await CrossBranchService.getBranchQSRRanking('c1', 30)).branches[0];

    expect(b.quality.sales).toBe('MEASURED');
    expect(b.salesBaseKind).toBe('NET_MEASURED');
    // Sin insumos de costo no hay porcentaje, ni siquiera sectorial.
    expect(b.foodCostPercent).toBeNull();
    expect(b.laborCostPercent).toBeNull();
    expect(b.primeCostPercent).toBeNull();
    expect(b.quality.foodCost).toBe('MISSING');
    expect(b.quality.laborCost).toBe('MISSING');
    // El cuadre sí ocurrió (30 de 30): es un 100 real, distinto del default ausente.
    expect(b.cashReconciliationRate).toBe(100);
    expect(b.quality.cashReconciliation).toBe('MEASURED');
    expect(b.dataQuality).not.toBe('MEASURED');
  });

  it('cero real: un costo medido de cero es 0, no ausencia', async () => {
    mockDb({ branches: [B1], sales: [CORTE] });
    vi.mocked(getFoodCostByBranch).mockResolvedValue([
      { branchId: 'b1', foodCostCents: 0, wasteCents: 0, source: 'CONSUMPTION', usedCostFallback: false } as never,
    ]);
    vi.mocked(getLaborCostByBranch).mockResolvedValue([
      { branchId: 'b1', totalCostCents: 0, source: 'MEASURED' } as never,
    ]);

    const b = (await CrossBranchService.getBranchQSRRanking('c1', 30)).branches[0];

    expect(b.foodCostPercent).toBe(0);
    expect(b.laborCostPercent).toBe(0);
    expect(b.primeCostPercent).toBe(0);
    expect(b.primeCostStatus).toBe('HEALTHY');
    expect(b.quality.foodCost).toBe('MEASURED');
    expect(b.quality.laborCost).toBe('MEASURED');
  });

  it('datos completos: todo medido y los promedios salen de las observaciones reales', async () => {
    mockDb({
      branches: [B1],
      sales: [CORTE],
      temps: [{ branchId: 'b1', total: 10, compliant: 9 }],
    });
    vi.mocked(getFoodCostByBranch).mockResolvedValue([
      { branchId: 'b1', foodCostCents: 200_000, wasteCents: 20_000, source: 'CONSUMPTION', usedCostFallback: false } as never,
    ]);
    vi.mocked(getLaborCostByBranch).mockResolvedValue([
      { branchId: 'b1', totalCostCents: 150_000, source: 'MEASURED' } as never,
    ]);

    const qsr = await CrossBranchService.getBranchQSRRanking('c1', 30);
    const b = qsr.branches[0];

    expect(b.salesBaseCents).toBe(900_000);
    expect(b.foodCostPercent).toBe(24.4);
    expect(b.laborCostPercent).toBe(16.7);
    expect(b.primeCostPercent).toBe(41.1);
    expect(b.nom251ComplianceRate).toBe(90);
    expect(b.cashReconciliationRate).toBe(100);
    expect(b.dataQuality).toBe('MEASURED');
    expect(Object.values(b.quality).every((q) => q === 'MEASURED')).toBe(true);
    expect(b.compositeScore).not.toBeNull();
    expect(qsr.networkAveragePrimeCost).toBe(41.1);
  });

  it('el promedio no diluye con sucursales sin dato: promedia sólo las observaciones', async () => {
    mockDb({ branches: [B1, B2], sales: [CORTE] });
    vi.mocked(getFoodCostByBranch).mockResolvedValue([
      { branchId: 'b1', foodCostCents: 200_000, wasteCents: 20_000, source: 'CONSUMPTION', usedCostFallback: false } as never,
    ]);
    vi.mocked(getLaborCostByBranch).mockResolvedValue([
      { branchId: 'b1', totalCostCents: 150_000, source: 'MEASURED' } as never,
    ]);

    const qsr = await CrossBranchService.getBranchQSRRanking('c1', 30);
    const conDato = qsr.branches.find((b) => b.branchId === 'b1')!;
    const sinDato = qsr.branches.find((b) => b.branchId === 'b2')!;

    expect(conDato.primeCostPercent).toBe(41.1);
    expect(sinDato.primeCostPercent).toBeNull();
    // El promedio es el de b1, no el de b1 promediado con un cero inventado.
    expect(qsr.networkAveragePrimeCost).toBe(41.1);
    expect(qsr.networkAverageFoodCost).toBe(24.4);
    expect(qsr.networkAverageLaborCost).toBe(16.7);
    // El score ausente va al final del ranking, sin inventarle un lugar.
    expect(sinDato.rank).toBeGreaterThan(conDato.rank);
    expect(sinDato.compositeScore).toBeNull();
  });

  it('la base estimada se declara: procedencia y nota viajan con el dato', async () => {
    mockDb({
      branches: [B1],
      sales: [{ ...CORTE, taxSum: 0, cutsWithTax: 0 }],
    });
    vi.mocked(getFoodCostByBranch).mockResolvedValue([
      { branchId: 'b1', foodCostCents: 200_000, wasteCents: 20_000, source: 'CONSUMPTION', usedCostFallback: false } as never,
    ]);
    vi.mocked(getLaborCostByBranch).mockResolvedValue([
      { branchId: 'b1', totalCostCents: 150_000, source: 'MEASURED' } as never,
    ]);

    const b = (await CrossBranchService.getBranchQSRRanking('c1', 30)).branches[0];

    expect(b.salesBaseKind).toBe('NET_DERIVED');
    // La base estimada degrada el numerador medido a derivado.
    expect(b.foodCostSource).toBe('DERIVED');
    expect(b.dataQuality).toBe('ESTIMATED');
    expect(b.costNote).toBeTruthy();
  });
});
