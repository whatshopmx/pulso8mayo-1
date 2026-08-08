/**
 * Frecuencia mínima de verificación que exige cada norma.
 *
 * AD-1: `requiredFrequency` es la fuente de verdad y la programación del flujo
 * se valida contra ella *en el servidor*, no solo en el cliente: si el sistema
 * conoce la norma y conoce la programación, hacer que coincidan no es trabajo
 * del usuario.
 *
 * AD-2: la validación arranca en advertencia y `enforce` es **por norma**, no
 * global. Los valores de esta tabla son un punto de partida operativo, no
 * asesoría legal: bloquear guardados antes de que el consultor de cumplimiento
 * los confirme convierte un error nuestro en un error del cliente. Cada norma
 * pasa a `enforce: true` con su `source` y su `reviewedAt` cuando la confirmen,
 * una por una — así NOM-251 puede bloquear en cuanto esté revisada sin esperar
 * a las otras once.
 *
 * Variable de entorno:
 *   COMPLIANCE_FREQ_ENFORCE=false
 *     Interruptor de emergencia **global**: apaga todos los `enforce` de la
 *     tabla sin desplegar. No enciende ninguno; encender es siempre por norma,
 *     editando su entrada aquí. Ausente o cualquier otro valor = sin efecto.
 */

/** Cadencias declarables en `complianceConfig.requiredFrequency`. */
export type ComplianceFrequency =
    | 'DAILY'
    | 'WEEKLY'
    | 'BIWEEKLY'
    | 'MONTHLY'
    | 'QUARTERLY'
    | 'SEMIANNUAL'
    | 'ANNUAL'
    | 'ON_DEMAND';

/**
 * Rango de cadencia: **menor es más frecuente**. `ON_DEMAND` va al final porque
 * "cuando alguien lo dispare" no garantiza ninguna periodicidad, así que nunca
 * satisface un mínimo.
 */
const FREQUENCY_RANK: Record<ComplianceFrequency, number> = {
    DAILY: 0,
    WEEKLY: 1,
    BIWEEKLY: 2,
    MONTHLY: 3,
    QUARTERLY: 4,
    SEMIANNUAL: 5,
    ANNUAL: 6,
    ON_DEMAND: 7,
};

/** Etiqueta en español para los mensajes que ve el usuario. */
const FREQUENCY_LABEL: Record<ComplianceFrequency, string> = {
    DAILY: 'diaria',
    WEEKLY: 'semanal',
    BIWEEKLY: 'quincenal',
    MONTHLY: 'mensual',
    QUARTERLY: 'trimestral',
    SEMIANNUAL: 'semestral',
    ANNUAL: 'anual',
    ON_DEMAND: 'bajo demanda',
};

export interface FrequencyRequirement {
    /** Cadencia mínima exigida. Programar por encima nunca es error. */
    min: ComplianceFrequency;
    /** `true` bloquea el guardado con 422. Arranca en `false` (AD-2). */
    enforce: boolean;
    /** De dónde sale el valor. Se rellena al confirmarlo con el consultor. */
    source: string;
    /** Fecha ISO de la revisión que autorizó `enforce: true`. */
    reviewedAt: string | null;
}

/**
 * Q2 — pendiente de confirmar norma por norma con el consultor de cumplimiento.
 * Mientras `enforce` sea `false`, un desajuste devuelve advertencia y el
 * guardado se completa.
 *
 * Las normas laborales y fiscales (LFT, LSSN, INFONAVIT, FONACOT, ISR, IVA) no
 * fijan una cadencia de verificación operativa: se omiten a propósito y no
 * generan advertencia.
 */
export const FREQUENCY_REQUIREMENTS: Record<string, FrequencyRequirement> = {
    NOM_251: { min: 'DAILY', enforce: false, source: 'Valor operativo por confirmar (Q2)', reviewedAt: null },
    NOM_035: { min: 'ANNUAL', enforce: false, source: 'Valor operativo por confirmar (Q2)', reviewedAt: null },
    NOM_030: { min: 'MONTHLY', enforce: false, source: 'Valor operativo por confirmar (Q2)', reviewedAt: null },
    NOM_019: { min: 'MONTHLY', enforce: false, source: 'Valor operativo por confirmar (Q2)', reviewedAt: null },
    NOM_017: { min: 'MONTHLY', enforce: false, source: 'Valor operativo por confirmar (Q2)', reviewedAt: null },
};

/** Etiqueta legible de la norma, para los mensajes. */
function complianceLabel(complianceType: string): string {
    return complianceType.replace(/_/g, '-');
}

/**
 * ¿La cadencia programada satisface el mínimo? Programar **por encima** del
 * requisito (diario donde se pide mensual) nunca es un error.
 */
export function frequencyMeetsRequirement(
    scheduled: ComplianceFrequency,
    required: ComplianceFrequency
): boolean {
    return FREQUENCY_RANK[scheduled] <= FREQUENCY_RANK[required];
}

/**
 * Traduce la frecuencia del programador (`daily`, `weekly`, `monthly`,
 * `on_demand`) a la escala de cumplimiento. Devuelve `null` si no la reconoce,
 * para no inventar un veredicto sobre un valor que no entendemos.
 */
export function scheduleFrequencyToCompliance(frequency: string): ComplianceFrequency | null {
    const map: Record<string, ComplianceFrequency> = {
        daily: 'DAILY',
        weekly: 'WEEKLY',
        monthly: 'MONTHLY',
        on_demand: 'ON_DEMAND',
    };
    return map[frequency?.toLowerCase()] ?? null;
}

export interface FrequencyCheck {
    /** Mensajes para el usuario. Vacío cuando la programación cumple. */
    warnings: string[];
    /** `true` cuando hay que rechazar el guardado con 422. */
    blocking: boolean;
}

/**
 * Compara la programación del flujo contra el mínimo de su norma.
 *
 * @param enforceDisabled Interruptor de emergencia global
 *   (`COMPLIANCE_FREQ_ENFORCE=false`): apaga todos los `enforce` sin tocar la
 *   tabla. No enciende ninguno.
 */
export function checkScheduleFrequency(
    complianceType: string | null | undefined,
    scheduleFrequency: string,
    enforceDisabled = false
): FrequencyCheck {
    const ok: FrequencyCheck = { warnings: [], blocking: false };

    if (!complianceType || complianceType === 'NONE') return ok;

    const requirement = FREQUENCY_REQUIREMENTS[complianceType];
    if (!requirement) return ok;

    const scheduled = scheduleFrequencyToCompliance(scheduleFrequency);
    if (!scheduled) return ok;

    if (frequencyMeetsRequirement(scheduled, requirement.min)) return ok;

    const norma = complianceLabel(complianceType);
    const warning =
        `${norma} exige verificación ${FREQUENCY_LABEL[requirement.min]}. ` +
        `Este flujo está programado ${FREQUENCY_LABEL[scheduled]}. ` +
        'Valor operativo, no asesoría legal.';

    return { warnings: [warning], blocking: requirement.enforce && !enforceDisabled };
}
