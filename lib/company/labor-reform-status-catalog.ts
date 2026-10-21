/**
 * Catálogo contractual de estatus legal de las reformas laborales LFT
 * 2026-2030 (plan plans/2026-correcciones-legales-config-laboral.md,
 * Task 2 — capa 3). Estado investigación DOF al oct-2026.
 *
 * Contrato con los consumidores (advertencia [H04] del repo): todo
 * servicio que toque una reforma pendiente DEBE leer su entrada de
 * este catálogo y reflejar el estatus en su output/UI. Es imposible
 * alegar "ley" que no es ley.
 *
 * Revisión obligatoria cuando el DOF publique cualquiera de las
 * iniciativas en PENDING_INITIATIVE o el Anti-Buró pase de la Cámara
 * de Diputados.
 */

export type LaborReformLegalStatus =
    | 'LAW' // Ley vigente (DOF publicado, en vigor)
    | 'LAW_PENDING_SECONDARY' // Ley vigente; disposiciones secundarias pendientes
    | 'PENDING_LAW_APPROVAL' // Aprobado una cámara; falta la otra / publicación
    | 'PENDING_INITIATIVE' // Solo iniciativa presentada ante el Congreso
    | 'POLICY'; // No es norma legal; implementable como política de empresa

export interface LaborReformStatus {
    key: string;
    status: LaborReformLegalStatus;
    /** Etiqueta corta para UI (es-MX). */
    label: string;
    /** Base legal o estado parlamentario, con fecha de publicación. */
    basis: string;
    dofUrl?: string;
    /** Efecto esperado sobre el servicio asociado. */
    effectNote: string;
    /** Servicio(s) del código que implementa esta reforma. */
    serviceFiles: string[];
}

