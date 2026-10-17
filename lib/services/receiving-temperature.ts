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
 *  - Sin temperatura capturada ⇒ nunca cuarentena (chequeo legacy: la
 *    EXIGENCIA de lectura vive en `evaluateReceivingTemperaturePolicy`, que
 *    distingue `MISSING_READING` de conformidad).
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

/**
 * ¿Este tipo de almacenamiento exige lectura de temperatura en recepción?
 * Refrigerado (0–4°C) y congelado (≤ -18°C): sí. Seco y sin clasificar: no.
 */
export function requiresTemperatureReading(
    storageType: ItemStorageType | null | undefined
): boolean {
    return storageType === 'REFRIGERATED' || storageType === 'FROZEN';
}

export type ReceivingTemperatureStatus = 'OK' | 'QUARANTINE' | 'MISSING_READING';

export type ReceivingTemperaturePolicyResult = {
    status: ReceivingTemperatureStatus;
    /** true sólo cuando HAY lectura y está fuera de rango. */
    quarantined: boolean;
    /** true cuando el tipo de almacenamiento exige lectura. */
    readingRequired: boolean;
    /** true cuando se exige lectura y no se capturó (no es conformidad). */
    missingReading: boolean;
    violation?: string;
};

/**
 * Política completa de temperatura en recepción.
 *
 * Diferencia tres estados que antes se confundían:
 *  - `QUARANTINE`      ⇒ hubo lectura y está fuera de rango (cuarentena).
 *  - `MISSING_READING` ⇒ se exige lectura y falta; NO cuenta como conformidad.
 *  - `OK`              ⇒ hay lectura válida, o el ítem no exige lectura.
 *
 * La ausencia de lectura en ítems sin requisito (seco/sin clasificar) sigue
 * siendo `OK` para no romper flujos legacy que hoy no capturan temperatura.
 */
export function evaluateReceivingTemperaturePolicy(
    temperature: number | undefined | null,
    storageType: ItemStorageType | null | undefined
): ReceivingTemperaturePolicyResult {
    const readingRequired = requiresTemperatureReading(storageType);
    const missing =
        temperature === undefined || temperature === null || Number.isNaN(temperature);

    if (missing) {
        return readingRequired
            ? { status: 'MISSING_READING', quarantined: false, readingRequired: true, missingReading: true }
            : { status: 'OK', quarantined: false, readingRequired: false, missingReading: false };
    }

    const base = evaluateReceivingTemperature(temperature, storageType);
    if (base.quarantined) {
        return {
            status: 'QUARANTINE',
            quarantined: true,
            readingRequired,
            missingReading: false,
            violation: base.violation,
        };
    }
    return { status: 'OK', quarantined: false, readingRequired, missingReading: false };
}

/** Sujeto mínimo evaluable por `missingTemperatureReadings`. */
export interface TemperatureReadingSubject {
    itemId: string;
    temperature: number | undefined | null;
    storageType: ItemStorageType | null | undefined;
    /** Excepción autorizada para este ítem; debe traer un motivo no vacío. */
    exceptionReason?: string | null;
}

/**
 * Devuelve los `itemId` que exigen lectura, no la capturaron y no traen una
 * excepción con motivo. Es la comprobación previa (sin escrituras) que usan los
 * llamadores para rechazar una recepción incompleta antes de tocar stock.
 */
export function missingTemperatureReadings(
    subjects: readonly TemperatureReadingSubject[]
): string[] {
    return subjects
        .filter((s) =>
            evaluateReceivingTemperaturePolicy(s.temperature, s.storageType).missingReading
        )
        .filter((s) => !(s.exceptionReason && s.exceptionReason.trim().length > 0))
        .map((s) => s.itemId);
}
