/**
 * Ventanas de resolución por severidad — el "a tiempo" del score de cumplimiento.
 *
 * El esquema de `incidents` no tiene campo de SLA: no hay `dueAt` ni una
 * configuración por tenant que diga cuánto puede tardar un incidente en
 * cerrarse. El score de cumplimiento del plan V2 se define como
 * `resueltos a tiempo / total`, así que "a tiempo" hay que fijarlo en algún
 * lado, y este archivo es ese lado: una sola tabla, no un número repartido por
 * los servicios que lo necesiten.
 *
 * Los valores son un punto de partida operativo para HORECA (un CRITICAL de
 * cadena de frío no aguanta un turno completo; un WARNING de limpieza sí), no
 * una obligación normativa. Cuando el tenant necesite los suyos, esto pasa a
 * `tenant_operating_config` y la firma de `slaHorasPorSeveridad` no cambia.
 */

export type IncidentSeverity = 'CRITICAL' | 'WARNING' | 'FATAL' | 'HIGH';

const SLA_HORAS: Record<IncidentSeverity, number> = {
    FATAL: 2,
    CRITICAL: 4,
    HIGH: 8,
    WARNING: 24,
};

/** Horas permitidas para resolver un incidente de esta severidad. */
export function slaHorasPorSeveridad(severidad: string | null | undefined): number {
    return SLA_HORAS[severidad as IncidentSeverity] ?? 24;
}

/**
 * ¿Se resolvió dentro de su ventana?
 *
 * Un incidente sin `resolvedAt` no cuenta como a tiempo aunque su ventana siga
 * abierta: el score mide cierres cumplidos, y dar por bueno lo que todavía no
 * se cierra infla la cifra justo cuando hay trabajo pendiente.
 */
export function resueltoATiempo(
    severidad: string | null | undefined,
    detectadoEn: Date | null | undefined,
    resueltoEn: Date | null | undefined
): boolean {
    if (!resueltoEn || !detectadoEn) return false;
    const horas = (resueltoEn.getTime() - detectadoEn.getTime()) / 3_600_000;
    return horas <= slaHorasPorSeveridad(severidad);
}

/** Expresión SQL equivalente, para calcular el score sin traer las filas. */
export const SLA_CASE_SQL = `CASE severity
    WHEN 'FATAL' THEN 2
    WHEN 'CRITICAL' THEN 4
    WHEN 'HIGH' THEN 8
    ELSE 24
END`;
