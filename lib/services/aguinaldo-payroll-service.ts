/**
 * Run de aguinaldo: previsualización, timbrado extraordinario (c_TipoNomina
 * "E", CFDI 002) y registro en payroll_runs/payroll_payslips.
 *
 * Cada empleado recibe UN CFDI 002 por año causado con el periodo
 * 1-ene a 31-dic —jamás se mezcla con la nómina ordinaria del
 * periodo—. La exención (30 UMA) y el gravado se declaran en la
 * percepción 002 (`percepcionAguinaldo`); la retención opcional Art. 174
 * usa la parte gravada y el procedimiento mensual, con tarifa exacta por año.
 *
 * Idempotencia en dos capas:
 *   • DB: índice parcial único `payroll_runs_company_aguinaldo_year_unique`
 *     — un run por empresa y año causado.
 *   • Servicio: guarda previa antes de ejecutar (409 lógico si ya existe
 *     un run del mismo companyId+año). El servicio fiscal deduplica TIMBRADO
 *     por (companyId, rfc, periodo "AAAA-AGU"). La recuperación comparte el
 *     consumidor de snapshots y conserva las intenciones fiscales inciertas.
 */
import { db } from "@/lib/db";
import { withCompanyContext } from "@/lib/db/tenant-context";
import {
    payrollRuns,
    payrollPayslips,
    payrollAguinaldoDispersiones,
    users,
    employeeProfiles,
    employeeContracts,
} from "@/lib/db/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { calcularAguinaldoAnual, diasCalendarioAguinaldo, resolverEstatusLegal, DIAS_PRORRATEO, type AguinaldoCalculo, type AguinaldoLegalEstatus, type AguinaldoBase } from "./aguinaldo-service";
import { resolveFiscalLaborLawRules } from "./labor-rules-resolver";
import { recuperarAguinaldoRun } from "./aguinaldo-run-execution";
export { recuperarAguinaldoRun } from "./aguinaldo-run-execution";
import { calcularPagoAguinaldo, hoyCivilAguinaldo, resolverFechaPagoAguinaldo, type AguinaldoPago } from "./aguinaldo-payment";
import { resolverTarifaParaAnio } from "./isr-annual-withholding";
import { crearSnapshotAguinaldo } from "./aguinaldo-snapshot";
import { getTenantOperatingConfig } from "./tenant-config-service";
import { resolveAguinaldoBase, resolveEffectiveSalary } from "./employee-service";
import { cargarFuentesDiasAguinaldo } from "./aguinaldo-days-adapter";
import { proponerDiasAguinaldo } from "./aguinaldo-days-policy";

export interface AguinaldoPreviewRow {
    userId: string;
    name: string;
    rfc: string | null;
    branchId: string | null;
    /** Salario de registro del contrato (lo que timbra el CFDI). */
    salarioDiarioCents: number;
    /** Task 11: salario efectivo real; sin capturar/tiempo formal = igual al registrado. */
    salarioEfectivoCents: number;
    /** Gap efectivo − registro. 0 = formal. Nunca se oculta en la preview. */
    gapSalarioCents: number;
    esFormal: boolean;
    /** Días calendario del año fiscal desde la antigüedad (fallback). */
    diasCalendario: number;
    /** Días a cobrar: override manual si viene; si no, propuesta auditable o calendario. */
    diasLaborados: number;
    /** Fecha fuente de la antigüedad usada para el fallback. */
    fechaAntiguedad: string | null;
    /** Cálculo TIMBRABLE: salario de registro (el CFDI 002 sólo cubre la parte registrada). */
    calculo: AguinaldoCalculo | null;
    pago: AguinaldoPago | null;
    /** Cálculo sobre el salario efectivo real; NULL cuando el empleado es formal. */
    calculoEfectivo: AguinaldoCalculo | null;
    /**
     * bruto efectivo − bruto registrado. Con base REGISTERED es liabilidad
     * contingente (pagable sólo si el trabajador reclama, prescripción 1 año
     * LFT art. 516); con base EFFECTIVE es excedente a dispersar en efectivo
     * con bitácora. 0 cuando es formal.
     */
    diferenciaCents: number;
    /**
     * DIA-02: fuente de los días usados. MANUAL = el admin tocó el campo
     * (prevalece, incluido cero); PROPUESTA_AUDITABLE = calendario de vigencia
     * menos ausencias aprobadas desde las fuentes reales; CALENDARIO = sin
     * propuesta calculable (fallback).
     */
    fuenteDias?: "MANUAL" | "PROPUESTA_AUDITABLE" | "CALENDARIO";
    /** Días propuestos por la propuesta auditable (NULL si no se pudo calcular). */
    diasAutomaticos: number | null;
    /** Auditoría de la propuesta de días (DIA-01/DIA-02): corte, zona y pendientes. */
    propuestaDias?: {
        desde: string;
        hasta: string;
        fechaCorte: string;
        zona: string;
        diasCalendario: number;
        diasNoComputables: number;
        diasPropuestos: number;
        diasConTurno: number;
        pendientes: number;
        conflictos: number;
        requiereRevision: boolean;
        contieneProyeccion: boolean;
        coberturaFuentes: "PARCIAL";
        fechasNoComputables: string[];
    };
    /** Dato faltante o contrato no activo: no puede timbrar. */
    error?: string;
}

