import { describe, expect, it } from 'vitest';
import {
  aplicarCargaLaboral,
  calcularCostoPorcentual,
  degradarPorBase,
  foodSourceToLineSource,
  laborSourceToLineSource,
  porcentajeSobreBase,
} from '@/lib/services/branch-cost-metrics';
import { DEFAULT_FINANCIAL_TARGETS } from '@/lib/services/financial-kpi-types';
import type { LaborBurden } from '@/lib/services/labor-burden';

const sinCarga: LaborBurden = {
  factorPercent: null,
  stateTaxPercent: null,
  totalPercent: null,
  nota: 'bruto',
};

const conCarga: LaborBurden = {
  factorPercent: 10,
  stateTaxPercent: 10,
  totalPercent: 20,
  nota: 'cargado',
};

describe('C29.1 — Definición compartida de porcentajes de costo', () => {
  it('mapea la procedencia del food cost con la regla de pnl-service', () => {
    expect(foodSourceToLineSource('CONSUMPTION', false)).toBe('MEASURED');
    expect(foodSourceToLineSource('CONSUMPTION', true)).toBe('DERIVED');
    expect(foodSourceToLineSource('PURCHASES', false)).toBe('DERIVED');
    expect(foodSourceToLineSource('INVENTORY_DIFF', false)).toBe('DERIVED');
    expect(foodSourceToLineSource('SECTOR_DEFAULT', false)).toBe('SECTOR_DEFAULT');
    expect(foodSourceToLineSource('NO_DATA', false)).toBe('NO_DATA');
    expect(foodSourceToLineSource('LO_QUE_SEA', false)).toBe('NO_DATA');
  });

  it('mapea la procedencia de la nómina: la plantilla teórica es DERIVED', () => {
    expect(laborSourceToLineSource('MEASURED')).toBe('MEASURED');
    expect(laborSourceToLineSource('CONTRACT_ONLY')).toBe('DERIVED');
    expect(laborSourceToLineSource('SECTOR_DEFAULT')).toBe('SECTOR_DEFAULT');
    expect(laborSourceToLineSource('NO_DATA')).toBe('NO_DATA');
  });

  it('el divisor no medido degrada el porcentaje; NO_DATA nunca se fortalece', () => {
    expect(degradarPorBase('MEASURED', 'NET_MEASURED')).toBe('MEASURED');
    expect(degradarPorBase('MEASURED', 'NET_DERIVED')).toBe('DERIVED');
    expect(degradarPorBase('MEASURED', 'GROSS_DECLARED')).toBe('DERIVED');
    expect(degradarPorBase('NO_DATA', 'NET_DERIVED')).toBe('NO_DATA');
  });

  it('sin factor de carga no toca el importe y con factor lo incrementa', () => {
    expect(aplicarCargaLaboral(200_000, sinCarga)).toBe(200_000);
    expect(aplicarCargaLaboral(200_000, conCarga)).toBe(240_000);
  });

  it('no calcula porcentaje si no hay base o si el renglón está ausente', () => {
    expect(porcentajeSobreBase(1_000, 0, 'MEASURED')).toBeNull();
    expect(porcentajeSobreBase(1_000, 10_000, 'NO_DATA')).toBeNull();
    expect(porcentajeSobreBase(1_000, 10_000, 'MEASURED')).toBe(10);
  });

  it('calcula food, labor y prime con la misma base, carga y objetivos', () => {
    const r = calcularCostoPorcentual({
      baseCents: 1_000_000,
      salesBaseKind: 'NET_MEASURED',
      foodCostCents: 300_000,
      laborCostCents: 200_000,
      foodSource: 'MEASURED',
      laborSource: 'MEASURED',
      burden: conCarga,
      targets: DEFAULT_FINANCIAL_TARGETS,
    });

    expect(r.foodPercent).toBe(30);
    expect(r.foodStatus).toBe('OK');
    expect(r.laborCostCargadoCents).toBe(240_000);
    expect(r.laborPercent).toBe(24);
    expect(r.laborStatus).toBe('OK');
    expect(r.combinedCostPercent).toBe(54);
    expect(r.healthyMarginPercent).toBe(46);
    expect(r.healthyMarginStatus).toBe('OK');
    expect(r.foodSource).toBe('MEASURED');
    // La carga es un supuesto declarado: el agregado baja a DERIVED.
    expect(r.laborSource).toBe('DERIVED');
  });

  it('sin carga patronal el semáforo de nómina no pinta', () => {
    const r = calcularCostoPorcentual({
      baseCents: 1_000_000,
      salesBaseKind: 'NET_MEASURED',
      foodCostCents: 300_000,
      laborCostCents: 200_000,
      foodSource: 'MEASURED',
      laborSource: 'MEASURED',
      burden: sinCarga,
      targets: DEFAULT_FINANCIAL_TARGETS,
    });

    expect(r.laborPercent).toBe(20);
    expect(r.laborStatus).toBeNull();
    expect(r.laborSource).toBe('MEASURED');
  });

  it('un renglón ausente deja el combinado en null, nunca en un porcentaje inventado', () => {
    const r = calcularCostoPorcentual({
      baseCents: 1_000_000,
      salesBaseKind: 'NET_MEASURED',
      foodCostCents: 0,
      laborCostCents: 200_000,
      foodSource: 'NO_DATA',
      laborSource: 'MEASURED',
      burden: sinCarga,
      targets: DEFAULT_FINANCIAL_TARGETS,
    });

    expect(r.foodPercent).toBeNull();
    expect(r.foodStatus).toBeNull();
    expect(r.combinedCostPercent).toBeNull();
    expect(r.healthyMarginPercent).toBeNull();
    expect(r.healthyMarginStatus).toBeNull();
  });

  it('aplica los objetivos del inquilino, no constantes del módulo', () => {
    const exigente = {
      ...DEFAULT_FINANCIAL_TARGETS,
      foodCostTargetPercent: 25,
      foodCostWarnPercent: 28,
    };
    const r = calcularCostoPorcentual({
      baseCents: 1_000_000,
      salesBaseKind: 'NET_MEASURED',
      foodCostCents: 300_000,
      laborCostCents: 200_000,
      foodSource: 'MEASURED',
      laborSource: 'MEASURED',
      burden: sinCarga,
      targets: exigente,
    });

    expect(r.foodStatus).toBe('CRITICAL');
  });

  it('redondea a un decimal igual que el motor financiero', () => {
    const r = calcularCostoPorcentual({
      baseCents: 3,
      salesBaseKind: 'NET_MEASURED',
      foodCostCents: 1,
      laborCostCents: 0,
      foodSource: 'MEASURED',
      laborSource: 'MEASURED',
      burden: sinCarga,
      targets: DEFAULT_FINANCIAL_TARGETS,
    });

    expect(r.foodPercent).toBe(33.3);
  });
});
