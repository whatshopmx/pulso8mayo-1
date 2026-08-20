import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  users,
  employeeProfiles,
  employeeContracts,
  employeeDocuments,
  branches,
  reportExecutionHistory,
} from "@/lib/db/schema";
import { eq, and, gte, lte, ilike, sql } from "drizzle-orm";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import { createChildLogger } from "@/lib/logger";
// Dos tipos de rol conviven en el repo: `Role` (lib/permissions, derivado del
// enum de la DB, incluye OWNER) y `UserRole` (lib/rbac/permissions, el que
// consumen los guards). Cada uno se usa donde corresponde en vez de castear.
import type { Role } from "@/lib/permissions";
import type { UserRole } from "@/lib/rbac/permissions";

const log = createChildLogger("api:reports:execute");

/**
 * Quién puede ejecutar reportes personalizados.
 *
 * SUPERVISOR y READONLY llegan a /dashboard/reports por RBAC de ruta, pero esta
 * ruta exporta contratos con sueldos y el perfil con CURP/RFC/NSS. Antes sólo
 * validaba `companyId`, así que cualquiera con acceso a la pantalla podía bajar
 * la nómina completa de la empresa en CSV.
 */
const ROLES_CON_REPORTES: UserRole[] = ["SUPER_ADMIN", "ADMIN", "GERENTE"];

/** Sólo la dirección ve sueldos y datos personales identificables. */
const ROLES_CON_DATOS_SENSIBLES: UserRole[] = ["SUPER_ADMIN", "ADMIN"];

/**
 * Campos expuestos por fuente. La clave es el id que usa el cliente; `column`
 * es la referencia calificada con tabla (obligatorio: `status` y `branch_id`
 * existen en users y en employee_profiles, y sin calificar Postgres aborta por
 * ambigüedad). `label` es la cabecera humana del CSV, `sensitive` marca lo que
 * exige rol de dirección.
 *
 * Esta tabla es la única fuente de verdad de qué campos existen: el cliente la
 * consume por GET en vez de mantener su propia copia. Antes el constructor
 * ofrecía 17 campos de empleado y la consulta devolvía otros 8, así que 15
 * columnas salían vacías y el dueño concluía que no tenía los datos cargados.
 */
type CampoReporte = {
  label: string;
  category: string;
  column: any;
  sensitive?: boolean;
};