export interface AguinaldoPreview {
    companyId: string;
    anioFiscal: number;
    fechaPago: string;
    /** Fila por empleado activo con o sin contrato. */
    rows: AguinaldoPreviewRow[];
    estatusLegal: AguinaldoLegalEstatus;
    /** Regla de ley resuelta por fecha (tabla de ley o fallback estático). */
    fuenteRegla: "law-table" | "static-fallback";
    /** Días legales resueltos para el cálculo (hoy 15, Art. 87). */
    aguinaldoDaysMxn: number;
    umaDailyCents: number | null;
    /** Base configurada del inquilino (Task 11): REGISTERED default, o EFFECTIVE (sub-registro). */
    base: AguinaldoBase;
    /** Inquilinos en MIXED pueden capturar salario efectivo; FORMAL nunca hay gap. */
    practiceMode: "FORMAL" | "MIXED";
    totalBrutoCents: number;
    totalExentoCents: number;
    totalGravadoCents: number;
    totalDeduccionesCents: number;
    totalNetoCents: number;
    /** Suma de la diferencia efectivo vs registro de los timbrables (~liabilidad o excedente). */
    totalDiferenciaCents: number;
    empleadosATimbrar: number;
    empleadosSinRFC: number;
    /** DIA-02: avisos de cobertura/zona de la propuesta de días (no bloqueantes). */
    advertenciasDias: string[];
}

