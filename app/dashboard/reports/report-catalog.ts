/**
 * Catálogo único de reportes estándar.
 *
 * Antes vivía copiado en tres lados —la lista de la pantalla, la del
 * programador y el `switch` de /api/reports/generate— y ya se había
 * desincronizado: el programador no ofrecía NOM-035. Agregar un reporte exigía
 * acordarse de tres archivos y nada avisaba si se te olvidaba uno.
 *
 * `formats` sólo declara lo que la ruta de generación sabe producir de verdad.
 * "CSV" estaba anunciado en la pantalla, no existía en el servidor, y la
 * descarga salía como un .pdf con JSON adentro.
 */

export type FormatoReporte = "PDF" | "Excel";

export interface ReporteEstandar {
    id: string;
    name: string;
    description: string;
    category: string;
    formats: FormatoReporte[];
    /** Reporte con valor legal frente a un inspector. */
    official?: boolean;
    /** Aparece en el catálogo pero todavía no se puede generar. */
    comingSoon?: boolean;
}

export const REPORTES: ReporteEstandar[] = [
    {
        id: "workflow-summary",
        name: "Resumen de workflows",
        description: "Qué se ejecutó en el período, con cumplimiento y promedios por sucursal.",
        category: "WORKFLOWS",
        formats: ["PDF", "Excel"],
    },
    {
        id: "workflow-detailed",
        name: "Detalle de workflows",
        description: "Listado completo con estado, tiempos, responsable y resultado de cada uno.",
        category: "WORKFLOWS",
        formats: ["PDF", "Excel"],
    },
    {
        id: "evidence-report",
        name: "Evidencias fotográficas",
        description: "Catálogo de evidencias subidas, con el resultado de la verificación por IA.",
        category: "EVIDENCE",
        formats: ["PDF"],
    },
    {
        id: "compliance-nom251",
        name: "Cumplimiento NOM-251",
        description: "Reporte de higiene y manejo de alimentos con formato aceptado por COFEPRIS.",
        category: "COMPLIANCE",
        formats: ["PDF"],
        official: true,
    },
    {
        id: "compliance-nom035",
        name: "Cumplimiento NOM-035",
        description: "Factores de riesgo psicosocial para entrega ante la STPS.",
        category: "COMPLIANCE",
        formats: ["PDF"],
        official: true,
        comingSoon: true,
    },
    {
        id: "inventory-status",
        name: "Estado de inventario",
        description: "Existencias, mermas, caducidades y movimientos del período.",
        category: "INVENTORY",
        formats: ["PDF", "Excel"],
    },
    {
        id: "labor-attendance",
        name: "Asistencia y horas",
        description: "Horas trabajadas, extras y retardos por empleado y sucursal.",
        category: "LABOR",
        formats: ["PDF", "Excel"],
    },
    {
        id: "performance-kpis",
        name: "KPIs de rendimiento",
        description: "Indicadores clave con tendencia y comparativa entre sucursales.",
        category: "ANALYTICS",
        formats: ["PDF", "Excel"],
    },
    {
        id: "incidents-report",
        name: "Incidentes",
        description: "Incidentes registrados con severidad y estado de resolución.",
        category: "INCIDENTS",
        formats: ["PDF"],
    },
];

/** Reportes que el programador puede agendar: los que ya se pueden generar. */
export const REPORTES_PROGRAMABLES = REPORTES.filter((r) => !r.comingSoon);

export const GRUPOS_CATEGORIA: Record<string, string[]> = {
    ALL: [],
    OPERACIONES: ["WORKFLOWS", "EVIDENCE", "INCIDENTS"],
    CUMPLIMIENTO: ["COMPLIANCE"],
    INVENTARIO: ["INVENTORY"],
    // "KPIs de rendimiento" estaba archivado bajo PERSONAS junto con nómina.
    // El rendimiento del negocio no es un reporte de gente y nadie lo iba a
    // buscar ahí.
    PERSONAS: ["LABOR"],
    DESEMPENO: ["ANALYTICS"],
};

export const CATEGORIAS = [
    { id: "ALL", label: "Todos" },
    { id: "OPERACIONES", label: "Operaciones" },
    { id: "CUMPLIMIENTO", label: "Cumplimiento" },
    { id: "INVENTARIO", label: "Inventario" },
    { id: "PERSONAS", label: "Personas" },
    { id: "DESEMPENO", label: "Desempeño" },
];
