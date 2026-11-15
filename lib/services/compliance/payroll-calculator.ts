import { db } from '@/lib/db';
import { 
  users, 
  employeeProfiles, 
  employeeContracts, 
  shiftSessions, 
  vacationRequests, 
  leaveRequests,
  branches
} from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { validatePayrollPeriod, resolveContractSalaryForPeriod } from '@/lib/services/payroll-service';
import { diaCivilEnZona } from '@/lib/services/aguinaldo-days-adapter';

export interface PayrollEmployeeRecord {
  employeeNumber: string;
  name: string;
  email: string;
  rfc: string;
  curp: string;
  nss: string;
  department: string;
  position: string;
  baseSalaryDaily: number;
  baseSalaryWeekly: number;
  baseSalaryMonthly: number;
  bankName: string;
  clabe: string;
  paymentMethod: string;
  daysWorked: number;
  regularHours: number;
  overtimeHours: number;
  lateMinutes: number;
  vacationDays: number;
  sickDays: number;
  otherLeaveDays: number;
  totalDeductions: number;
  netWorkDays: number;
}

export interface PayrollPeriod {
  startDate: string;
  endDate: string;
  companyId: string;
  branchId?: string;
}

export async function calculatePayrollData(period: PayrollPeriod): Promise<PayrollEmployeeRecord[]> {
  const { startDate, endDate, companyId, branchId } = period;
  validatePayrollPeriod(startDate, endDate);
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);

  // 1. Get all active employees with profiles and contracts
  const employeesData = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      branchId: users.branchId,
      employeeNumber: employeeProfiles.employeeNumber,
      department: employeeProfiles.department,
      position: employeeProfiles.position,
      rfc: employeeProfiles.rfc,
      curp: employeeProfiles.curp,
      nss: employeeProfiles.nss,
      bankName: employeeProfiles.bankName,
      clabe: employeeProfiles.clabe,
      paymentMethod: employeeProfiles.paymentMethod,
      contractId: employeeContracts.id,
      baseSalary: employeeContracts.baseSalary,
      weeklySalary: employeeContracts.weeklySalary,
      monthlySalary: employeeContracts.monthlySalary,
      currency: employeeContracts.currency,
      contractStartDate: employeeContracts.startDate,
      contractEndDate: employeeContracts.endDate,
    })
    .from(users)
    .leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
    .leftJoin(employeeContracts, and(
      eq(users.id, employeeContracts.userId),
      eq(employeeContracts.companyId, companyId),
      eq(employeeContracts.status, 'ACTIVE')
    ))
    .where(and(
      eq(users.companyId, companyId),
      ...(branchId ? [eq(users.branchId, branchId)] : [])
    ));

  const records: PayrollEmployeeRecord[] = [];

  for (const emp of employeesData) {
    // 2. Get shift sessions for this period resolved in branch operational timezone
    let timezone = 'America/Mexico_City';
    const targetBranchId = branchId ?? emp.branchId;
    if (targetBranchId) {
      try {
        const [br] = await db
          .select({ timezone: branches.timezone })
          .from(branches)
          .where(eq(branches.id, targetBranchId))
          .limit(1);
        if (br?.timezone) timezone = br.timezone;
      } catch {
        // Fallback
      }
    }

    const bufferStart = new Date(`${startDate}T00:00:00Z`);
    bufferStart.setUTCDate(bufferStart.getUTCDate() - 2);
    const bufferEnd = new Date(`${endDate}T23:59:59Z`);
    bufferEnd.setUTCDate(bufferEnd.getUTCDate() + 2);

    const rawSessions = await db
      .select({
        totalWorkMinutes: shiftSessions.totalWorkMinutes,
        overtimeMinutes: shiftSessions.overtimeMinutes,
        lateMinutes: shiftSessions.lateMinutes,
        status: shiftSessions.status,
        startedAt: shiftSessions.startedAt,
        requiresApproval: shiftSessions.requiresApproval,
        approvedAt: shiftSessions.approvedAt,
      })
      .from(shiftSessions)
      .where(and(
        eq(shiftSessions.userId, emp.userId),
        gte(shiftSessions.startedAt, bufferStart),
        lte(shiftSessions.startedAt, bufferEnd)
      ));

    const approvedSessions = rawSessions.filter(s => {
      if (!s.startedAt) return false;
      const date = diaCivilEnZona(new Date(s.startedAt), timezone);
      if (date < startDate || date > endDate) return false;
      return s.status === 'COMPLETED' && (!s.requiresApproval || s.approvedAt != null);
    });

    const totalWorkMinutes = approvedSessions.reduce((sum, s) => sum + (s.totalWorkMinutes || 0), 0);
    const totalOvertimeMinutes = approvedSessions.reduce((sum, s) => sum + (s.overtimeMinutes || 0), 0);
    const totalLateMinutes = approvedSessions.reduce((sum, s) => sum + (s.lateMinutes || 0), 0);
    const daysWorked = approvedSessions.length;

    // 3. Get vacation requests for this period
    const vacations = await db
      .select({ totalDays: vacationRequests.totalDays })
      .from(vacationRequests)
      .where(and(
        eq(vacationRequests.userId, emp.userId),
        eq(vacationRequests.status, 'APPROVED'),
        gte(vacationRequests.startDate, start),
        lte(vacationRequests.startDate, end),
      ));

    const vacationDays = vacations.reduce((sum, v) => sum + (v.totalDays || 0), 0);

    // 4. Get leave requests for this period
    const sickDays = 0;
    let otherLeaveDays = 0;
    try {
      const leaves = await db
        .select({ totalDays: leaveRequests.totalDays })
        .from(leaveRequests)
        .where(and(
          eq(leaveRequests.userId, emp.userId),
          eq(leaveRequests.status, 'APPROVED'),
          gte(leaveRequests.startDate, start),
          lte(leaveRequests.startDate, end),
        ));
      otherLeaveDays = leaves.reduce((sum, l) => sum + (l.totalDays || 0), 0);
    } catch {
      // leave_requests table might not exist yet
    }

    let dailySalary = 0;
    let weeklySalary = 0;
    let monthlySalary = 0;

    if (emp.contractId && typeof emp.baseSalary === "number" && emp.baseSalary > 0) {
      try {
        const resolution = resolveContractSalaryForPeriod({
          contract: {
            id: emp.contractId,
            userId: emp.userId,
            baseSalary: emp.baseSalary,
            currency: emp.currency,
            startDate: emp.contractStartDate!,
            endDate: emp.contractEndDate,
          },
          periodStart: startDate,
          periodEnd: endDate,
        });
        dailySalary = resolution.dailySalaryCents / 100;
        weeklySalary = emp.weeklySalary ? emp.weeklySalary / 100 : dailySalary * 7;
        monthlySalary = emp.monthlySalary ? emp.monthlySalary / 100 : dailySalary * 30;
      } catch {
        dailySalary = 0;
        weeklySalary = 0;
        monthlySalary = 0;
      }
    }

    const netWorkDays = daysWorked - vacationDays - sickDays - otherLeaveDays;

    records.push({
      employeeNumber: emp.employeeNumber || '',
      name: emp.name || '',
      email: emp.email || '',
      rfc: emp.rfc || '',
      curp: emp.curp || '',
      nss: emp.nss || '',
      department: emp.department || '',
      position: emp.position || '',
      baseSalaryDaily: dailySalary,
      baseSalaryWeekly: weeklySalary,
      baseSalaryMonthly: monthlySalary,
      bankName: emp.bankName || '',
      clabe: emp.clabe || '',
      paymentMethod: emp.paymentMethod || '',
      daysWorked,
      regularHours: Math.round((totalWorkMinutes - totalOvertimeMinutes) / 60 * 100) / 100,
      overtimeHours: Math.round(totalOvertimeMinutes / 60 * 100) / 100,
      lateMinutes: totalLateMinutes,
      vacationDays,
      sickDays,
      otherLeaveDays,
      totalDeductions: 0, // Placeholder for ISR, IMSS, etc.
      netWorkDays: Math.max(0, netWorkDays),
    });
  }

  return records;
}

