/** Contrato puro compartido por servidor y navegador, sin DB ni cifrado. */
export interface SalarioEfectivoResuelto {
    /** Salario de registro del contrato (CFDI/nómina). */
    baseRegistradaCents: number;
    /** Salario realmente recibido: la parte en efectivo es derivada, nunca se captura suelta. */
    salarioEfectivoCents: number;
    /** efectivo − registrado. Puede ser negativo si el dato así llega. */
    gapCents: number;
    /** true cuando no hay dato efectivo o es igual al base. */
    esFormal: boolean;
}

export function resolveEffectiveSalary(
    baseSalaryCents: number,
    effectiveSalaryCents: number | null | undefined,
): SalarioEfectivoResuelto {
    const efectivo = effectiveSalaryCents != null && effectiveSalaryCents > 0
        ? effectiveSalaryCents
        : baseSalaryCents;
    return {
        baseRegistradaCents: baseSalaryCents,
        salarioEfectivoCents: efectivo,
        gapCents: efectivo - baseSalaryCents,
        esFormal: efectivo === baseSalaryCents,
    };
}
