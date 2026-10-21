/**
 * Run de aguinaldo: previsualización, timbrado extraordinario (c_TipoNomina
 * "E", CFDI 002) y registro en payroll_runs/payroll_payslips.
 *
 * Cada empleado recibe UN CFDI 002 por año causado con el periodo
 * 1-ene a 31-dic —jamás se mezcla con la nómina ordinaria del
 * periodo—. La exención (30 UMA) y el gravado se declaran en la
 * percepción 002 (`percepcionAguinaldo`); la RETENCIÓN va en 0
 * (decisión Q1: tarifa anual Art. 174 RLISR en Task 13).
 *
 * Idempotencia en dos capas:
 *   • DB: índice parcial único `payroll_runs_company_aguinaldo_year_unique`
 *     — un run por empresa y año causado.
 *   • Servicio: guarda previa antes de ejecutar (409 lógico si ya existe
 *     un run del mismo companyId+año, TIMBRADO's dedupe por
 *     (companyId, rfc, periodo "AAAA-AGU") protege el reintento por empleado).
 */
import { db } from "@/lib/db";
import {
    payrollRuns,
    payrollPayslips,
    users,
    employeeProfiles,
    employeeContracts,
} from "@/lib/db/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { calcularAguinaldoAnual, diasCalendarioAguinaldo, resolverEstatusLegal, type AguinaldoCalculo, type AguinaldoLegalEstatus } from "./aguinaldo-service";
import { resolveLaborLawRules } from "./labor-rules-resolver";
import { timbrarNomina, percepcionAguinaldo } from "./fiscal-service";

export interface AguinaldoPreviewRow {
    userId: string;
    name: string;
    rfc: string | null;
    branchId: string | null;
    salarioDiarioCents: number;
    /** Días calendario del año fiscal desde la antigüedad (fallback). */
    diasCalendario: number;
    /** Días a cobrar: manual por el admin si viene; fallback al calendario. */
    diasLaborados: number;
    /** Fecha fuente de la antigüedad usada para el fallback. */
    fechaAntiguedad: string | null;
    calculo: AguinaldoCalculo | null;
    /** Dato faltante o contrato no activo: no puede timbrar. */
    error?: string;
}

export interface AguinaldoPreview {
    companyId: string;
    anioFiscal: number;
    /** Fila por empleado activo con o sin contrato. */
    rows: AguinaldoPreviewRow[];
    estatusLegal: AguinaldoLegalEstatus;
    /** Regla de ley resuelta por fecha (tabla de ley o fallback estático). */
    fuenteRegla: "law-table" | "static-fallback";
    umaDailyCents: number | null;
    totalBrutoCents: number;
    totalExentoCents: number;
    totalGravadoCents: number;
    empleadosATimbrar: number;
    empleadosSinRFC: number;
}

export interface ExecuteAguinaldoDias {
    /** Ajuste manual "días a considerar" por usuario (semántica PROFEDET ya aplicada). */
    diasLaboradosPorUsuario?: Record<string, number>;
}

export interface AguinaldoRunResult {
    runId: string;
    results: Array<{ success: boolean; userId: string; payslip?: unknown; error?: string }>;
}

/** Fecha de antigüedad en ISO. seniorityDate manda; fallback hireDate. */
function isoFecha(d: Date | string | null | undefined): string | null {
    if (!d) return null;
    const iso = (d instanceof Date ? d.toISOString() : String(d));
    return iso.slice(0, 10);
}