export interface ExecuteAguinaldoDias {
    /** Fecha civil del pago; se conserva en preview y ejecución, separada del año causado. */
    fechaPago?: string;
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
            effectiveSalaryCents: employeeContracts.effectiveSalaryCents,
            contractStatus: employeeContracts.status,
        })
        .from(users)
        .innerJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
        .leftJoin(
            employeeContracts,
            and(eq(users.id, employeeContracts.userId), eq(employeeContracts.companyId, companyId), eq(employeeContracts.status, "ACTIVE"))
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
        const efectivo = resolveEffectiveSalary(emp.baseSalary ?? 0, emp.effectiveSalaryCents);

        const base: AguinaldoPreviewRow = {
            userId: emp.userId,
            name: emp.name || "Sin Nombre",
            rfc,
            branchId: emp.branchId ?? null,
            salarioDiarioCents: emp.baseSalary ?? 0,
            salarioEfectivoCents: efectivo.salarioEfectivoCents,
            gapSalarioCents: efectivo.gapCents,
            esFormal: efectivo.esFormal,
            diasCalendario,
            diasLaborados: diasCalendario,
            fechaAntiguedad,
            calculo: null,
            pago: null,
            calculoEfectivo: null,
            diferenciaCents: 0,
            diasAutomaticos: null,
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

async function resolverReglaLey(fechaPago: string) {
    // Mediodía UTC conserva la fecha civil en el selector de vigencias.
    const law = await resolveFiscalLaborLawRules(new Date(`${fechaPago}T12:00:00Z`), ["umaDailyMxn"]);
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
    // Validar antes de resolver fuentes o crear el run: null/NaN/string no
    // significan "sin override" y cero es un ajuste manual válido.
    for (const value of Object.values(dias.diasLaboradosPorUsuario ?? {})) {
        if (!Number.isInteger(value) || value < 0 || value > DIAS_PRORRATEO + 1) {
            throw new RangeError(`diasLaborados inválido (0..${DIAS_PRORRATEO + 1}): ${value}`);
        }
    }
    const fecha = resolverFechaPagoAguinaldo(dias.fechaPago === undefined ? hoyCivilAguinaldo() : dias.fechaPago);
    // Incluso un importe cero exige una publicación fiscal del año exacto.
    resolverTarifaParaAnio(fecha.anioPago);
    const regla = await resolverReglaLey(fecha.fechaPago);
    const rowsBase = await cargarPlantillaAguinaldo(companyId, anioFiscal, branchId);

    // DIA-02: propuesta auditable desde las fuentes reales (calendario de
    // vigencia − ausencias aprobadas), no un conteo de checadas. El override
    // manual sigue prevaleciendo, incluido el cero explícito.
    const fuentes = await cargarFuentesDiasAguinaldo({
        companyId,
        anioFiscal,
        empleados: rowsBase.map((row) => ({ userId: row.userId, branchId: row.branchId })),
    });

    // Task 11: la base y práctica de nómina salen de la config del inquilino.
    const config = await getTenantOperatingConfig(companyId);
    const base = resolveAguinaldoBase(config.aguinaldoBase);
    const practiceMode = config.payrollPracticeMode === "MIXED" ? "MIXED" as const : "FORMAL" as const;

    const rows: AguinaldoPreviewRow[] = rowsBase.map((row) => {
        if (row.error) return row;
        const manual = dias.diasLaboradosPorUsuario?.[row.userId];
        const fuente = fuentes.porUsuario[row.userId];
        let propuesta: ReturnType<typeof proponerDiasAguinaldo> | null = null;
        let errorPropuesta: string | undefined;
        if (fuente && row.fechaAntiguedad) {
            try {
                propuesta = proponerDiasAguinaldo({
                    anioFiscal,
                    fechaAntiguedad: row.fechaAntiguedad,
                    fechaCorte: fuentes.fechaCorte,
                    zona: fuente.zona,
                    diasConTurno: fuente.diasConTurno,
                    ausencias: fuente.ausencias,
                });
            } catch (err) {
                // Un dato corrupto de un empleado no debe tumbar la preview completa.
                errorPropuesta = `No se pudo proponer días: ${err instanceof Error ? err.message : String(err)}`;
            }
        }
        const propuestaDias: AguinaldoPreviewRow["propuestaDias"] = propuesta
            ? {
                desde: propuesta.desde,
                hasta: propuesta.hasta,
                fechaCorte: propuesta.fechaCorte,
                zona: propuesta.zona,
                diasCalendario: propuesta.diasCalendario,
                diasNoComputables: propuesta.diasNoComputables,
                diasPropuestos: propuesta.diasPropuestos,
                diasConTurno: propuesta.diasConTurno,
                pendientes: propuesta.pendientes.length,
                conflictos: propuesta.conflictos.length,
                requiereRevision: propuesta.requiereRevision,
                contieneProyeccion: propuesta.contieneProyeccion,
                coberturaFuentes: propuesta.coberturaFuentes,
                fechasNoComputables: propuesta.fechasNoComputables,
            }
            : undefined;
        let diasLaborados: number;
        let fuenteDias: "MANUAL" | "PROPUESTA_AUDITABLE" | "CALENDARIO";
        if (typeof manual === "number") {
            diasLaborados = manual;
            fuenteDias = "MANUAL";
        } else if (propuesta) {
            diasLaborados = propuesta.diasPropuestos;
            fuenteDias = "PROPUESTA_AUDITABLE";
        } else {
            diasLaborados = row.diasCalendario;
            fuenteDias = "CALENDARIO";
        }
        // El CFDI 002 SIEMPRE cubre la parte registrada; el gap jamás se timbra.
        const calculo = calcularAguinaldoAnual({
            anioFiscal,
            salarioDiarioCents: row.salarioDiarioCents,
            diasLaborados,
            aguinaldoDaysMxn: regla.aguinaldoDaysMxn,
            umaDailyCents: regla.umaDailyCents,
            base: "REGISTERED",
        });
        // Segunda columna: bruto si se pagara sobre el salario efectivo real.
        const calculoEfectivo = row.esFormal
            ? null
            : calcularAguinaldoAnual({
                anioFiscal,
                salarioDiarioCents: row.salarioEfectivoCents,
                diasLaborados,
                aguinaldoDaysMxn: regla.aguinaldoDaysMxn,
                umaDailyCents: regla.umaDailyCents,
                base: "EFFECTIVE",
            });
        const diferenciaCents = calculoEfectivo
            ? calculoEfectivo.brutoCents - calculo.brutoCents
            : 0;
        let pago: AguinaldoPago | null = null;
        let error: string | undefined;
        try {
            pago = calcularPagoAguinaldo(calculo, row.salarioDiarioCents, fecha.fechaPago);
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
        }
        if (errorPropuesta && !error) error = errorPropuesta;
        // DIA-01/DIA-02: una clasificación pendiente o un conflicto no se
        // entrega como conteo definitivo autorizado; el override manual —aun
        // cero— es la vía explícita para confirmarlo.
        if (typeof manual !== "number" && propuesta?.requiereRevision && !error) {
            error = `Días por revisar: ${propuesta.pendientes.length} permiso(s) sin clasificar y `
                + `${propuesta.conflictos.length} conflicto(s) entre ausencia y día protegido. `
                + "Confirma los días manualmente o corrige el catálogo de permisos.";
        }
        return {
            ...row,
            diasLaborados,
            fuenteDias,
            diasAutomaticos: propuesta ? propuesta.diasPropuestos : null,
            propuestaDias,
            calculo,
            pago,
            error,
            calculoEfectivo,
            diferenciaCents,
        };
    });

    const totales = rows.reduce(
        (acc, r) => {
            if (!r.calculo || r.error || !r.pago || !r.rfc) return acc;
            acc.bruto += r.calculo.brutoCents;
            acc.exento += r.calculo.exentoCents;
            acc.gravado += r.calculo.gravadoCents;
            acc.deducciones += r.pago.totalDeduccionesCents;
            acc.neto += r.pago.netoCents;
            acc.diferencia += r.diferenciaCents;
            return acc;
        },
        { bruto: 0, exento: 0, gravado: 0, deducciones: 0, neto: 0, diferencia: 0 }
    );

    return {
        companyId,
        anioFiscal,
        fechaPago: fecha.fechaPago,
        rows,
        estatusLegal: regla.estatusLegal,
        fuenteRegla: regla.source,
        aguinaldoDaysMxn: regla.aguinaldoDaysMxn,
        umaDailyCents: regla.umaDailyCents,
        base,
        practiceMode,
        totalBrutoCents: totales.bruto,
        totalExentoCents: totales.exento,
        totalGravadoCents: totales.gravado,
        totalDeduccionesCents: totales.deducciones,
        totalNetoCents: totales.neto,
        totalDiferenciaCents: totales.diferencia,
        empleadosATimbrar: rows.filter((r) => !r.error && r.rfc && r.pago).length,
        empleadosSinRFC: rows.filter((r) => !r.error && !r.rfc).length,
        advertenciasDias: [
            ...fuentes.advertencias,
            ...(rows.some((r) => r.propuestaDias?.contieneProyeccion)
                ? ["Proyección anual: el corte consultado es anterior al cierre del año causado; los días posteriores no son faltas."]
                : []),
        ],
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
    const [existente] = await withCompanyContext({ companyId }, (tx) => tx
        .select({ id: payrollRuns.id, status: payrollRuns.status })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.aguinaldoFiscalYear, anioFiscal)))
        .limit(1));
    if (existente) throw new AguinaldoRunDuplicadoError(anioFiscal);

    const preview = await previsualizarAguinaldo(companyId, anioFiscal, branchId, dias);
    const bloqueos = preview.rows.filter((row) => row.error || !row.rfc || !row.calculo || !row.pago);
    if (bloqueos.length > 0) {
        throw new RangeError(bloqueos.map((row) => `${row.name}: ${row.error ?? "Falta RFC o cálculo de pago."}`).join(" · "));
    }
    if (preview.rows.length === 0) throw new RangeError("No hay empleados para ejecutar el aguinaldo.");
    const snapshot = crearSnapshotAguinaldo(preview, performedBy ?? "system", branchId);
    // Una sola transacción: ningún folio se solicita antes de conservar TODOS
    // los importes autorizados. No mantener la transacción abierta frente al PAC.
    const { run } = await withCompanyContext({ companyId, branchId, actorId: snapshot.cabecera.performedBy }, async (tx) => {
        const [run] = await tx.insert(payrollRuns).values({
            companyId, periodStart: `${anioFiscal}-01-01`, periodEnd: `${anioFiscal}-12-31`,
            status: "PROCESSING", aguinaldoFiscalYear: anioFiscal, aguinaldoSnapshot: snapshot.cabecera,
        }).onConflictDoNothing().returning();
        if (!run) throw new AguinaldoRunDuplicadoError(anioFiscal);
        const pendientes = await tx.insert(payrollPayslips).values(snapshot.empleados.map((row) => ({
            runId: run.id, userId: row.userId, aguinaldoSnapshot: row,
            aguinaldoCents: row.calculo.brutoCents, totalPercepcionesCents: row.calculo.brutoCents,
            totalDeduccionesCents: row.pago.totalDeduccionesCents, cfdiStatus: "PENDIENTE",
        }))).returning();
        return { run, pendientes };
    });

    return recuperarAguinaldoRun(companyId, run.id);
}

