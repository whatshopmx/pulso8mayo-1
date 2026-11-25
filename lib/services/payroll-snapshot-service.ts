/**
 * NOM-03 & NOM-04.a — Aprobación de snapshot inmutable de nómina ordinaria y
 * unificación de recibos y exportación CSV desde la misma versión congelada.
 *
 * Garantías:
 * - Aprobar un borrador congela entradas, versiones de reglas (ISR/IMSS/UMA),
 *   importes por empleado, totales y actor aprobador (`approvedBy`, `approvedAt`).
 * - Modificar cualquier entrada antes de aprobar cambia `inputFingerprint` e
 *   invalida el borrador (`STALE` o conflicto `409` al intentar aprobar).
 * - Control optimista (`WHERE status = 'DRAFT' AND snapshot_version = $expected
 *   AND input_fingerprint = $current`): una carrera entre editar y aprobar o dos
 *   aprobaciones concurrentes nunca publican una versión obsoleta ni duplican.
 * - Recibos (`readApprovedPayrollSnapshot`) y exportación (`buildPayrollSnapshotCsv`)
 *   consumen exactamente el mismo snapshot congelado; reexportar jamás recalcula
 *   asistencia ni salarios vivos.
 */

import { createHash } from "node:crypto";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { ApiError } from "@/lib/api/error";
import { db } from "@/lib/db";
import { payrollPayslips, payrollRuns } from "@/lib/db/schema";
import {
  timbrarNomina,
  type NominaDeduccion,
  type NominaPercepcion,
  type NominaTimbradoInput,
  type NominaTimbradoResult,
  type NominaTimbradoStatus,
  type TimbrarNominaOptions,
} from "./fiscal-service";
import type { PayrollCompletenessReport } from "./payroll-completeness-service";

export interface OrdinaryPayrollPayslipSnapshot {
  userId: string;
  employeeNumber: string;
  employeeName: string;
  rfc: string;
  curp: string;
  nss: string;
  dailySalaryCents: number;
  payableDays: number;
  baseSalaryCents: number;
  propinasCents: number;
  holidayPayCents: number;
  overtimePayCents: number;
  vacationPrimeCents: number;
  bonusesAndIncidencesCents: number;
  isrRetenidoCents: number;
  imssObreroCents: number;
  loanDeductionsCents: number;
  incidenceDeductionsCents: number;
  totalPercepcionesCents: number;
  totalDeduccionesCents: number;
  netPayCents: number;
  employerSocialSecurityCents: number;
  desglosePercepciones: NominaPercepcion[];
  desgloseDeducciones: NominaDeduccion[];
  completeness: PayrollCompletenessReport;
}

export interface OrdinaryPayrollRunSnapshot {
  schemaVersion: 1;
  snapshotVersion: number;
  periodStart: string;
  periodEnd: string;
  inputFingerprint: string;
  ruleVersions: {
    isrTableVersion: string | null;
    imssRuleVersion: string | null;
    umaDailyCents: number | null;
  };
  totals: {
    employeeCount: number;
    totalPercepcionesCents: number;
    totalDeduccionesCents: number;
    totalNetoCents: number;
    totalEmployerBurdenCents: number;
  };
  approvedBy: string | null;
  approvedAt: string | null;
}