const CAMPOS: Record<string, Record<string, CampoReporte>> = {
  employees: {
    employeeNumber: { label: "Número de empleado", category: "Información básica", column: employeeProfiles.employeeNumber },
    name: { label: "Nombre completo", category: "Información básica", column: users.name },
    email: { label: "Correo de acceso", category: "Información básica", column: users.email },
    role: { label: "Rol en el sistema", category: "Información básica", column: users.role },
    department: { label: "Departamento", category: "Profesional", column: employeeProfiles.department },
    position: { label: "Puesto", category: "Profesional", column: employeeProfiles.position },
    employeeStatus: { label: "Estado", category: "Profesional", column: employeeProfiles.employeeStatus },
    hireDate: { label: "Fecha de contratación", category: "Profesional", column: employeeProfiles.hireDate },
    terminationDate: { label: "Fecha de baja", category: "Profesional", column: employeeProfiles.terminationDate },
    terminationReason: { label: "Motivo de baja", category: "Profesional", column: employeeProfiles.terminationReason },
    branchName: { label: "Sucursal", category: "Profesional", column: branches.name },
    gender: { label: "Género", category: "Datos personales", column: employeeProfiles.gender, sensitive: true },
    dateOfBirth: { label: "Fecha de nacimiento", category: "Datos personales", column: employeeProfiles.dateOfBirth, sensitive: true },
    curp: { label: "CURP", category: "Datos personales", column: employeeProfiles.curp, sensitive: true },
    rfc: { label: "RFC", category: "Datos personales", column: employeeProfiles.rfc, sensitive: true },
    nss: { label: "NSS", category: "Datos personales", column: employeeProfiles.nss, sensitive: true },
    personalEmail: { label: "Correo personal", category: "Contacto", column: employeeProfiles.personalEmail, sensitive: true },
    personalPhone: { label: "Teléfono personal", category: "Contacto", column: employeeProfiles.personalPhone, sensitive: true },
    city: { label: "Ciudad", category: "Contacto", column: employeeProfiles.city },
    state: { label: "Estado", category: "Contacto", column: employeeProfiles.state },
  },
  contracts: {
    contractNumber: { label: "Número de contrato", category: "Contrato", column: employeeContracts.contractNumber },
    employeeName: { label: "Empleado", category: "Contrato", column: users.name },
    contractType: { label: "Tipo de contrato", category: "Contrato", column: employeeContracts.contractType },
    workRegime: { label: "Régimen de trabajo", category: "Contrato", column: employeeContracts.workRegime },
    startDate: { label: "Fecha de inicio", category: "Contrato", column: employeeContracts.startDate },
    endDate: { label: "Fecha de fin", category: "Contrato", column: employeeContracts.endDate },
    status: { label: "Estado del contrato", category: "Contrato", column: employeeContracts.status },
    branchName: { label: "Sucursal", category: "Contrato", column: branches.name },
    baseSalary: { label: "Sueldo diario", category: "Compensación", column: employeeContracts.baseSalary, sensitive: true },
    monthlySalary: { label: "Sueldo mensual", category: "Compensación", column: employeeContracts.monthlySalary, sensitive: true },
    weeklySalary: { label: "Sueldo semanal", category: "Compensación", column: employeeContracts.weeklySalary, sensitive: true },
  },
  documents: {
    employeeName: { label: "Empleado", category: "Documento", column: users.name },
    documentType: { label: "Tipo de documento", category: "Documento", column: employeeDocuments.documentType },
    documentName: { label: "Nombre del documento", category: "Documento", column: employeeDocuments.documentName },
    status: { label: "Estado", category: "Documento", column: employeeDocuments.status },
    branchName: { label: "Sucursal", category: "Documento", column: branches.name },
    issueDate: { label: "Fecha de emisión", category: "Vigencia", column: employeeDocuments.issueDate },
    expirationDate: { label: "Fecha de vencimiento", category: "Vigencia", column: employeeDocuments.expirationDate },
    isRequired: { label: "Requerido", category: "Vigencia", column: employeeDocuments.isRequired },
    isValid: { label: "Vigente", category: "Vigencia", column: employeeDocuments.isValid },
  },
};

/** Operadores soportados de verdad por el generador de SQL de abajo. */
const OPERADORES = new Set([
  "equals",
  "contains",
  "starts_with",
  "greater_than",
  "less_than",
  "is_null",
  "is_not_null",
]);

const COLUMNA_FECHA: Record<string, any> = {
  employees: users.createdAt,
  contracts: employeeContracts.createdAt,
  documents: employeeDocuments.createdAt,
};

const COLUMNA_SUCURSAL: Record<string, any> = {
  employees: users.branchId,
  contracts: employeeContracts.branchId,
  documents: employeeDocuments.branchId,
};

/**
 * Tipo del campo derivado de la propia columna de drizzle, no de una lista
 * paralela que se desincroniza. El cliente lo usa para pintar el input correcto
 * y aquí convierte el valor antes de comparar: mandar el texto "true" contra
 * una columna boolean aborta la consulta en Postgres.
 */
function tipoDeCampo(col: any): "boolean" | "number" | "date" | "text" {
  switch (col?.dataType) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "date":
      return "date";
    default:
      return "text";
  }
}

function convertirValor(col: any, valor: string) {
  switch (tipoDeCampo(col)) {
    case "boolean":
      return ["true", "sí", "si", "1"].includes(String(valor).toLowerCase());
    case "number": {
      const n = Number(valor);
      if (Number.isNaN(n)) {
        throw ApiError.badRequest(`"${valor}" no es un número válido`);
      }
      return n;
    }
    case "date": {
      const d = new Date(valor);
      if (Number.isNaN(d.getTime())) {
        throw ApiError.badRequest(`"${valor}" no es una fecha válida`);
      }
      return d;
    }
    default:
      return valor;
  }
}

