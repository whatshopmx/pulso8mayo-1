import { describe, expect, it } from 'vitest';
import { buildInitialValues, parseActiveCountId } from '@/lib/inventory/stock-count-launcher';

describe('buildInitialValues', () => {
  it('conserva sólo las categorías con captura y descarta las vacías', () => {
    expect(buildInitialValues({
      Verduras: '{"kind":"stock_count","rows":[{"itemId":"v","batchId":null,"countedQuantity":2}]}',
      Bebidas: '',
      Limpieza: '   ',
    })).toEqual({
      Verduras: '{"kind":"stock_count","rows":[{"itemId":"v","batchId":null,"countedQuantity":2}]}',
    });
  });

  it('sin capturas devuelve un objeto vacío', () => {
    expect(buildInitialValues({ Verduras: '', Bebidas: '' })).toEqual({});
  });
});

describe('parseActiveCountId', () => {
  it('extrae el id del conteo activo del mensaje', () => {
    expect(parseActiveCountId('Ya existe un conteo activo para esta sucursal. ID: 3f2504e0-4f89-11d3-9a0c-0305e82c3301'))
      .toBe('3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  });

  it('devuelve null cuando no hay id o no hay mensaje', () => {
    expect(parseActiveCountId('No se pudo iniciar el conteo')).toBeNull();
    expect(parseActiveCountId(undefined)).toBeNull();
  });
});