async function cargarPlantillaAguinaldo(companyId: string, anioFiscal: number, branchId?: string): Promise<AguinaldoPreviewRow[]> {
    const roster = await db
        .select({
            userId: users.id,
            name: users.name,
            branchId: users.branchId,
            rfc: employeeProfiles.rfc,
            hireDate: employeeProfiles.hireDate,
            seniorityDate: employeeProfiles.seniorityDate,
            isActive: employeeProfiles.isActive,
            baseSalary: employeeContracts.baseSalary,
            contractStatus: employeeContracts.status,
        })
        .from(users)
        .innerJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
        .leftJoin(
            employeeContracts,
            and(eq(users.id, employeeContracts.userId), eq(employeeContracts.status, "ACTIVE"))
        )
        .where(
            and(
                eq(users.companyId, companyId),
                eq(employeeProfiles.isActive, true),
                ...(branchId ? [eq(users.branchId, branchId)] : [])
            )
        );

    return roster.map((emp) => {
        const rfc = emp.rfc ?? null;
        const tieneContrato = emp.contractStatus === "ACTIVE" && emp.baseSalary != null;
        const fechaAntiguedad = isoFecha(emp.seniorityDate) ?? isoFecha(emp.hireDate);
        const diasCalendario = diasCalendarioAguinaldo(anioFiscal, fechaAntiguedad ?? undefined);

        const base: AguinaldoPreviewRow = {
            userId: emp.userId,
            name: emp.name || "Sin Nombre",
            rfc,
            branchId: emp.branchId ?? null,
            salarioDiarioCents: emp.baseSalary ?? 0,
            diasCalendario,
            diasLaborados: diasCalendario,
            fechaAntiguedad,
            calculo: null,
        };

        if (!tieneContrato) {
            return { ...base, error: "Sin contrato ACTIVO con salario: no aguinaldo." };
        }
        if (diasCalendario === 0) {
            return { ...base, error: "Sin antigüedad en el año fiscal: no aguinaldo." };
        }
        return base;
    });
}

async function resolverReglaLey() {
    // Vigencia al pago (hoy): Art. 87 y exención de 30 UMA vigentes en la fecha de dispersión.
    const law = await resolveLaborLawRules(new Date());
    return {
        aguinaldoDaysMxn: law.aguinaldoDaysMxn,
        umaDailyCents: law.umaDailyMxn != null ? Math.round(law.umaDailyMxn * 100) : null,
        source: law.source,
        estatusLegal: resolverEstatusLegal(law.aguinaldoDaysMxn),
    };
}

/**
 * Preview 1:1 con el timbre futuro. NO ejecuta nada contra FiscalAPI. Los
 * totales suman SOLO los timbrables (con error quedan
 * visibles con su causa, no en el total).
 */
export async function previsualizarAguinaldo(
    companyId: string,
    anioFiscal: number,
    branchId?: string,
    dias: ExecuteAguinaldoDias = {}
): Promise<AguinaldoPreview> {
    if (!Number.isInteger(anioFiscal) || anioFiscal < 1970 || anioFiscal > 2200) {
        throw new RangeError(`anioFiscal inválido: ${anioFiscal}`);
    }
    const regla = await resolverReglaLey();
    const rowsBase = await cargarPlantillaAguinaldo(companyId, anioFiscal, branchId);

    const rows: AguinaldoPreviewRow[] = rowsBase.map((row) => {
        if (row.error) return row;
        const manual = dias.diasLaboradosPorUsuario?.[row.userId];
        const diasLaborados = typeof manual === "number" ? manual : row.diasCalendario;
        const calculo = calcularAguinaldoAnual({
            anioFiscal,
            salarioDiarioCents: row.salarioDiarioCents,
            diasLaborados: diasLaborados || undefined,
            aguinaldoDaysMxn: regla.aguinaldoDaysMxn,
            umaDailyCents: regla.umaDailyCents,
        });
        return { ...row, diasLaborados, calculo };
    });

    const totales = rows.reduce(
        (acc, r) => {
            if (!r.calculo) return acc;
            acc.bruto += r.calculo.brutoCents;
            acc.exento += r.calculo.exentoCents;
            acc.gravado += r.calculo.gravadoCents;
            return acc;
        },
        { bruto: 0, exento: 0, gravado: 0 }
    );

    return {
        companyId,
        anioFiscal,
        rows,
        estatusLegal: regla.estatusLegal,
        fuenteRegla: regla.source,
        umaDailyCents: regla.umaDailyCents,
        totalBrutoCents: totales.bruto,
        totalExentoCents: totales.exento,
        totalGravadoCents: totales.gravado,
        empleadosATimbrar: rows.filter((r) => !r.error).length,
        empleadosSinRFC: rows.filter((r) => !r.error && !r.rfc).length,
    };
}

/** Error de conflicto de idempotencia (409 lógico para la API de Task 6). */
export class AguinaldoRunDuplicadoError extends Error {
    constructor(anioFiscal: number) {
        super(`Ya existe un run de aguinaldo ${anioFiscal} para esta empresa (idempotencia por companyId+año).`);
        this.name = "AguinaldoRunDuplicadoError";
    }
}

/**
 * Ejecuta el run: timbra un CFDI 002 extraordinario ("E") por empleado
 * y guarda el payslip con `aguinaldoCents` — igual que la nómina
 * ordinaria, los errores van por empleado en `results[]` y no abortan el run.
 */