export function payrollToCSV(records: PayrollEmployeeRecord[], format: 'generic' | 'contpaqi' | 'noi' = 'generic'): string {
  if (format === 'contpaqi') {
    return payrollToContpaqi(records);
  }
  if (format === 'noi') {
    return payrollToNOI(records);
  }

  // Generic CSV
  const headers = [
    'Num_Empleado', 'Nombre', 'RFC', 'CURP', 'NSS',
    'Departamento', 'Puesto', 'Salario_Diario', 'Salario_Semanal', 'Salario_Mensual',
    'Banco', 'CLABE', 'Metodo_Pago',
    'Dias_Trabajados', 'Horas_Regulares', 'Horas_Extra', 'Min_Retardo',
    'Dias_Vacaciones', 'Dias_Incapacidad', 'Otros_Permisos',
    'Dias_Netos_Trabajo'
  ];

  const rows = records.map(r => [
    r.employeeNumber, r.name, r.rfc, r.curp, r.nss,
    r.department, r.position, r.baseSalaryDaily, r.baseSalaryWeekly, r.baseSalaryMonthly,
    r.bankName, r.clabe, r.paymentMethod,
    r.daysWorked, r.regularHours, r.overtimeHours, r.lateMinutes,
    r.vacationDays, r.sickDays, r.otherLeaveDays,
    r.netWorkDays,
  ].map(v => `"${v}"`).join(','));

  return [headers.join(','), ...rows].join('\n');
}

function payrollToContpaqi(records: PayrollEmployeeRecord[]): string {
  // CONTPAQi Nóminas import format
  const headers = [
    'NumEmpleado', 'Nombre', 'RFC', 'CURP', 'NSS',
    'SalarioDiario', 'Departamento', 'Puesto',
    'DiasTrabajar', 'HorasExtra', 'DiasVacaciones', 'Faltas',
  ];

  const rows = records.map(r => [
    r.employeeNumber, r.name, r.rfc, r.curp, r.nss,
    r.baseSalaryDaily.toFixed(2), r.department, r.position,
    r.daysWorked, r.overtimeHours.toFixed(2), r.vacationDays, r.sickDays + r.otherLeaveDays,
  ].map(v => `"${v}"`).join(','));

  return [headers.join(','), ...rows].join('\n');
}

function payrollToNOI(records: PayrollEmployeeRecord[]): string {
  // Aspel NOI import format
  const headers = [
    'NUMTRAB', 'NOMBRE', 'RFC', 'CURP', 'IMSS',
    'SUELDO', 'DEPTO', 'PUESTO', 'BANCO', 'CLABE',
    'DIAST', 'HEXTRA', 'VACAC', 'INCAP', 'FALTAS',
  ];

  const rows = records.map(r => [
    r.employeeNumber, r.name, r.rfc, r.curp, r.nss,
    r.baseSalaryDaily.toFixed(2), r.department, r.position, r.bankName, r.clabe,
    r.daysWorked, r.overtimeHours.toFixed(2), r.vacationDays, r.sickDays, r.otherLeaveDays,
  ].map(v => `"${v}"`).join(','));

  return [headers.join(','), ...rows].join('\n');
}