function construirFiltros(
  dataSource: string,
  filters: Array<{ field: string; operator: string; value: string }> | undefined,
  puedeVerSensibles: boolean
) {
  const conditions: any[] = [];
  if (!Array.isArray(filters)) return conditions;

  for (const f of filters) {
    if (!f?.field || !f?.operator) continue;

    const campo = CAMPOS[dataSource]?.[f.field];
    // Campo inexistente o vedado: error explícito. Antes se ignoraba en
    // silencio, así que el reporte salía sin el filtro que el usuario pidió y
    // nada se lo decía.
    if (!campo) {
      throw ApiError.badRequest(`El campo "${f.field}" no existe en esta fuente de datos`);
    }
    if (campo.sensitive && !puedeVerSensibles) {
      throw ApiError.forbidden(`Tu rol no puede filtrar por "${campo.label}"`);
    }
    if (!OPERADORES.has(f.operator)) {
      throw ApiError.badRequest(`Operador no soportado: "${f.operator}"`);
    }

    const col = campo.column;
    const tipo = tipoDeCampo(col);

    // `contains`/`starts_with` sólo tienen sentido sobre texto; sobre una fecha
    // o un booleano Postgres aborta y el usuario veía "Error al generar la
    // vista previa" sin saber cuál de sus filtros era el imposible.
    if ((f.operator === "contains" || f.operator === "starts_with") && tipo !== "text") {
      throw ApiError.badRequest(`"${campo.label}" no admite el operador de texto seleccionado`);
    }

    switch (f.operator) {
      case "equals":
        conditions.push(eq(col, convertirValor(col, f.value)));
        break;
      case "contains":
        conditions.push(ilike(col, `%${f.value}%`));
        break;
      case "starts_with":
        conditions.push(ilike(col, `${f.value}%`));
        break;
      case "greater_than":
        conditions.push(sql`${col} > ${convertirValor(col, f.value)}`);
        break;
      case "less_than":
        conditions.push(sql`${col} < ${convertirValor(col, f.value)}`);
        break;
      case "is_null":
        conditions.push(sql`${col} IS NULL`);
        break;
      case "is_not_null":
        conditions.push(sql`${col} IS NOT NULL`);
        break;
    }
  }

  return conditions;
}

function baseQuery(dataSource: string, seleccion: Record<string, any>) {
  switch (dataSource) {
    case "employees":
      return db
        .select(seleccion)
        .from(users)
        .leftJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
        .leftJoin(branches, eq(users.branchId, branches.id));
    case "contracts":
      return db
        .select(seleccion)
        .from(employeeContracts)
        .leftJoin(users, eq(employeeContracts.userId, users.id))
        .leftJoin(branches, eq(employeeContracts.branchId, branches.id));
    case "documents":
      return db
        .select(seleccion)
        .from(employeeDocuments)
        .leftJoin(users, eq(employeeDocuments.userId, users.id))
        .leftJoin(branches, eq(employeeDocuments.branchId, branches.id));
    default:
      throw ApiError.badRequest(`Fuente de datos desconocida: ${dataSource}`);
  }
}

function columnaEmpresa(dataSource: string) {
  switch (dataSource) {
    case "employees":
      return users.companyId;
    case "contracts":
      return employeeContracts.companyId;
    default:
      return employeeDocuments.companyId;
  }
}

/** Comillas, comas, saltos de línea y BOM — Excel abre "Peña" sin romperlo. */
function aCsv(headers: string[], rows: (string | number)[][]) {
  const escapar = (valor: string | number) => {
    const str = String(valor ?? "");
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const cuerpo = [headers.map(escapar).join(","), ...rows.map((r) => r.map(escapar).join(","))].join("\r\n");
  return `﻿${cuerpo}`;
}

function formatearValor(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === "boolean") return valor ? "Sí" : "No";
  return String(valor);
}

/**
 * GET — catálogo de campos disponibles para la fuente pedida, ya filtrado por
 * lo que el rol puede ver. El cliente lo pinta tal cual, así que no puede
 * ofrecer una casilla que la consulta no sepa devolver.
 */
export const GET = withRoleAuth(ROLES_CON_REPORTES, async (req, { auth }) => {
  const url = new URL(req.url);
  const dataSource = url.searchParams.get("dataSource") || "employees";

  if (!CAMPOS[dataSource]) {
    throw ApiError.badRequest(`Fuente de datos desconocida: ${dataSource}`);
  }

  const puedeVerSensibles = ROLES_CON_DATOS_SENSIBLES.includes(auth.user.role as UserRole);

  const fields = Object.entries(CAMPOS[dataSource])
    .filter(([, campo]) => !campo.sensitive || puedeVerSensibles)
    .map(([id, campo]) => ({
      id,
      label: campo.label,
      category: campo.category,
      kind: tipoDeCampo(campo.column),
      sensitive: Boolean(campo.sensitive),
    }));

  return NextResponse.json({ success: true, data: { dataSource, fields, puedeVerSensibles } });
});