export function computePayrollInputFingerprint(input: {
  periodStart: string;
  periodEnd: string;
  ruleVersions: OrdinaryPayrollRunSnapshot["ruleVersions"];
  payslips: readonly OrdinaryPayrollPayslipSnapshot[];
}): string {
  const canonical = {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    ruleVersions: input.ruleVersions,
    payslips: [...input.payslips]
      .sort((a, b) => a.userId.localeCompare(b.userId))
      .map((p) => ({
        userId: p.userId,
        dailySalaryCents: p.dailySalaryCents,
        payableDays: p.payableDays,
        baseSalaryCents: p.baseSalaryCents,
        propinasCents: p.propinasCents,
        holidayPayCents: p.holidayPayCents,
        overtimePayCents: p.overtimePayCents,
        vacationPrimeCents: p.vacationPrimeCents,
        bonusesAndIncidencesCents: p.bonusesAndIncidencesCents,
        isrRetenidoCents: p.isrRetenidoCents,
        imssObreroCents: p.imssObreroCents,
        loanDeductionsCents: p.loanDeductionsCents,
        incidenceDeductionsCents: p.incidenceDeductionsCents,
        totalPercepcionesCents: p.totalPercepcionesCents,
        totalDeduccionesCents: p.totalDeduccionesCents,
        netPayCents: p.netPayCents,
        employerSocialSecurityCents: p.employerSocialSecurityCents,
      })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function summarizePayslipTotals(
  payslips: readonly OrdinaryPayrollPayslipSnapshot[]
): OrdinaryPayrollRunSnapshot["totals"] {
  return payslips.reduce(
    (acc, p) => ({
      employeeCount: acc.employeeCount + 1,
      totalPercepcionesCents: acc.totalPercepcionesCents + p.totalPercepcionesCents,
      totalDeduccionesCents: acc.totalDeduccionesCents + p.totalDeduccionesCents,
      totalNetoCents: acc.totalNetoCents + p.netPayCents,
      totalEmployerBurdenCents: acc.totalEmployerBurdenCents + p.employerSocialSecurityCents,
    }),
    {
      employeeCount: 0,
      totalPercepcionesCents: 0,
      totalDeduccionesCents: 0,
      totalNetoCents: 0,
      totalEmployerBurdenCents: 0,
    }
  );
}

export async function createPayrollDraftSnapshot(
  input: {
    companyId: string;
    periodStart: string;
    periodEnd: string;
    ruleVersions: OrdinaryPayrollRunSnapshot["ruleVersions"];
    payslips: readonly OrdinaryPayrollPayslipSnapshot[];
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbInstance: any = db
): Promise<{
  runId: string;
  snapshotVersion: number;
  inputFingerprint: string;
  snapshot: OrdinaryPayrollRunSnapshot;
}> {
  if (input.payslips.length === 0) {
    throw ApiError.badRequest("No se puede crear un borrador de nómina sin empleados.");
  }

  for (const p of input.payslips) {
    const expectedNet = p.totalPercepcionesCents - p.totalDeduccionesCents;
    if (p.netPayCents !== expectedNet) {
      throw ApiError.badRequest(
        `Inconsistencia aritmética en recibo de ${p.employeeName}: neto ${p.netPayCents} != percepciones ${p.totalPercepcionesCents} - deducciones ${p.totalDeduccionesCents}.`
      );
    }
  }

  const inputFingerprint = computePayrollInputFingerprint(input);
  const totals = summarizePayslipTotals(input.payslips);
  const snapshot: OrdinaryPayrollRunSnapshot = {
    schemaVersion: 1,
    snapshotVersion: 1,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    inputFingerprint,
    ruleVersions: input.ruleVersions,
    totals,
    approvedBy: null,
    approvedAt: null,
  };

  const [run] = await dbInstance
    .insert(payrollRuns)
    .values({
      companyId: input.companyId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: "DRAFT",
      snapshotVersion: 1,
      inputFingerprint,
      ordinarySnapshot: snapshot,
    })
    .returning({ id: payrollRuns.id });

  await dbInstance.insert(payrollPayslips).values(
    input.payslips.map((p) => ({
      runId: run.id,
      userId: p.userId,
      baseSalaryCents: p.baseSalaryCents,
      propinasCents: p.propinasCents,
      holidayPayCents: p.holidayPayCents,
      overtimePayCents: p.overtimePayCents,
      bonusesCents: p.bonusesAndIncidencesCents,
      isrRetenidoCents: p.isrRetenidoCents,
      imssObreroCents: p.imssObreroCents,
      loanDeductionsCents: p.loanDeductionsCents,
      totalPercepcionesCents: p.totalPercepcionesCents,
      totalDeduccionesCents: p.totalDeduccionesCents,
      netPayCents: p.netPayCents,
      ordinarySnapshot: p,
    }))
  );

  return {
    runId: run.id,
    snapshotVersion: 1,
    inputFingerprint,
    snapshot,
  };
}

/**
 * Invalida explícitamente un borrador cuando cambia una entrada subyacente
 * (asistencia, bono, salario o préstamo). Incrementa `snapshot_version` y marca
 * `status = 'STALE'` para impedir que una aprobación concurrente publique una
 * versión obsoleta.
 */
export async function invalidatePayrollDraft(
  input: {
    companyId: string;
    runId: string;
    reason?: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbInstance: any = db
): Promise<{ invalidated: boolean; newVersion: number | null }> {
  const updated = await dbInstance
    .update(payrollRuns)
    .set({
      status: "STALE",
      snapshotVersion: sql`${payrollRuns.snapshotVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(payrollRuns.id, input.runId),
        eq(payrollRuns.companyId, input.companyId),
        eq(payrollRuns.status, "DRAFT")
      )
    )
    .returning({ snapshotVersion: payrollRuns.snapshotVersion });

  if (updated.length === 0) {
    return { invalidated: false, newVersion: null };
  }
  return { invalidated: true, newVersion: updated[0].snapshotVersion };
}

/**
 * Aprueba atómicamente un borrador congelando actor, fecha y versión.
 * Rechaza con 409 si:
 * - el borrador fue invalidado (`STALE`) o ya fue aprobado,
 * - `expectedVersion` no coincide (carrera editar↔aprobar o doble aprobación),
 * - `currentFingerprint` cambió respecto al borrador congelado,
 * - algún empleado tiene bloqueos de completitud (NOM-06).
 */
export async function approvePayrollSnapshot(
  input: {
    companyId: string;
    runId: string;
    approvedBy: string;
    expectedVersion: number;
    currentFingerprint: string;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbInstance: any = db
): Promise<{
  runId: string;
  status: "APPROVED";
  snapshotVersion: number;
  approvedBy: string;
  approvedAt: string;
  snapshot: OrdinaryPayrollRunSnapshot;
}> {
  if (!input.approvedBy.trim()) {
    throw ApiError.forbidden("Se requiere un actor autenticado para aprobar la nómina.");
  }

  const [existing] = await dbInstance
    .select({
      id: payrollRuns.id,
      status: payrollRuns.status,
      snapshotVersion: payrollRuns.snapshotVersion,
      inputFingerprint: payrollRuns.inputFingerprint,
      ordinarySnapshot: payrollRuns.ordinarySnapshot,
    })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, input.runId), eq(payrollRuns.companyId, input.companyId)))
    .limit(1);

  if (!existing) {
    throw ApiError.notFound("Corrida de nómina no encontrada.");
  }
  if (existing.status !== "DRAFT") {
    throw ApiError.conflict(
      `No se puede aprobar la corrida en estado ${existing.status}; genera un nuevo borrador actualizado.`
    );
  }
  if (existing.snapshotVersion !== input.expectedVersion) {
    throw ApiError.conflict(
      `Conflicto de versión al aprobar nómina (esperada ${input.expectedVersion}, actual ${existing.snapshotVersion}).`
    );
  }
  if (existing.inputFingerprint !== input.currentFingerprint) {
    await invalidatePayrollDraft({ companyId: input.companyId, runId: input.runId }, dbInstance);
    throw ApiError.conflict(
      "Las entradas de nómina cambiaron después de generar el borrador; el borrador fue invalidado."
    );
  }

  // Verificar completitud NOM-06 en los recibos del borrador
  const draftPayslips = await dbInstance
    .select({
      userId: payrollPayslips.userId,
      ordinarySnapshot: payrollPayslips.ordinarySnapshot,
    })
    .from(payrollPayslips)
    .where(eq(payrollPayslips.runId, input.runId));

  for (const row of draftPayslips) {
    const snap = row.ordinarySnapshot as OrdinaryPayrollPayslipSnapshot | null;
    if (!snap || !snap.completeness?.canApprove) {
      throw ApiError.badRequest(
        `El borrador contiene resultados incompletos para el empleado ${row.userId}; corrige los bloqueos antes de aprobar.`
      );
    }
  }

  const approvedAt = new Date();
  const prevSnapshot = existing.ordinarySnapshot as OrdinaryPayrollRunSnapshot;
  const nextVersion = existing.snapshotVersion + 1;
  const frozenSnapshot: OrdinaryPayrollRunSnapshot = {
    ...prevSnapshot,
    snapshotVersion: nextVersion,
    approvedBy: input.approvedBy,
    approvedAt: approvedAt.toISOString(),
  };

  // Condición atómica optimista: protege contra carrera real entre dos conexiones
  const updated = await dbInstance
    .update(payrollRuns)
    .set({
      status: "APPROVED",
      approvedBy: input.approvedBy,
      approvedAt,
      snapshotVersion: nextVersion,
      ordinarySnapshot: frozenSnapshot,
      updatedAt: approvedAt,
    })
    .where(
      and(
        eq(payrollRuns.id, input.runId),
        eq(payrollRuns.companyId, input.companyId),
        eq(payrollRuns.status, "DRAFT"),
        eq(payrollRuns.snapshotVersion, input.expectedVersion),
        eq(payrollRuns.inputFingerprint, input.currentFingerprint)
      )
    )
    .returning({ id: payrollRuns.id, snapshotVersion: payrollRuns.snapshotVersion });

  if (updated.length === 0) {
    throw ApiError.conflict(
      "La corrida fue modificada o aprobada concurrentemente; recarga la versión vigente."
    );
  }

  return {
    runId: input.runId,
    status: "APPROVED",
    snapshotVersion: nextVersion,
    approvedBy: input.approvedBy,
    approvedAt: approvedAt.toISOString(),
    snapshot: frozenSnapshot,
  };
}

export interface ApprovedPayrollSnapshotBundle {
  runId: string;
  status: string;
  snapshotVersion: number;
  header: OrdinaryPayrollRunSnapshot;
  payslips: OrdinaryPayrollPayslipSnapshot[];
}

/**
 * NOM-04.a: Lector único para recibos y exportación. Jamás recalcula asistencia ni
 * consulta contratos vivos; exige una corrida aprobada o completada con snapshot congelado.
 */
export async function readApprovedPayrollSnapshot(
  companyId: string,
  runId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbInstance: any = db
): Promise<ApprovedPayrollSnapshotBundle> {
  const [run] = await dbInstance
    .select({
      id: payrollRuns.id,
      status: payrollRuns.status,
      snapshotVersion: payrollRuns.snapshotVersion,
      ordinarySnapshot: payrollRuns.ordinarySnapshot,
    })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.companyId, companyId)))
    .limit(1);

  if (!run) {
    throw ApiError.notFound("Corrida de nómina no encontrada.");
  }
  if ((run.status !== "APPROVED" && run.status !== "COMPLETED") || !run.ordinarySnapshot) {
    throw ApiError.conflict(
      `La corrida ${runId} no tiene un snapshot aprobado inmutable (estado actual: ${run.status}).`
    );
  }

  const rows = await dbInstance
    .select({
      ordinarySnapshot: payrollPayslips.ordinarySnapshot,
    })
    .from(payrollPayslips)
    .where(eq(payrollPayslips.runId, runId));

  const payslips = rows
    .map((r: { ordinarySnapshot: OrdinaryPayrollPayslipSnapshot | null }) => r.ordinarySnapshot)
    .filter((s: OrdinaryPayrollPayslipSnapshot | null): s is OrdinaryPayrollPayslipSnapshot => Boolean(s))
    .sort((a: OrdinaryPayrollPayslipSnapshot, b: OrdinaryPayrollPayslipSnapshot) =>
      a.userId.localeCompare(b.userId)
    );

  return {
    runId: run.id,
    status: run.status,
    snapshotVersion: run.snapshotVersion,
    header: run.ordinarySnapshot as OrdinaryPayrollRunSnapshot,
    payslips,
  };
}

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

function centsToPesos(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * NOM-04.a: Genera CSV de nómina directamente desde el snapshot inmutable aprobado.
 * Garantiza que las sumas y netos de cada empleado coinciden exactamente con los
 * recibos y la cabecera congelada.
 */
export function buildPayrollSnapshotCsv(bundle: ApprovedPayrollSnapshotBundle): string {
  const headers = [
    "RunId",
    "SnapshotVersion",
    "PeriodoInicio",
    "PeriodoFin",
    "NumeroEmpleado",
    "Nombre",
    "NSS",
    "CURP",
    "RFC",
    "DiasPagaderos",
    "SalarioDiario",
    "SueldoBase",
    "Propinas",
    "Festivo",
    "HorasExtra",
    "PrimaVacacional",
    "BonosIncidencias",
    "TotalPercepciones",
    "ISR",
    "IMSS",
    "Prestamos",
    "OtrasDeducciones",
    "TotalDeducciones",
    "PercepcionNeta",
    "CargaPatronal",
  ];

  const rows = bundle.payslips.map((p) =>
    [
      bundle.runId,
      bundle.snapshotVersion,
      bundle.header.periodStart,
      bundle.header.periodEnd,
      p.employeeNumber,
      p.employeeName,
      p.nss,
      p.curp,
      p.rfc,
      p.payableDays,
      centsToPesos(p.dailySalaryCents),
      centsToPesos(p.baseSalaryCents),
      centsToPesos(p.propinasCents),
      centsToPesos(p.holidayPayCents),
      centsToPesos(p.overtimePayCents),
      centsToPesos(p.vacationPrimeCents),
      centsToPesos(p.bonusesAndIncidencesCents),
      centsToPesos(p.totalPercepcionesCents),
      centsToPesos(p.isrRetenidoCents),
      centsToPesos(p.imssObreroCents),
      centsToPesos(p.loanDeductionsCents),
      centsToPesos(p.incidenceDeductionsCents),
      centsToPesos(p.totalDeduccionesCents),
      centsToPesos(p.netPayCents),
      centsToPesos(p.employerSocialSecurityCents),
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\r\n");
}

/**
 * NOM-04.b: Construye el payload de timbrado CFDI directamente desde el
 * snapshot inmutable aprobado (`ordinary_snapshot`), garantizando que recibo,
 * exportación CSV y CFDI consuman exactamente los mismos importes congelados.
 */
export function buildTimbradoInputFromPayslipSnapshot(input: {
  companyId: string;
  performedBy?: string;
  header: OrdinaryPayrollRunSnapshot;
  payslip: OrdinaryPayrollPayslipSnapshot;
}): NominaTimbradoInput {
  const { companyId, performedBy, header, payslip } = input;

  if (!payslip.completeness?.canStamp || !payslip.completeness?.canApprove) {
    throw ApiError.badRequest(
      `El snapshot del empleado ${payslip.employeeName || payslip.userId} no cumple completitud NOM-06 para timbrado.`
    );
  }
  const rfc = payslip.rfc?.trim().toUpperCase();
  if (!rfc || rfc.length < 12 || rfc.length > 13) {
    throw ApiError.badRequest(
      `El empleado ${payslip.employeeName || payslip.userId} no tiene RFC válido en el snapshot aprobado.`
    );
  }
  if (payslip.totalPercepcionesCents - payslip.totalDeduccionesCents !== payslip.netPayCents) {
    throw ApiError.badRequest(
      `Inconsistencia aritmética en snapshot de ${payslip.employeeName}: neto ${payslip.netPayCents} != percepciones ${payslip.totalPercepcionesCents} - deducciones ${payslip.totalDeduccionesCents}.`
    );
  }

  return {
    companyId,
    performedBy,
    empleadoRfc: rfc,
    empleadoNombre: payslip.employeeName,
    empleadoCurp: payslip.curp || undefined,
    empleadoNss: payslip.nss || undefined,
    empleadoSalarioDiarioCents: payslip.dailySalaryCents,
    periodo: `${header.periodStart} - ${header.periodEnd}`,
    fechaPagoInicial: header.periodStart,
    fechaPagoFinal: header.periodEnd,
    fechaPago: header.periodEnd,
    payrollTypeCode: "O",
    totalPercepciones: payslip.totalPercepcionesCents,
    totalDeducciones: payslip.totalDeduccionesCents,
    desglosePercepciones: payslip.desglosePercepciones,
    desgloseDeducciones: payslip.desgloseDeducciones,
  };
}

export interface StampedPayslipOutcome {
  userId: string;
  empleadoRfc: string;
  empleadoNombre: string;
  status: NominaTimbradoStatus;
  uuid: string;
  selloDigital: string;
  fechaTimbrado: string;
  totalPercepcionesCents: number;
  totalDeduccionesCents: number;
  netPayCents: number;
  error?: string;
}

export interface StampApprovedSnapshotResult {
  runId: string;
  snapshotVersion: number;
  inputFingerprint: string;
  periodStart: string;
  periodEnd: string;
  results: StampedPayslipOutcome[];
}

/**
 * NOM-04.b: Timbra CFDI de nómina ordinaria exclusivamente desde el snapshot
 * inmutable aprobado (`ordinary_snapshot`), persiste `cfdi_uuid` / `cfdi_status`
 * / `sello_digital` en `payroll_payslips` (sin sobrescribir un folio ya
 * `TIMBRADO`) y conserva la idempotencia durable de `cfdi_nomina_timbrados`.
 */
export async function stampApprovedPayrollSnapshot(
  input: {
    companyId: string;
    runId: string;
    userId?: string;
    performedBy?: string;
  },
  options?: TimbrarNominaOptions & {
    stampFn?: (
      nominaInput: NominaTimbradoInput,
      opts?: TimbrarNominaOptions
    ) => Promise<NominaTimbradoResult>;
  }
): Promise<StampApprovedSnapshotResult> {
  const dbInstance = options?.dbInstance ?? db;
  const stampFn = options?.stampFn ?? timbrarNomina;
  const bundle = await readApprovedPayrollSnapshot(input.companyId, input.runId, dbInstance);

  const targets = input.userId
    ? bundle.payslips.filter((p) => p.userId === input.userId)
    : bundle.payslips;

  if (targets.length === 0) {
    throw ApiError.notFound(
      input.userId
        ? `El empleado ${input.userId} no pertenece al snapshot aprobado de la corrida ${input.runId}.`
        : `La corrida ${input.runId} no contiene recibos en el snapshot aprobado.`
    );
  }

  const results: StampedPayslipOutcome[] = [];

  for (const payslip of targets) {
    const nominaInput = buildTimbradoInputFromPayslipSnapshot({
      companyId: input.companyId,
      performedBy: input.performedBy,
      header: bundle.header,
      payslip,
    });

    try {
      const timbrado = await stampFn(nominaInput, {
        dbInstance: options?.dbInstance,
        fetchImpl: options?.fetchImpl,
      });

      await dbInstance
        .update(payrollPayslips)
        .set({
          cfdiUuid: timbrado.uuid || null,
          cfdiStatus: timbrado.status,
          selloDigital: timbrado.selloDigital || null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(payrollPayslips.runId, bundle.runId),
            eq(payrollPayslips.userId, payslip.userId),
            or(isNull(payrollPayslips.cfdiStatus), ne(payrollPayslips.cfdiStatus, "TIMBRADO"))
          )
        );

      results.push({
        userId: payslip.userId,
        empleadoRfc: nominaInput.empleadoRfc,
        empleadoNombre: payslip.employeeName,
        status: timbrado.status,
        uuid: timbrado.uuid,
        selloDigital: timbrado.selloDigital,
        fechaTimbrado: timbrado.fechaTimbrado,
        totalPercepcionesCents: payslip.totalPercepcionesCents,
        totalDeduccionesCents: payslip.totalDeduccionesCents,
        netPayCents: payslip.netPayCents,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await dbInstance
        .update(payrollPayslips)
        .set({
          cfdiStatus: "RECHAZADO",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(payrollPayslips.runId, bundle.runId),
            eq(payrollPayslips.userId, payslip.userId),
            or(isNull(payrollPayslips.cfdiStatus), ne(payrollPayslips.cfdiStatus, "TIMBRADO"))
          )
        );

      results.push({
        userId: payslip.userId,
        empleadoRfc: nominaInput.empleadoRfc,
        empleadoNombre: payslip.employeeName,
        status: "RECHAZADO",
        uuid: "",
        selloDigital: "",
        fechaTimbrado: new Date().toISOString(),
        totalPercepcionesCents: payslip.totalPercepcionesCents,
        totalDeduccionesCents: payslip.totalDeduccionesCents,
        netPayCents: payslip.netPayCents,
        error: message,
      });
    }
  }

  return {
    runId: bundle.runId,
    snapshotVersion: bundle.snapshotVersion,
    inputFingerprint: bundle.header.inputFingerprint,
    periodStart: bundle.header.periodStart,
    periodEnd: bundle.header.periodEnd,
    results,
  };
}
