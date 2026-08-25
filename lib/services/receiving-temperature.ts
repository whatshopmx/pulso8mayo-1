// lib/services/receiving-temperature.ts
// Validación de temperatura en recepción por tipo de almacenamiento del ítem
// (manual operativo loteprod.md §5.2):
//   - Congelado: ≤ -18°C
//   - Refrigerado: 0–4°C
//   - Seco: sin requisito de temperatura
// Fuera de rango ⇒ lote QUARANTINED + incidente automático (lo aplica
// receiving-service). Lógica pura para poder testearla sin BD.

export type ItemStorageType = 'DRY' | 'REFRIGERATED' | 'FROZEN';

export type ReceivingTemperatureRange = {
    /** Límite inferior inclusive; null = sin mínimo (los congelados pueden estar más fríos). */
    minC: number | null;
    /** Límite superior inclusive. */
    maxC: number;
    /** Etiqueta en español para mostrar en UI e incidentes. */
    label: string;
};

/** Rangos exigidos en recepción según el tipo de almacenamiento del ítem.
 *  DRY ⇒ null (sin requisito). */
export function expectedTemperatureRange(
    storageType: ItemStorageType | null | undefined
): ReceivingTemperatureRange | null {
    switch (storageType) {
        case 'FROZEN':
            return { minC: null, maxC: -18, label: '≤ -18°C' };
        case 'REFRIGERATED':
            return { minC: 0, maxC: 4, label: '0–4°C' };
        default:
            return null;
    }
}

export type ReceivingTemperatureEvaluation = {
    /** true ⇒ lote debe nacer QUARANTINED y generarse incidente. */
    quarantined: boolean;
    /** Descripción corta de la violación (p.ej. "-10°C fuera de rango ≤ -18°C").
     *  Ausente cuando no hay violación. */
    violation?: string;
};

/**
 * Evalúa la temperatura capturada en recepción contra el rango esperado del ítem.
 *
 * Reglas:
 *  - Sin temperatura capturada ⇒ nunca cuarentena (no podemos exigir lectura a
 *    flujos legacy que hoy no la capturan; la UI la promueve).
 *  - Ítem REFRIGERADO o CONGELADO ⇒ se validan ambos extremos del rango.
 *  - Ítem DRY explícito ⇒ sin requisito.
 *  - Ítem SIN CLASIFICAR (null) ⇒ regla legacy genérica (> 4°C rechaza) para no
 *    perder la red de seguridad sobre datos existentes aún sin clasificar.
 */
export function evaluateReceivingTemperature(
    temperature: number | undefined | null,
    storageType: ItemStorageType | null | undefined
): ReceivingTemperatureEvaluation {
    if (temperature === undefined || temperature === null || Number.isNaN(temperature)) {
        return { quarantined: false };
    }

    const range = expectedTemperatureRange(storageType);

    // Sin clasificar: comportamiento previo al gap (solo extremo alto genérico).
    if (!range) {
        if (storageType === 'DRY') return { quarantined: false };
        if (temperature > 4) {
            return { quarantined: true, violation: `${temperature}°C excede el límite máximo de calidad (4°C)` };
        }
        return { quarantined: false };
    }

    if (range.minC !== null && temperature < range.minC) {
        return { quarantined: true, violation: `${temperature}°C fuera de rango esperado ${range.label}` };
    }
    if (temperature > range.maxC) {
        return { quarantined: true, violation: `${temperature}°C fuera de rango esperado ${range.label}` };
    }
    return { quarantined: false };
}
