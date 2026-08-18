/**
 * Preguntas guardadas del constructor de reportes.
 *
 * El constructor anterior pedía al dueño de una taquería que compusiera una
 * consulta: fuente de datos, 17 casillas de campos y ocho operadores SQL
 * incluyendo "Es nulo". Nadie fuera de un analista arma eso. Estas son las
 * preguntas que la gente sí llega haciendo; el armado de campos sigue
 * disponible en "Avanzado" para quien de verdad lo necesita.
 *
 * Cada pregunta se traduce a la misma llamada que hace el modo avanzado, así
 * que no hay una segunda ruta ni un segundo contrato que mantener.
 */

export interface PreguntaGuardada {
    id: string;
    /** El texto que el usuario reconoce como su propia pregunta. */
    pregunta: string;
    /** Qué devuelve exactamente, en una línea. */
    devuelve: string;
    dataSource: "employees" | "contracts" | "documents";
    fields: string[];
    /** `valor` acepta tokens de fecha relativos resueltos en el cliente. */
    filters: Array<{ field: string; operator: string; value: string }>;
    /** Sólo visible para roles que pueden ver datos sensibles. */
    requiereSensibles?: boolean;
}

/** Token de fecha → fecha real. `hoy`, `hoy+30`, `hoy-90`. */
export function resolverFecha(token: string): string {
    const match = /^hoy([+-]\d+)?$/.exec(token.trim());
    if (!match) return token;

    const dias = match[1] ? Number(match[1]) : 0;
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + dias);
    return fecha.toISOString().slice(0, 10);
}

export function resolverFiltros(pregunta: PreguntaGuardada) {
    return pregunta.filters.map((f) => ({ ...f, value: resolverFecha(f.value) }));
}

export const PREGUNTAS_GUARDADAS: PreguntaGuardada[] = [
    {
        id: "documentos-vencidos",
        pregunta: "¿A quién se le venció un documento?",
        devuelve: "Documentos cuya fecha de vencimiento ya pasó, con el empleado y la sucursal.",
        dataSource: "documents",
        fields: ["employeeName", "branchName", "documentType", "documentName", "expirationDate", "status"],
        filters: [{ field: "expirationDate", operator: "less_than", value: "hoy" }],
    },
    {
        id: "documentos-por-vencer",
        pregunta: "¿Qué documentos vencen en los próximos 30 días?",
        devuelve: "Lo que hay que renovar antes de la próxima inspección.",
        dataSource: "documents",
        fields: ["employeeName", "branchName", "documentType", "documentName", "expirationDate"],
        filters: [
            { field: "expirationDate", operator: "greater_than", value: "hoy" },
            { field: "expirationDate", operator: "less_than", value: "hoy+30" },
        ],
    },
    {
        id: "contratos-por-terminar",
        pregunta: "¿Qué contratos terminan en los próximos 30 días?",
        devuelve: "Contratos con fecha de fin próxima, para renovar o dar aviso a tiempo.",
        dataSource: "contracts",
        fields: ["employeeName", "branchName", "contractNumber", "contractType", "endDate", "status"],
        filters: [
            { field: "endDate", operator: "greater_than", value: "hoy" },
            { field: "endDate", operator: "less_than", value: "hoy+30" },
        ],
    },
    {
        id: "altas-recientes",
        pregunta: "¿Quién entró en los últimos 90 días?",
        devuelve: "Personal contratado recientemente, con puesto, departamento y sucursal.",
        dataSource: "employees",
        fields: ["name", "branchName", "position", "department", "hireDate", "employeeStatus"],
        filters: [{ field: "hireDate", operator: "greater_than", value: "hoy-90" }],
    },
    {
        id: "bajas",
        pregunta: "¿Quién causó baja y por qué motivo?",
        devuelve: "Personal con fecha de baja registrada, con el motivo capturado.",
        dataSource: "employees",
        fields: ["name", "branchName", "position", "hireDate", "terminationDate", "terminationReason"],
        filters: [{ field: "terminationDate", operator: "is_not_null", value: "" }],
    },
    {
        id: "expediente-incompleto",
        pregunta: "¿A quién le falta CURP en el expediente?",
        devuelve: "Empleados sin CURP capturado. No muestra la CURP de nadie, sólo quién no la tiene.",
        dataSource: "employees",
        fields: ["name", "branchName", "position", "employeeNumber", "employeeStatus"],
        filters: [{ field: "curp", operator: "is_null", value: "" }],
        requiereSensibles: true,
    },
];
