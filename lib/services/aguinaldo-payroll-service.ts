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
    payrollAguinaldoDispersiones,
    users,
    employeeProfiles,
    employeeContracts,
} from "@/lib/db/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { calcularAguinaldoAnual, diasCalendarioAguinaldo, resolverEstatusLegal, type AguinaldoCalculo, type AguinaldoLegalEstatus, type AguinaldoBase } from "./aguinaldo-service";
import { resolveLaborLawRules } from "./labor-rules-resolver";
import { timbrarNomina, percepcionAguinaldo } from "./fiscal-service";
import { calcularRetencionAguinaldoArt174 } from "./isr-annual-withholding";
import { getTenantOperatingConfig } from "./tenant-config-service";
import { resolveAguinaldoBase, resolveEffectiveSalary } from "./employee-service";
import { conteoDiasLaboradosAnual, type FuenteDias } from "./dias-laborados-service";

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
    /** Días a cobrar: manual por el admin si viene; fallback al calendario. */
    diasLaborados: number;
    /** Fecha fuente de la antigüedad usada para el fallback. */
    fechaAntiguedad: string | null;
    /** Cálculo TIMBRABLE: salario de registro (el CFDI 002 sólo cubre la parte registrada). */
    calculo: AguinaldoCalculo | null;
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
     * Task 14: fuente de los días usados. MANUAL = el admin tocó el campo
     * (prevalece); TURNOS_Y_PERMISOS = conteo automático cruzado;
     * CALENDARIO = fallback calendario sin turnos/permisos capturados.
     */
    fuenteDias?: FuenteDias | "MANUAL" | "CALENDARIO";
    /** Días propuestos por el conteo automático (NULL si no hay datos). */
    diasAutomaticos: number | null;
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
    /** Suma de la diferencia efectivo vs registro de los timbrables (~liabilidad o excedente). */
    totalDiferenciaCents: number;
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
            effectiveSalaryCents: employeeContracts.effectiveSalaryCents,
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

    // Task 14: conteo automático turnos COMPLETED ∪ permisos pagados.
    // Propuesto ≡ ajustable: el valor manual del admin prevalece.
    const conteo = await conteoDiasLaboradosAnual(companyId, anioFiscal);

    // Task 11: la base y práctica de nómina salen de la config del inquilino.
    const config = await getTenantOperatingConfig(companyId);
    const base = resolveAguinaldoBase(config.aguinaldoBase);
    const practiceMode = config.payrollPracticeMode === "MIXED" ? "MIXED" as const : "FORMAL" as const;

    const rows: AguinaldoPreviewRow[] = rowsBase.map((row) => {
        if (row.error) return row;
        const manual = dias.diasLaboradosPorUsuario?.[row.userId];
        const auto = conteo.porUsuario[row.userId];
        let diasLaborados: number;
        let fuenteDias: "MANUAL" | "TURNOS_Y_PERMISOS" | "CALENDARIO";
        if (typeof manual === "number") {
            diasLaborados = manual;
            fuenteDias = "MANUAL";
        } else if (auto && auto.dias > 0) {
            diasLaborados = auto.dias;
            fuenteDias = "TURNOS_Y_PERMISOS";
        } else {
            diasLaborados = row.diasCalendario;
            fuenteDias = "CALENDARIO";
        }
        // El CFDI 002 SIEMPRE cubre la parte registrada; el gap jamás se timbra.
        const calculo = calcularAguinaldoAnual({
            anioFiscal,
            salarioDiarioCents: row.salarioDiarioCents,
            diasLaborados: diasLaborados || undefined,
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
                diasLaborados: diasLaborados || undefined,
                aguinaldoDaysMxn: regla.aguinaldoDaysMxn,
                umaDailyCents: regla.umaDailyCents,
                base: "EFFECTIVE",
            });
        const diferenciaCents = calculoEfectivo
            ? calculoEfectivo.brutoCents - calculo.brutoCents
            : 0;
        return {
            ...row,
            diasLaborados,
            fuenteDias,
            diasAutomaticos: auto && auto.dias > 0 ? auto.dias : row.diasAutomaticos,
            calculo,
            calculoEfectivo,
            diferenciaCents,
        };
    });

    const totales = rows.reduce(
        (acc, r) => {
            if (!r.calculo) return acc;
            acc.bruto += r.calculo.brutoCents;
            acc.exento += r.calculo.exentoCents;
            acc.gravado += r.calculo.gravadoCents;
            acc.diferencia += r.diferenciaCents;
            return acc;
        },
        { bruto: 0, exento: 0, gravado: 0, diferencia: 0 }
    );

    return {
        companyId,
        anioFiscal,
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
        totalDiferenciaCents: totales.diferencia,
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
    // Task 11: con base EFFECTIVE, la parte del aguinado que excede lo timbrable
    // (el gap de salario) se dispersa en efectivo y se registra en bitácora SIN
    // CFDI; el CFDI 002 sólo cubre la parte registrada.
    const config = await getTenantOperatingConfig(companyId);
    const debeDispersarExcedente = resolveAguinaldoBase(config.aguinaldoBase) === "EFFECTIVE";

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
    /** El mes hipotético del Art. 174 usa el mes REAL de dispersión (subsidio de enero especial). */
    const mesPago = new Date().getMonth() + 1;

    for (const row of preview.rows) {
        try {
            if (row.error) throw new Error(row.error);
            if (!row.rfc) throw new Error(`Empleado ${row.name} no tiene RFC configurado.`);
            if (!row.calculo) throw new Error(`Empleado ${row.name} sin cálculo de aguinaldo.`);

            // Task 13 (Q1): tarifa anual Art. 174 RLISR. Tarifa del año y mes
            // de DISPERSIÓN (el Art. 96 del mes hipotético aplica al periodo
            // en el que se retiene, aunque el aguinaldo sea del año anterior).
            const anioPago = new Date().getFullYear();
            const retencion = calcularRetencionAguinaldoArt174({
                anioPago,
                mesPago,
                aguinaldoBrutoCents: row.calculo.brutoCents,
                salarioDiarioCents: row.salarioDiarioCents,
            });

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
                // Percepción única: bruto con exento/gravado separados.
                desglosePercepciones: [percepcionAguinaldo(row.calculo.brutoCents, row.calculo.exentoCents)],
                totalPercepciones: row.calculo.brutoCents,
                // Retención de ISR del gravado: tarifa anual Art. 174 RLISR
                // (Task 13, decisión Q1) — método favorable al trabajador;
                // se aplica sobre el aguinaldo íntegro, no por cada run.
                totalDeducciones: retencion.retencionCents > 0 ? retencion.retencionCents : 0,
                desgloseDeducciones:
                    retencion.retencionCents > 0
                        ? [{
                            deductionTypeCode: "002",
                            code: "002",
                            concept: `ISR retenido del aguinaldo ${anioFiscal} (Art. 174 RLISR)`,
                            amount: retencion.retencionCents,
                        }]
                        : undefined,
            });

            const [payslip] = await db
                .insert(payrollPayslips)
                .values({
                    runId: run.id,
                    userId: row.userId,
                    aguinaldoCents: row.calculo.brutoCents,
                    totalPercepcionesCents: row.calculo.brutoCents,
                    totalDeduccionesCents: retencion.retencionCents > 0 ? retencion.retencionCents : 0,
                    cfdiUuid: timbrado.uuid || null,
                    cfdiStatus: timbrado.status,
                    selloDigital: timbrado.selloDigital,
                })
                .returning();

            results.push({ success: true, userId: row.userId, payslip });

            // Bitácora del excedente en efectivo: registro con fecha, autorizador
            // y motivo — jamás una percepción CFDI. Nadie lo verá en nómina timbrada.
            if (debeDispersarExcedente && row.diferenciaCents > 0) {
                await db.insert(payrollAguinaldoDispersiones).values({
                    companyId,
                    runId: run.id,
                    source: "RUN",
                    userId: row.userId,
                    anioFiscal,
                    montoCents: row.diferenciaCents,
                    motivo: `Excedente del aguinado ${anioFiscal} pagado fuera de nómina: el CFDI 002 cubre sólo la parte de salario de registro; el gap se pagó en efectivo porque la base configurada del inquilino es EFFECTIVE (base real, J. 1a./J. 24/2023).`,
                    performedBy: performedBy ?? "system",
                });
            }
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

    const empleado = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.companyId, companyId)))
        .limit(1);
    if (empleado.length === 0) {
        throw new AguinaldoDispersionInvalidaError("Empleado no encontrado en esta empresa.");
    }

    const [row] = await db
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
}

/** Bitácora de las dispersiones de excedente (por empresa y año para la UI). */
export async function listarDispersionesExcedente(companyId: string, anioFiscal?: number) {
    return await db
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
        .limit(200);
}
