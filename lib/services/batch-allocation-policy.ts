/**
 * FEFO-04A: planificación pura, sin leer ni escribir inventario.
 * El servidor debe cargar empresa/sucursal/producto autorizados, pasar su reloj
 * y revalidar bajo bloqueo antes de descontar. No sustituye permisos ni locks.
 * expirationDate es el instante límite ya resuelto: no infiere fechas civiles.
 */
export interface BatchCandidate {
  id: string;
  companyId: string;
  branchId: string;
  itemId: string;
  status: string | null;
  currentQuantity: string | number;
  unitCost: number | null;
  expirationDate: Date | null;
  receivedAt: Date | null;
  createdAt: Date | null;
}

export interface AllocationRequest {
  companyId: string;
  branchId: string;
  itemId: string;
  quantity: string | number;
  /** Reloj del servidor, obligatorio; el motor no usa el reloj del navegador. */
  now: Date;
  policy?: { strategy: 'FEFO' | 'FIFO'; expiration: 'REQUIRED' | 'NONE' | 'UNKNOWN' };
  /** Selección explícita: nunca sustituir este ID por otro lote. */
  batchId?: string;
}

export interface BatchAllocationPlan {
  allocations: { batchId: string; quantity: number; unitCost: number | null }[];
  requestedQuantity: number;
  allocatedQuantity: number;
  shortfallQuantity: number;
}

const SCALE = 10_000;
const MAX_SCALED = 999_999_999_999; // numeric(12,4); seguro como entero de JS.

/** No redondear decimales de negocio; sólo tolerar ruido binario de number. */
function scaledQuantity(value: string | number): number | null {
  let scaled: number;
  if (typeof value === 'string') {
    if (!/^\d+(?:\.\d{1,4})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    scaled = Number(whole) * SCALE + Number(fraction.padEnd(4, '0'));
  } else {
    if (!Number.isFinite(value) || value < 0) return null;
    const raw = value * SCALE;
    scaled = Math.round(raw);
    if (Math.abs(raw - scaled) > Math.max(1, Math.abs(raw)) * Number.EPSILON * 4) return null;
  }
  return Number.isSafeInteger(scaled) && scaled >= 0 && scaled <= MAX_SCALED ? scaled : null;
}

function validDate(date: Date | null): boolean {
  return date === null || (date instanceof Date && Number.isFinite(date.getTime()));
}

function compare(a: number | string, b: number | string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * Devuelve sólo asignación elegible y faltante separado, sin inventar stock.
 * La salida física debe rechazar faltante dentro de su transacción; la venta
 * teórica debe persistirlo explícitamente. Ningún saldo se cambia aquí.
 */
export function allocateEligibleBatches(batches: readonly BatchCandidate[], request: AllocationRequest): BatchAllocationPlan {
  const requested = scaledQuantity(request.quantity);
  if (requested === null || requested <= 0) throw new Error('Cantidad inválida: usa numeric(12,4) positivo');
  if (!request.now || !validDate(request.now)) throw new Error('Se requiere un instante de servidor válido');
  if (![request.companyId, request.branchId, request.itemId].every(id => typeof id === 'string' && id.trim())) {
    throw new Error('Se requiere empresa, sucursal y producto');
  }
  const strategy = request.policy?.strategy ?? 'FEFO';
  const expiration = request.policy?.expiration ?? 'UNKNOWN';
  if (!['FEFO', 'FIFO'].includes(strategy) || !['REQUIRED', 'NONE', 'UNKNOWN'].includes(expiration)) {
    throw new Error('Política de salida inválida');
  }
  const seen = new Set<string>();
  const eligible: { batch: BatchCandidate; quantity: number }[] = [];
  for (const batch of batches) {
    if (seen.has(batch.id)) throw new Error('Candidatos de lote duplicados');
    seen.add(batch.id);
    if (batch.companyId !== request.companyId || batch.branchId !== request.branchId || batch.itemId !== request.itemId
      || batch.status !== 'AVAILABLE' || (request.batchId !== undefined && batch.id !== request.batchId)) continue;
    if (![batch.expirationDate, batch.receivedAt, batch.createdAt].every(validDate)) continue;
    if (batch.expirationDate === null ? expiration !== 'NONE' : batch.expirationDate.getTime() <= request.now.getTime()) continue;
    const quantity = scaledQuantity(batch.currentQuantity);
    if (quantity !== null && quantity > 0) eligible.push({ batch, quantity });
  }

  const time = (date: Date | null) => date?.getTime() ?? Infinity;
  eligible.sort(({ batch: a }, { batch: b }) =>
    (strategy === 'FEFO' ? compare(time(a.expirationDate), time(b.expirationDate)) : 0)
    || compare(time(a.receivedAt ?? a.createdAt), time(b.receivedAt ?? b.createdAt))
    || compare(time(a.createdAt), time(b.createdAt)) || compare(a.id, b.id));

  const allocations: BatchAllocationPlan['allocations'] = [];
  let remaining = requested;
  for (const { batch, quantity } of eligible) {
    if (remaining === 0) break;
    const taken = Math.min(quantity, remaining);
    allocations.push({ batchId: batch.id, quantity: taken / SCALE, unitCost: batch.unitCost });
    remaining -= taken;
  }
  return { allocations, requestedQuantity: requested / SCALE,
    allocatedQuantity: (requested - remaining) / SCALE, shortfallQuantity: remaining / SCALE };
}