export async function executeAguinaldoRun(
    companyId: string,
    anioFiscal: number,
    performedBy?: string,
    dias: ExecuteAguinaldoDias = {},
    branchId?: string
): Promise<AguinaldoRunResult> {
    // Guarda de idempotencia (el índice único es la red de la carrera).
    const [existente] = await db
        .select({ id: payrollRuns.id, status: payrollRuns.status })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.aguinaldoFiscalYear, anioFiscal)))
        .limit(1);
    if (existente) throw new AguinaldoRunDuplicadoError(anioFiscal);

    const preview = await previsualizarAguinaldo(companyId, anioFiscal, branchId, dias);

    const [run] = await db
        .insert(payrollRuns)
        .values({
            companyId,
            periodStart: `${anioFiscal}-01-01`,
            periodEnd: `${anioFiscal}-12-31`,
            status: "PROCESSING",
            aguinaldoFiscalYear: anioFiscal,
        })
        .returning();

    const periodo = `${anioFiscal}-AGU`;
    const fechaPago = new Date().toISOString().slice(0, 10);
    const results: AguinaldoRunResult["results"] = [];

    for (const row of preview.rows) {
        try {
            if (row.error) throw new Error(row.error);
            if (!row.rfc) throw new Error(`Empleado ${row.name} no tiene RFC configurado.`);
            if (!row.calculo) throw new Error(`Empleado ${row.name} sin cálculo de aguinaldo.`);

            const timbrado = await timbrarNomina({
                companyId,
                performedBy,
                empleadoRfc: row.rfc,
                empleadoNombre: row.name,
                empleadoFechaContratacion: row.fechaAntiguedad ?? undefined,
                empleadoSalarioDiarioCents: row.salarioDiarioCents,
                periodo,
                payrollTypeCode: "E",
                fechaPagoInicial: `${anioFiscal}-01-01`,
                fechaPagoFinal: `${anioFiscal}-12-31`,
                fechaPago,
                // Percepción única: bruto con exento/gravado separados;
                // retención en 0 (decisión Q1: Task 13 integra la tarifa anual).
                desglosePercepciones: [percepcionAguinaldo(row.calculo.brutoCents, row.calculo.exentoCents)],
                totalPercepciones: row.calculo.brutoCents,
                totalDeducciones: 0,
            });

            const [payslip] = await db
                .insert(payrollPayslips)
                .values({
                    runId: run.id,
                    userId: row.userId,
                    aguinaldoCents: row.calculo.brutoCents,
                    totalPercepcionesCents: row.calculo.brutoCents,
                    totalDeduccionesCents: 0,
                    cfdiUuid: timbrado.uuid || null,
                    cfdiStatus: timbrado.status,
                    selloDigital: timbrado.selloDigital,
                })
                .returning();

            results.push({ success: true, userId: row.userId, payslip });
        } catch (err: unknown) {
            const mensaje = err instanceof Error ? err.message : String(err);
            console.error(`Error timbrando aguinaldo ${anioFiscal} para ${row.userId}:`, mensaje);
            results.push({ success: false, userId: row.userId, error: mensaje });
            await db.insert(payrollPayslips).values({
                runId: run.id,
                userId: row.userId,
                aguinaldoCents: row.calculo?.brutoCents ?? 0,
                totalPercepcionesCents: row.calculo?.brutoCents ?? 0,
                totalDeduccionesCents: 0,
                cfdiStatus: "ERROR",
            });
        }
    }

    const hasErrors = results.some((r) => !r.success);
    await db
        .update(payrollRuns)
        .set({ status: hasErrors ? "COMPLETED_WITH_ERRORS" : "COMPLETED", updatedAt: new Date() })
        .where(eq(payrollRuns.id, run.id));

    return { runId: run.id, results };
}

/** Runs de aguinaldo de la empresa (historial para la UI de Task 7). */
export async function getAguinaldoRuns(companyId: string) {
    return await db
        .select({
            id: payrollRuns.id,
            aguinaldoFiscalYear: payrollRuns.aguinaldoFiscalYear,
            status: payrollRuns.status,
            periodStart: payrollRuns.periodStart,
            periodEnd: payrollRuns.periodEnd,
            createdAt: payrollRuns.createdAt,
        })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, companyId), gte(payrollRuns.aguinaldoFiscalYear, 1970)))
        .orderBy(desc(payrollRuns.createdAt));
}
