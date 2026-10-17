// lib/services/receiving-cost.ts
// Conversión de cantidad+costo en recepción (H07 del reporte de cumplimiento
// 2026-10-17): el valor total recibido debe conservarse cuando la unidad
// capturada difiere de la unidad base del ítem.
//
// Lógica pura (sin BD) para poder testearla aislada, igual que
// receiving-temperature.ts.

export type ReceivedAmountInput = {
    /** Cantidad tal como la capturó el usuario, en `fromUnit`. */
    quantity: number;
    /** Costo unitario tal como lo capturó el usuario, en centavos por `fromUnit`. */
    unitCostCents: number | null | undefined;
    /** Factor de conversión `fromUnit → baseUnit` (2 cajas de 10 kg ⇒ 10). */
    factor: number;
};

export type ReceivedAmountResult = {
    /** Cantidad expresada en la unidad base del ítem. */
    quantity: number;
    /** Costo unitario en centavos por unidad base. */
    unitCostCents: number | null;
    /** Costo total recibido en centavos (debe ser estable tras convertir). */
    totalCents: number;
};

/**
 * Convierte cantidad y costo unitario de la unidad capturada a la unidad base.
 *
 * El costo se ajusta dividiendo por el factor (no multiplicando), de modo que
 * `cantidad × costoUnitario` —el valor total— se conserva exactamente.
 *
 * Ejemplo: 2 cajas @ $1,000/caja con factor 10 ⇒ 20 unidades base @ $100.
 */
export function convertReceivedAmount({
    quantity,
    unitCostCents,
    factor,
}: ReceivedAmountInput): ReceivedAmountResult {
    const totalCents =
        unitCostCents === null || unitCostCents === undefined
            ? 0
            : Math.round(unitCostCents * quantity);

    if (!Number.isFinite(factor) || factor === 0) {
        // Factor inválido: no se convierte nada, pero el total sigue siendo
        // calculable para no perder información del valor recibido.
        return {
            quantity,
            unitCostCents: unitCostCents ?? null,
            totalCents,
        };
    }

    return {
        quantity: quantity * factor,
        unitCostCents:
            unitCostCents === null || unitCostCents === undefined
                ? null
                : Math.round(unitCostCents / factor),
        totalCents,
    };
}