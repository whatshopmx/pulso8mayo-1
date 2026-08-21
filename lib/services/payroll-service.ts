import { db } from "@/lib/db";
import { 
  propinas, 
  propinaAsignaciones, 
  employeeProfiles, 
  employeeContracts, 
  users,
  payrollRuns,
  payrollPayslips
} from "@/lib/db/schema";
import { eq, and, gte, lte, sum, desc } from "drizzle-orm";
import { timbrarNomina } from "./fiscal-service";
import { differenceInDays, parseISO } from "date-fns";

export async function calculateEmployeePayroll(userId: string, startDate: string, endDate: string) {
  // 1. Calculate tips
  const propinasSum = await db
    .select({
      totalTips: sum(propinaAsignaciones.assignedAmountCents)
    })
    .from(propinaAsignaciones)
    .innerJoin(propinas, eq(propinaAsignaciones.propinaId, propinas.id))
    .where(
      and(
        eq(propinaAsignaciones.userId, userId),
        gte(propinas.businessDate, startDate),
        lte(propinas.businessDate, endDate)
      )
    );
    
  const tipsCents = Number(propinasSum[0]?.totalTips || 0);

  // 2. Base salary
  const contract = await db.select()
    .from(employeeContracts)
    .where(eq(employeeContracts.userId, userId))
    .limit(1)
    .then(res => res[0]);

  // simple calculation: base salary (daily) * days in period
  const daysInPeriod = differenceInDays(parseISO(endDate), parseISO(startDate)) + 1;
  const baseSalaryCents = (contract?.baseSalary || 0) * daysInPeriod;

  return {
    baseSalaryCents,
    propinasCents: tipsCents,
    totalPercepcionesCents: baseSalaryCents + tipsCents,
    totalDeduccionesCents: 0,
  };
}

export async function executePayrollRun(
  companyId: string,
  startDate: string,
  endDate: string,
  /** Quién corrió la nómina. Viaja al timbrado, que ahora deja constancia. */
  performedBy?: string
) {
  // 1. Create a payroll run
  const [run] = await db.insert(payrollRuns).values({
    companyId,
    periodStart: startDate,
    periodEnd: endDate,
    status: 'PROCESSING'
  }).returning();

  // 2. Get all active employees in company
  const activeStaff = await db
    .select({
      userId: users.id,
      name: users.name,
      rfc: employeeProfiles.rfc,
      curp: employeeProfiles.curp,
    })
    .from(users)
    .innerJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
    .where(
      and(
        eq(users.companyId, companyId),
        eq(employeeProfiles.isActive, true)
      )
    );

  const results = [];

  for (const emp of activeStaff) {
    try {
      if (!emp.rfc) {
         throw new Error(`Empleado ${emp.name} no tiene RFC configurado.`);
      }

      const payrollCalc = await calculateEmployeePayroll(emp.userId, startDate, endDate);
      
      // Timbrar nómina
      // El periodo en fiscal API suele ser "2025-01" o texto. Usaremos startDate
      const timbrado = await timbrarNomina({
        companyId,
        performedBy,
        empleadoRfc: emp.rfc,
        empleadoNombre: emp.name || "Sin Nombre",
        empleadoCurp: emp.curp || "",
        periodo: `${startDate} - ${endDate}`,
        totalPercepciones: payrollCalc.totalPercepcionesCents,
        totalDeducciones: payrollCalc.totalDeduccionesCents,
      });

      // Save payslip
      const [payslip] = await db.insert(payrollPayslips).values({
        runId: run.id,
        userId: emp.userId,
        baseSalaryCents: payrollCalc.baseSalaryCents,
        propinasCents: payrollCalc.propinasCents,
        totalPercepcionesCents: payrollCalc.totalPercepcionesCents,
        totalDeduccionesCents: payrollCalc.totalDeduccionesCents,
        cfdiUuid: timbrado.uuid,
        cfdiStatus: timbrado.status,
        selloDigital: timbrado.selloDigital,
      }).returning();
      
      results.push({ success: true, userId: emp.userId, payslip });
    } catch (err: any) {
      console.error(`Error procesando nómina para ${emp.userId}:`, err);
      results.push({ success: false, userId: emp.userId, error: err.message });
      // Guardar payslip con error
      const payrollCalc = await calculateEmployeePayroll(emp.userId, startDate, endDate);
      await db.insert(payrollPayslips).values({
        runId: run.id,
        userId: emp.userId,
        baseSalaryCents: payrollCalc.baseSalaryCents,
        propinasCents: payrollCalc.propinasCents,
        totalPercepcionesCents: payrollCalc.totalPercepcionesCents,
        totalDeduccionesCents: payrollCalc.totalDeduccionesCents,
        cfdiStatus: "ERROR",
      });
    }
  }

  // Update run status
  const hasErrors = results.some(r => !r.success);
  await db.update(payrollRuns).set({
    status: hasErrors ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED'
  }).where(eq(payrollRuns.id, run.id));

  return {
    runId: run.id,
    results
  };
}

export async function getPayrollRuns(companyId: string) {
  return await db.select()
    .from(payrollRuns)
    .where(eq(payrollRuns.companyId, companyId))
    .orderBy(desc(payrollRuns.periodStart));
}

export async function getPayrollPayslips(runId: string) {
  return await db.select({
    id: payrollPayslips.id,
    userId: payrollPayslips.userId,
    userName: users.name,
    baseSalaryCents: payrollPayslips.baseSalaryCents,
    propinasCents: payrollPayslips.propinasCents,
    totalPercepcionesCents: payrollPayslips.totalPercepcionesCents,
    cfdiUuid: payrollPayslips.cfdiUuid,
    cfdiStatus: payrollPayslips.cfdiStatus,
  })
  .from(payrollPayslips)
  .innerJoin(users, eq(payrollPayslips.userId, users.id))
  .where(eq(payrollPayslips.runId, runId));
}
