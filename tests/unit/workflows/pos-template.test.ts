import { describe, expect, it } from 'vitest';
import { templateLibrary } from '@/templates';

describe('POS closure template installation contract', () => {
  it('retains explicit POS configuration through normalization and JSON persistence', () => {
    const installed = JSON.parse(JSON.stringify(templateLibrary['cierre-sucursal-v2']));
    const step = installed.steps.find((candidate: { id: string }) => candidate.id === 'paso-upload-pos');
    expect(step).toMatchObject({ type: 'TEXT', required: false, config: { posUpload: true } });
    expect(step.description).toContain('revisa el resultado');
    expect(step.description).not.toContain('se completará solo');
  });

  it('does not mark other closure steps or cash-cut links as POS ingestion', () => {
    const closure = templateLibrary['cierre-sucursal-v2'];
    expect(closure.steps.filter(step => step.config?.posUpload === true).map(step => step.id)).toEqual(['paso-upload-pos']);
    expect(templateLibrary['corte-caja-v1'].steps.some(step => step.config?.posUpload === true)).toBe(false);
  });
});