/** Runs de aguinaldo de la empresa (historial para la UI de Task 7). */
export async function getAguinaldoRuns(companyId: string) {
    return withCompanyContext({ companyId }, (tx) => tx
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
        .orderBy(desc(payrollRuns.createdAt)));
}

/** Error de negocio del registro manual del excedente (400 para la API). */
export class AguinaldoDispersionInvalidaError extends Error {
    constructor(mensaje: string) {
        super(mensaje);
        this.name = "AguinaldoDispersionInvalidaError";
    }
}

export interface RegistrarDispersionInput {
    anioFiscal: number;
    userId: string;
    montoCents: number;
    motivo: string;
    performedBy: string;
}

/**
 * Task 11 (decisión Q5) — dispersión manual del excedente en efectivo,
 * con bitácora y sin CFDI: acción POST propia de la API de Task 6.
 *
 * Reglas:
 *   • Sólo inquilinos con `aguinaldoBase = EFFECTIVE`: en REGISTERED el gap es
 *     liabilidad contingente, NO se paga (pagar en efectivo y no registrarlo
 *     profundiza el sub-registro).
 *   • El empleado debe existir en la empresa; el monto es positivo y entero.
 *   • Motivo obligatorio: la bitácora vale como prueba de dispersión real.
 */
export async function registrarDispersionExcedente(
    companyId: string,
    input: RegistrarDispersionInput
): Promise<typeof payrollAguinaldoDispersiones.$inferSelect> {
    if (!Number.isInteger(input.montoCents) || input.montoCents <= 0) {
        throw new AguinaldoDispersionInvalidaError(
            `El monto a dispersar debe ser un entero positivo de centavos: ${input.montoCents}`
        );
    }
    if (!input.motivo?.trim()) {
        throw new AguinaldoDispersionInvalidaError("El motivo de la dispersión en efectivo es obligatorio.");
    }

    const config = await getTenantOperatingConfig(companyId);
    if (resolveAguinaldoBase(config.aguinaldoBase) !== "EFFECTIVE") {
        throw new AguinaldoDispersionInvalidaError(
            "La base del aguinado configurada es REGISTERED: el gap es liabilidad contingente, no se paga ni se dispersa en efectivo."
        );
    }

    return withCompanyContext({ companyId, actorId: input.performedBy }, async (tx) => {
        const empleado = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, input.userId), eq(users.companyId, companyId)))
            .limit(1);
        if (empleado.length === 0) {
            throw new AguinaldoDispersionInvalidaError("Empleado no encontrado en esta empresa.");
        }

        const [row] = await tx
            .insert(payrollAguinaldoDispersiones)
            .values({
                companyId,
                source: "MANUAL",
                userId: input.userId,
                anioFiscal: input.anioFiscal,
                montoCents: input.montoCents,
                motivo: input.motivo.trim(),
                performedBy: input.performedBy,
            })
            .returning();
        return row;
    });
}

/** Bitácora de las dispersiones de excedente (por empresa y año para la UI). */
export async function listarDispersionesExcedente(companyId: string, anioFiscal?: number) {
    return withCompanyContext({ companyId }, (tx) => tx
        .select({
            id: payrollAguinaldoDispersiones.id,
            userId: payrollAguinaldoDispersiones.userId,
            userName: users.name,
            anioFiscal: payrollAguinaldoDispersiones.anioFiscal,
            montoCents: payrollAguinaldoDispersiones.montoCents,
            motivo: payrollAguinaldoDispersiones.motivo,
            source: payrollAguinaldoDispersiones.source,
            fechaDispersion: payrollAguinaldoDispersiones.fechaDispersion,
            performedBy: payrollAguinaldoDispersiones.performedBy,
        })
        .from(payrollAguinaldoDispersiones)
        .innerJoin(users, eq(users.id, payrollAguinaldoDispersiones.userId))
        .where(
            and(
                eq(payrollAguinaldoDispersiones.companyId, companyId),
                ...(anioFiscal ? [eq(payrollAguinaldoDispersiones.anioFiscal, anioFiscal)] : [])
            )
        )
        .orderBy(desc(payrollAguinaldoDispersiones.fechaDispersion))
        .limit(200));
}