export const POST = withRoleAuth(ROLES_CON_REPORTES, async (req, { auth }) => {
  const inicio = Date.now();
  const body = await req.json();
  const { dataSource, fields, filters, dateFrom, dateTo, format, branchId } = body as {
    dataSource?: string;
    fields?: string[];
    filters?: Array<{ field: string; operator: string; value: string }>;
    dateFrom?: string;
    dateTo?: string;
    format?: string;
    branchId?: string | null;
  };

  if (!dataSource || !CAMPOS[dataSource]) {
    throw ApiError.badRequest(`Fuente de datos desconocida: ${dataSource ?? "(vacía)"}`);
  }

  const pedidos = Array.isArray(fields) ? fields : [];
  if (pedidos.length === 0) {
    throw ApiError.badRequest("Selecciona al menos un campo");
  }

  const puedeVerSensibles = ROLES_CON_DATOS_SENSIBLES.includes(auth.user.role as UserRole);

  // Selección: sólo campos que existen y que el rol puede ver.
  const seleccion: Record<string, any> = {};
  for (const id of pedidos) {
    const campo = CAMPOS[dataSource][id];
    if (!campo) {
      throw ApiError.badRequest(`El campo "${id}" no existe en esta fuente de datos`);
    }
    if (campo.sensitive && !puedeVerSensibles) {
      throw ApiError.forbidden(`Tu rol no puede exportar "${campo.label}"`);
    }
    seleccion[id] = campo.column;
  }

  // El alcance de sucursal lo decide el servidor: GERENTE queda fijado a la
  // suya aunque el cliente mande otra o "todas".
  //
  // Un rol de sucursal SIN sucursal asignada no exporta nada: antes caía en el
  // mismo `null` que "todas" y se llevaba el grupo entero, columnas sensibles
  // incluidas. Un archivo vacío sería peor que un error —parecería un dato—, así
  // que esto corta con 403.
  const alcance = resolveBranchScope(auth.user.role as Role, auth.branchId, branchId ?? null);
  if (alcance.kind === "NONE") {
    throw ApiError.forbidden(
      "Tu usuario no tiene una sucursal asignada. Pídele a un administrador que te asigne una para exportar."
    );
  }
  const sucursal = alcance.kind === "BRANCH" ? alcance.branchId : null;

  const conditions: any[] = [eq(columnaEmpresa(dataSource), auth.tenantId)];
  if (sucursal) conditions.push(eq(COLUMNA_SUCURSAL[dataSource], sucursal));
  if (dateFrom) conditions.push(gte(COLUMNA_FECHA[dataSource], new Date(dateFrom)));
  if (dateTo) conditions.push(lte(COLUMNA_FECHA[dataSource], new Date(dateTo)));
  conditions.push(...construirFiltros(dataSource, filters, puedeVerSensibles));

  let data: any[];
  try {
    data = await baseQuery(dataSource, seleccion).where(and(...conditions));
  } catch (error) {
    log.error({ err: error, dataSource, fields: pedidos }, "consulta de reporte falló");
    throw ApiError.badRequest(
      "No se pudo ejecutar la consulta con esos filtros. Revisa los valores y vuelve a intentar."
    );
  }

  // Rastro de quién exportó qué: sin esto un CSV con sueldos sale de la empresa
  // sin dejar registro que el dueño pueda consultar después.
  try {
    await db.insert(reportExecutionHistory).values({
      companyId: auth.tenantId,
      reportType: "CUSTOM",
      dataSource,
      executedBy: auth.user.id,
      filters: filters ?? [],
      fields: pedidos,
      status: "SUCCESS",
      rowCount: data.length,
      durationMs: Date.now() - inicio,
    });
  } catch (error) {
    // El registro es importante pero no debe tumbar la exportación.
    log.error({ err: error }, "no se pudo registrar la ejecución del reporte");
  }

  if (format === "csv") {
    const headers = pedidos.map((id) => CAMPOS[dataSource][id].label);
    const rows = data.map((row) => pedidos.map((id) => formatearValor(row[id])));
    const nombre = `reporte-${dataSource}-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(aCsv(headers, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nombre}"`,
      },
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      rows: data,
      total: data.length,
      columns: pedidos.map((id) => ({ id, label: CAMPOS[dataSource][id].label })),
    },
  });
});