export const LABOR_REFORM_STATUS_CATALOG: LaborReformStatus[] = [
    {
        key: 'JORNADA_40H_TRANSICION',
        status: 'LAW',
        label: 'Reducción de jornada 48h→40h',
        basis: 'DOF 1-may-2026 en vigor; transitorios 2.º y 4.º (48/46/44/42/40h). Parlamento: reforma constitucional Art. 123 publicada 3-mar-2026.',
        dofUrl: 'https://sidof.segob.gob.mx/notas/docFuente/5786537',
        effectNote: 'Calendario legal resuelto por fecha en labor-rules-resolver.',
        serviceFiles: ['lib/services/labor-calendar-rules.ts', 'lib/labor-validation.ts', 'lib/services/lft-conflict-detector.ts'],
    },
    {
        key: 'REGISTRO_ELECTRONICO_JORNADA',
        status: 'LAW_PENDING_SECONDARY',
        label: 'Registro electrónico de jornada',
        basis: 'Art. 132 fr. XXXIV y multa Art. 994 IV-Bis (250–5,000 UMA) vigentes desde 1-may-2026. Las disposiciones de la STPS (ámbito y excepciones) NO se han publicado al oct-2026; vigor 1-ene-2027.',
        dofUrl: 'https://sidof.segob.gob.mx/notas/docFuente/5786537',
        effectNote: 'Obligación ya existe; lineamientos pendientes => readiness por sucursal sin bloqueo.',
        serviceFiles: ['lib/db/schema/labor-law-ref.ts (electronicRegistryReadiness)'],
    },
    {
        key: 'LEY_SILLA',
        status: 'LAW',
        label: 'Ley Silla (asientos y pausas)',
        basis: 'DOF 19-dic-2024 en vigor. Periodo de gracia venció 14-dic-2025; STPS la incluye en su Programa Anual de Inspección 2026.',
        dofUrl: 'https://www.dof.gob.mx/nota_detalle.php?codigo=5745676&fecha=19/12/2024',
        effectNote: 'Obligación de hoy: evaluación por puesto ejecuable.',
        serviceFiles: ['lib/services/compliance/ley-silla-service.ts', 'templates/compliance/ley-silla-inspection-v1.json'],
    },
    {
        key: 'BRECHA_SALARIAL_TABULADORES',
        status: 'LAW',
        label: 'Brecha salarial y tabuladores (Art. 86)',
        basis: 'DOF dic-2024 (ref. 47): prohibida la petición de sueldo anterior; transparencia de tabuladores.',
        effectNote: 'Obligación de hoy: auditoría de brecha salarial ejecutable.',
        serviceFiles: ['lib/services/salary-transparency-service.ts', 'lib/services/ComplianceReportService.ts'],
    },
    {
        key: 'DESCONEXION_DIGITAL',
        status: 'PENDING_INITIATIVE',
        label: 'Desconexión digital (fuera de jornada)',
        basis: 'Iniciativas en el Congreso (Morena oct-2025 y otras) — NO vigente a oct-2026.',
        effectNote: 'Bloqueo WhatsApp implementable como política de empresa; nunca alegar obligación legal.',
        serviceFiles: ['lib/services/whatsapp-notification-service.ts'],
    },
    {
        key: 'LICENCIAS_SALUD_MENTAL',
        status: 'PENDING_INITIATIVE',
        label: 'Licencias de salud mental (7 días/año)',
        basis: '12+ iniciativas distintas (ago-2025 · nov-2025 · mar-2026) NINGUNA aprobada a oct-2026.',
        effectNote: 'Cálculo disponible como proyección con legalBasis: pending.',
        serviceFiles: ['lib/services/mental-health-leave-service.ts'],
    },
    {
        key: 'LICENCIAS_DUELO_PATERNIDAD',
        status: 'PENDING_INITIATIVE',
        label: 'Duelo 5d / paternidad 10-15d',
        basis: 'Iniciativas (oct-2025) — NO vigente; la LFT actual no las consagra.',
        effectNote: 'Cálculo como proyección; nómina no debe desembolsar como obligación.',
        serviceFiles: ['lib/services/payroll-service.ts (licencias extendidas)', 'lib/services/employee-service.ts'],
    },
    {
        key: 'ANTI_BURO_LABORAL',
        status: 'PENDING_LAW_APPROVAL',
        label: 'Anti-Buró laboral',
        basis: 'Senado aprobó el dictamen 24-mar-2026 (86 votos); falta la Cámara de Diputados y publicación DOF.',
        effectNote: 'Protección de offboarding como práctica recomendada; obligación a la publicación.',
        serviceFiles: ['lib/services/employee-service.ts (offboardEmployeeWithAntiBuroProtection)'],
    },
    {
        key: 'AGUINALDO_30_DIAS',
        status: 'PENDING_INITIATIVE',
        label: 'Aguinaldo 30 días progresivos por antigüedad',
        basis: 'Iniciativas MC (jul-2026: 1-2 años→15, 3-4→20, 5+→25, 6+→30) y oct-2024 — NO vigente a oct-2026. Ley vigente: 15 días por año (Art. 87 LFT, DOF LFT 1970).',
        effectNote: '15 días es la única cifra legal de hoy (labor-rules-resolver). Cualquier cálculo a 30 días es proyección con legalBasis: pending; la nómina jamás desembolsa por norma no vigente.',
        serviceFiles: ['lib/services/labor-rules-resolver.ts (aguinaldoDaysMxn)', 'lib/services/aguinaldo-service.ts'],
    },
    {
        key: 'PRIMA_SUSTITUCION_IA',
        status: 'PENDING_INITIATIVE',
        label: 'Prima por sustitución por IA (+2 meses)',
        basis: 'Iniciativa Morena 1-jul-2026 (total propuesto: hasta 5 meses) — NO ley; "Art. 50/439" citado por el código NO existe en la LFT vigente.',
        effectNote: 'Calculadora disponible como proyección; finiquito legal real = 3 meses + prima de antigüedad.',
        serviceFiles: ['lib/services/ai-severance-calculator.ts'],
    },
    {
        key: 'ACTIVIDADES_FUERA_DE_JORNADA_50',
        status: 'POLICY',
        label: 'Actividades fuera de jornada (+50%)',
        basis: 'NO localizada la regla +50%/descanso 30 días en el DOF (ni en el decreto 1-may-2026 ni en reformas dic-2024). Tratable como política interna opcional.',
        effectNote: 'Servicio ejecutable como política con toggle por empresa; no alegar norma.',
        serviceFiles: ['lib/services/off-hours-event-service.ts'],
    },
];

export function getReformStatus(key: string): LaborReformStatus | undefined {
    return LABOR_REFORM_STATUS_CATALOG.find((entry) => entry.key === key);
}

/** True cuando la reforma es exigible hoy (LAW o secondary pendiente). */
export function isReformEnforceable(entry: LaborReformStatus): boolean {
    return entry.status === 'LAW' || entry.status === 'LAW_PENDING_SECONDARY';
}
