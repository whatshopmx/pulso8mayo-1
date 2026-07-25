import "dotenv/config";
import { db } from "@/lib/db";
import {
  users, companies,
  employeeProfiles, employeeContracts, employeeDocuments,
  employeeOnboarding, onboardingSteps,
  employeeBenefits, salaryHistory,
  notifications, notificationPreferences,
  breakComplianceRules,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  COMPANY_ID, BRANCH_CONDESA, BRANCH_POLANCO, BRANCH_ROMA,
  USER_SUPER_ADMIN, USER_ADMIN, USER_GERENTE,
  USER_SUPERVISOR, USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3, USER_READONLY,
} from "./seed-constants";

const EMPLOYEE_USERS = [
  {
    userId: USER_SUPER_ADMIN,
    employeeNumber: "PUL-001",
    position: "Director General",
    department: "Dirección",
    supervisorId: null,
    hireDate: new Date("2023-01-15"),
    dateOfBirth: new Date("1985-03-12"),
    curp: "MECL850312HDFNRR01",
    rfc: "MECL850312XXX",
    nss: "12345678901",
    gender: "MALE" as const,
    maritalStatus: "MARRIED" as const,
    bloodType: "O+" as const,
    bankName: "BBVA",
    clabe: "012180015738654321",
    paymentMethod: "BANK_TRANSFER" as const,
  },
  {
    userId: USER_ADMIN,
    employeeNumber: "PUL-002",
    position: "Gerente Administrativo",
    department: "Administración",
    supervisorId: USER_SUPER_ADMIN,
    hireDate: new Date("2023-02-01"),
    dateOfBirth: new Date("1990-07-25"),
    curp: "GAGM900725MDFRRR02",
    rfc: "GAGM900725XXX",
    nss: "23456789012",
    gender: "FEMALE" as const,
    maritalStatus: "SINGLE" as const,
    bloodType: "A+" as const,
    bankName: "Santander",
    clabe: "014180025839147852",
    paymentMethod: "BANK_TRANSFER" as const,
  },
  {
    userId: USER_GERENTE,
    employeeNumber: "PUL-003",
    position: "Gerente de Sucursal",
    department: "Operaciones",
    supervisorId: USER_ADMIN,
    hireDate: new Date("2023-03-01"),
    dateOfBirth: new Date("1988-11-05"),
    curp: "LOJJ881105HDFPRR03",
    rfc: "LOJJ881105XXX",
    nss: "34567890123",
    gender: "MALE" as const,
    maritalStatus: "MARRIED" as const,
    bloodType: "B+" as const,
    bankName: "Banamex",
    clabe: "002180015739456123",
    paymentMethod: "BANK_TRANSFER" as const,
  },
  {
    userId: USER_SUPERVISOR,
    employeeNumber: "PUL-004",
    position: "Supervisor de Turno",
    department: "Operaciones",
    supervisorId: USER_GERENTE,
    hireDate: new Date("2023-06-15"),
    dateOfBirth: new Date("1992-04-18"),
    curp: "MAMA920418MDFRRR04",
    rfc: "MAMA920418XXX",
    nss: "45678901234",
    gender: "FEMALE" as const,
    maritalStatus: "SINGLE" as const,
    bloodType: "AB+" as const,
    bankName: "BBVA",
    clabe: "012180015738654322",
    paymentMethod: "BANK_TRANSFER" as const,
  },
  {
    userId: USER_EMPLEADO_1,
    employeeNumber: "PUL-005",
    position: "Cocinero",
    department: "Cocina",
    supervisorId: USER_SUPERVISOR,
    hireDate: new Date("2024-01-10"),
    dateOfBirth: new Date("1995-09-30"),
    curp: "SASP950930HDFRRR05",
    rfc: "SASP950930XXX",
    nss: "56789012345",
    gender: "MALE" as const,
    maritalStatus: "SINGLE" as const,
    bloodType: "O-" as const,
    bankName: "Santander",
    clabe: "014180025839147853",
    paymentMethod: "BANK_TRANSFER" as const,
  },
  {
    userId: USER_EMPLEADO_2,
    employeeNumber: "PUL-006",
    position: "Mesera",
    department: "Servicio",
    supervisorId: USER_SUPERVISOR,
    hireDate: new Date("2024-02-20"),
    dateOfBirth: new Date("1997-12-15"),
    curp: "FEFL971215MDFRRR06",
    rfc: "FEFL971215XXX",
    nss: "67890123456",
    gender: "FEMALE" as const,
    maritalStatus: "SINGLE" as const,
    bloodType: "A-" as const,
    bankName: "Banorte",
    clabe: "072180015738654789",
    paymentMethod: "BANK_TRANSFER" as const,
  },
  {
    userId: USER_EMPLEADO_3,
    employeeNumber: "PUL-007",
    position: "Bartender",
    department: "Bar",
    supervisorId: USER_SUPERVISOR,
    hireDate: new Date("2024-03-05"),
    dateOfBirth: new Date("1993-06-22"),
    curp: "GURQ930622HDFRRR07",
    rfc: "GURQ930622XXX",
    nss: "78901234567",
    gender: "MALE" as const,
    maritalStatus: "DIVORCED" as const,
    bloodType: "B-" as const,
    bankName: "BBVA",
    clabe: "012180015738654323",
    paymentMethod: "BANK_TRANSFER" as const,
  },
];

const CONTRACTS = [
  { userId: USER_SUPER_ADMIN, contractNumber: "CT-2023-001", baseSalary: 150000, monthlySalary: 4500000, startDate: new Date("2023-01-15") },
  { userId: USER_ADMIN, contractNumber: "CT-2023-002", baseSalary: 100000, monthlySalary: 3000000, startDate: new Date("2023-02-01") },
  { userId: USER_GERENTE, contractNumber: "CT-2023-003", baseSalary: 83333, monthlySalary: 2500000, startDate: new Date("2023-03-01") },
  { userId: USER_SUPERVISOR, contractNumber: "CT-2024-001", baseSalary: 58333, monthlySalary: 1750000, startDate: new Date("2023-06-15") },
  { userId: USER_EMPLEADO_1, contractNumber: "CT-2024-002", baseSalary: 41667, monthlySalary: 1250000, startDate: new Date("2024-01-10") },
  { userId: USER_EMPLEADO_2, contractNumber: "CT-2024-003", baseSalary: 35000, monthlySalary: 1050000, startDate: new Date("2024-02-20") },
  { userId: USER_EMPLEADO_3, contractNumber: "CT-2024-004", baseSalary: 38333, monthlySalary: 1150000, startDate: new Date("2024-03-05") },
];

const DOCUMENTS_DATA = [
  { userId: USER_SUPER_ADMIN, docType: "ID" as const, name: "INE Carlos Méndez", fileName: "ine_carlos_mendez.pdf" },
  { userId: USER_SUPER_ADMIN, docType: "CONTRACT" as const, name: "Contrato Director General", fileName: "contrato_dg_carlos.pdf" },
  { userId: USER_SUPER_ADMIN, docType: "TAX_ID" as const, name: "RFC Carlos Méndez", fileName: "rfc_carlos_mendez.pdf" },
  { userId: USER_SUPER_ADMIN, docType: "PROOF_OF_ADDRESS" as const, name: "Comprobante Domicilio Carlos", fileName: "dom_carlos_mendez.pdf" },
  { userId: USER_ADMIN, docType: "ID" as const, name: "INE María García", fileName: "ine_maria_garcia.pdf" },
  { userId: USER_ADMIN, docType: "CONTRACT" as const, name: "Contrato Gerente Admin", fileName: "contrato_admin_maria.pdf" },
  { userId: USER_ADMIN, docType: "CERTIFICATE" as const, name: "Título Licenciatura María", fileName: "titulo_maria_garcia.pdf" },
  { userId: USER_ADMIN, docType: "BANK_INFO" as const, name: "Datos Bancarios María", fileName: "banco_maria_garcia.pdf" },
  { userId: USER_GERENTE, docType: "ID" as const, name: "INE Juan López", fileName: "ine_juan_lopez.pdf" },
  { userId: USER_GERENTE, docType: "CONTRACT" as const, name: "Contrato Gerente Sucursal", fileName: "contrato_gerente_juan.pdf" },
  { userId: USER_GERENTE, docType: "PROOF_OF_ADDRESS" as const, name: "Comprobante Domicilio Juan", fileName: "dom_juan_lopez.pdf" },
  { userId: USER_SUPERVISOR, docType: "ID" as const, name: "INE Ana Martínez", fileName: "ine_ana_martinez.pdf" },
  { userId: USER_SUPERVISOR, docType: "CONTRACT" as const, name: "Contrato Supervisor", fileName: "contrato_supervisor_ana.pdf" },
  { userId: USER_SUPERVISOR, docType: "CERTIFICATE" as const, name: "Certificado MIPYMES Ana", fileName: "cert_ana_martinez.pdf" },
  { userId: USER_EMPLEADO_1, docType: "ID" as const, name: "INE Pedro Sánchez", fileName: "ine_pedro_sanchez.pdf" },
  { userId: USER_EMPLEADO_1, docType: "CONTRACT" as const, name: "Contrato Cocinero", fileName: "contrato_cocinero_pedro.pdf" },
  { userId: USER_EMPLEADO_1, docType: "MEDICAL_EXAM" as const, name: "Examen Médico Pedro", fileName: "medico_pedro_sanchez.pdf" },
  { userId: USER_EMPLEADO_2, docType: "ID" as const, name: "INE Luisa Fernández", fileName: "ine_luisa_fernandez.pdf" },
  { userId: USER_EMPLEADO_2, docType: "CONTRACT" as const, name: "Contrato Mesera", fileName: "contrato_mesera_luisa.pdf" },
  { userId: USER_EMPLEADO_2, docType: "TRAINING" as const, name: "Curso Manejo Alimentos Luisa", fileName: "curso_luisa.pdf" },
  { userId: USER_EMPLEADO_3, docType: "ID" as const, name: "INE Roberto Gutiérrez", fileName: "ine_roberto_gutierrez.pdf" },
  { userId: USER_EMPLEADO_3, docType: "CONTRACT" as const, name: "Contrato Bartender", fileName: "contrato_bartender_roberto.pdf" },
  { userId: USER_EMPLEADO_3, docType: "CERTIFICATE" as const, name: "Certificación Coctelería Roberto", fileName: "cert_roberto.pdf" },
];

const ONBOARDING = [
  { userId: USER_SUPER_ADMIN, createdBy: USER_SUPER_ADMIN, startDate: new Date("2023-01-15"), status: "COMPLETED", completedDate: new Date("2023-02-15") },
  { userId: USER_ADMIN, createdBy: USER_SUPER_ADMIN, startDate: new Date("2023-02-01"), status: "COMPLETED", completedDate: new Date("2023-03-01") },
  { userId: USER_GERENTE, createdBy: USER_ADMIN, startDate: new Date("2023-03-01"), status: "COMPLETED", completedDate: new Date("2023-04-01") },
  { userId: USER_SUPERVISOR, createdBy: USER_GERENTE, startDate: new Date("2023-06-15"), status: "COMPLETED", completedDate: new Date("2023-07-15") },
  { userId: USER_EMPLEADO_1, createdBy: USER_ADMIN, startDate: new Date("2024-01-10"), status: "COMPLETED", completedDate: new Date("2024-01-31") },
  { userId: USER_EMPLEADO_2, createdBy: USER_ADMIN, startDate: new Date("2024-02-20"), status: "COMPLETED", completedDate: new Date("2024-03-15") },
  { userId: USER_EMPLEADO_3, createdBy: USER_ADMIN, startDate: new Date("2024-03-05"), status: "COMPLETED", completedDate: new Date("2024-03-30") },
];

const BENEFITS = [
  { userId: USER_SUPER_ADMIN, benefitType: "HEALTH_INSURANCE", provider: "GNP Seguros", policyNumber: "GNP-HLTH-001", coverageAmount: 200000000, startDate: new Date("2023-01-15") },
  { userId: USER_SUPER_ADMIN, benefitType: "LIFE_INSURANCE", provider: "MetLife", policyNumber: "MET-LIFE-001", coverageAmount: 500000000, startDate: new Date("2023-01-15") },
  { userId: USER_ADMIN, benefitType: "HEALTH_INSURANCE", provider: "GNP Seguros", policyNumber: "GNP-HLTH-002", coverageAmount: 150000000, startDate: new Date("2023-02-01") },
  { userId: USER_ADMIN, benefitType: "FOOD_VOUCHERS", provider: "Sodexo", policyNumber: "SOD-001", coverageAmount: 3000000, startDate: new Date("2023-02-01") },
  { userId: USER_GERENTE, benefitType: "HEALTH_INSURANCE", provider: "GNP Seguros", policyNumber: "GNP-HLTH-003", coverageAmount: 150000000, startDate: new Date("2023-03-01") },
  { userId: USER_GERENTE, benefitType: "SAVINGS_FUND", provider: "BBVA", coverageAmount: 5000000, startDate: new Date("2023-03-01") },
  { userId: USER_SUPERVISOR, benefitType: "HEALTH_INSURANCE", provider: "GNP Seguros", policyNumber: "GNP-HLTH-004", coverageAmount: 100000000, startDate: new Date("2023-06-15") },
  { userId: USER_EMPLEADO_1, benefitType: "HEALTH_INSURANCE", provider: "GNP Seguros", policyNumber: "GNP-HLTH-005", coverageAmount: 100000000, startDate: new Date("2024-01-10") },
  { userId: USER_EMPLEADO_2, benefitType: "HEALTH_INSURANCE", provider: "GNP Seguros", policyNumber: "GNP-HLTH-006", coverageAmount: 100000000, startDate: new Date("2024-02-20") },
  { userId: USER_EMPLEADO_3, benefitType: "HEALTH_INSURANCE", provider: "GNP Seguros", policyNumber: "GNP-HLTH-007", coverageAmount: 100000000, startDate: new Date("2024-03-05") },
];

const SALARY_HISTORY = [
  { userId: USER_SUPER_ADMIN, newSalary: 4500000, changeType: "INITIAL" as const, effectiveDate: new Date("2023-01-15"), approvedBy: USER_SUPER_ADMIN },
  { userId: USER_ADMIN, newSalary: 3000000, changeType: "INITIAL" as const, effectiveDate: new Date("2023-02-01"), approvedBy: USER_SUPER_ADMIN },
  { userId: USER_GERENTE, newSalary: 2500000, changeType: "INITIAL" as const, effectiveDate: new Date("2023-03-01"), approvedBy: USER_ADMIN },
  { userId: USER_SUPERVISOR, newSalary: 1750000, changeType: "INITIAL" as const, effectiveDate: new Date("2023-06-15"), approvedBy: USER_GERENTE },
  { userId: USER_EMPLEADO_1, newSalary: 1250000, changeType: "INITIAL" as const, effectiveDate: new Date("2024-01-10"), approvedBy: USER_ADMIN },
  { userId: USER_EMPLEADO_2, newSalary: 1050000, changeType: "INITIAL" as const, effectiveDate: new Date("2024-02-20"), approvedBy: USER_ADMIN },
  { userId: USER_EMPLEADO_3, newSalary: 1150000, changeType: "INITIAL" as const, effectiveDate: new Date("2024-03-05"), approvedBy: USER_ADMIN },
];

export async function main() {
  console.log("=== Phase 2: HR Profiles ===");
  console.log("Cleaning up...");

  await db.delete(breakComplianceRules).where(eq(breakComplianceRules.companyId, COMPANY_ID));
  await db.delete(notificationPreferences).where(eq(notificationPreferences.userId, USER_READONLY));
  
  const employeeUserIds = EMPLOYEE_USERS.map(u => u.userId);
  await db.delete(notificationPreferences).where(inArray(notificationPreferences.userId, employeeUserIds));
  await db.delete(salaryHistory).where(inArray(salaryHistory.userId, employeeUserIds));
  await db.delete(employeeBenefits).where(inArray(employeeBenefits.userId, employeeUserIds));
  await db.delete(onboardingSteps);
  await db.delete(employeeOnboarding).where(inArray(employeeOnboarding.userId, employeeUserIds));
  await db.delete(employeeDocuments).where(inArray(employeeDocuments.userId, employeeUserIds));
  await db.delete(employeeContracts).where(inArray(employeeContracts.userId, employeeUserIds));
  await db.delete(employeeProfiles).where(inArray(employeeProfiles.userId, employeeUserIds));
  await db.delete(notifications).where(eq(notifications.userId, USER_SUPER_ADMIN));

  console.log("Inserting employee profiles...");
  const profileValues = EMPLOYEE_USERS.map(p => ({
    userId: p.userId,
    dateOfBirth: p.dateOfBirth,
    curp: p.curp,
    rfc: p.rfc,
    nss: p.nss,
    gender: p.gender,
    maritalStatus: p.maritalStatus,
    bloodType: p.bloodType,
    nationality: "MEXICANA",
    bankName: p.bankName,
    clabe: p.clabe,
    paymentMethod: p.paymentMethod,
    employeeNumber: p.employeeNumber,
    department: p.department,
    position: p.position,
    supervisorId: p.supervisorId,
    hireDate: p.hireDate,
    seniorityDate: p.hireDate,
    employeeStatus: "ACTIVE" as const,
    isActive: true,
    standardHoursPerWeek: 48,
    createdBy: USER_ADMIN,
  }));
  await db.insert(employeeProfiles).values(profileValues);

  console.log("Inserting contracts...");
  const contractValues = CONTRACTS.map(c => ({
    userId: c.userId,
    companyId: COMPANY_ID,
    contractNumber: c.contractNumber,
    contractType: "INDETERMINATE" as const,
    workRegime: "DAILY" as const,
    startDate: c.startDate,
    baseSalary: c.baseSalary,
    monthlySalary: c.monthlySalary,
    hasHealthInsurance: true,
    hasLifeInsurance: c.userId === USER_SUPER_ADMIN,
    hasFoodVouchers: true,
    status: "ACTIVE",
    breakDurationMinutes: 60,
    workDays: [1, 2, 3, 4, 5, 6],
    createdBy: USER_ADMIN,
  }));
  await db.insert(employeeContracts).values(contractValues);

  console.log("Inserting employee documents...");
  const documentValues = DOCUMENTS_DATA.map(d => ({
    userId: d.userId,
    companyId: COMPANY_ID,
    documentType: d.docType,
    documentName: d.name,
    documentUrl: `https://storage.pulso.mx/demo/${d.fileName}`,
    fileKey: `demo/${d.fileName}`,
    fileSize: 1024 * 200,
    mimeType: "application/pdf",
    uploadedBy: USER_ADMIN,
    issueDate: new Date("2024-01-01"),
    status: "VALIDATED" as const,
    isValid: true,
    validatedBy: USER_ADMIN,
    validatedAt: new Date("2024-01-15"),
    isRequired: d.docType === "ID" || d.docType === "CONTRACT",
  }));
  await db.insert(employeeDocuments).values(documentValues);

  console.log("Inserting onboarding records...");
  const onboardingValues = ONBOARDING.map(o => ({
    userId: o.userId,
    companyId: COMPANY_ID,
    status: o.status,
    startDate: o.startDate,
    completedDate: o.completedDate,
    totalSteps: 5,
    completedSteps: 5,
    progressPercentage: 100,
    createdBy: o.createdBy,
  }));
  const onboardingRows = await db.insert(employeeOnboarding).values(onboardingValues).returning({ id: employeeOnboarding.id, userId: employeeOnboarding.userId });

  const stepValues: any[] = [];
  for (const oRow of onboardingRows) {
    const original = ONBOARDING.find(o => o.userId === oRow.userId);
    if (!original) continue;
    stepValues.push(
      { onboardingId: oRow.id, stepName: "Documentación Personal", stepCategory: "DOCUMENTS", status: "COMPLETED" as const, completedDate: original.startDate, description: "Entrega de identificación y documentos personales" },
      { onboardingId: oRow.id, stepName: "Firma de Contrato", stepCategory: "DOCUMENTS", status: "COMPLETED" as const, completedDate: original.startDate, description: "Firma de contrato laboral" },
      { onboardingId: oRow.id, stepName: "Inducción General", stepCategory: "ORIENTATION", status: "COMPLETED" as const, completedDate: original.startDate, description: "Recorrido por instalaciones y presentación del equipo" },
      { onboardingId: oRow.id, stepName: "Capacitación Inicial", stepCategory: "TRAINING", status: "COMPLETED" as const, completedDate: original.startDate, description: "Capacitación en procedimientos operativos" },
      { onboardingId: oRow.id, stepName: "Alta en Seguridad Social", stepCategory: "COMPLIANCE", status: "COMPLETED" as const, completedDate: original.startDate, description: "Registro en IMSS e iNFONAVIT" },
    );
  }
  await db.insert(onboardingSteps).values(stepValues);

  console.log("Inserting benefits...");
  const benefitValues = BENEFITS.map(b => ({
    userId: b.userId,
    companyId: COMPANY_ID,
    benefitType: b.benefitType,
    provider: b.provider,
    policyNumber: b.policyNumber,
    coverageAmount: b.coverageAmount,
    isActive: true,
    startDate: b.startDate,
    createdBy: USER_ADMIN,
  }));
  await db.insert(employeeBenefits).values(benefitValues);

  console.log("Inserting salary history...");
  const salaryHistoryValues = SALARY_HISTORY.map(s => ({
    userId: s.userId,
    newSalary: s.newSalary,
    changeType: s.changeType,
    effectiveDate: s.effectiveDate,
    approvedBy: s.approvedBy,
  }));
  await db.insert(salaryHistory).values(salaryHistoryValues);

  console.log("Inserting notification preferences...");
  const allUserIds = EMPLOYEE_USERS.map(u => u.userId);
  const prefValues = allUserIds.map(uid => ({
    userId: uid,
    whatsappEnabled: true,
    emailEnabled: true,
    inAppEnabled: true,
    workflowAssignments: true,
    workflowDueSoon: true,
    workflowOverdue: true,
    incidents: true,
    inventoryAlerts: true,
  }));
  await db.insert(notificationPreferences).values(prefValues);

  console.log("Inserting break compliance rules...");
  await db.insert(breakComplianceRules).values({
    companyId: COMPANY_ID,
    ruleName: "Reglamento Interior de Trabajo",
    description: "Reglas generales de cumplimiento de jornada y descansos según LFT",
    minBreakDuration: 30,
    maxContinuousWork: 300,
    mealBreakRequired: true,
    mealBreakMinDuration: 30,
    maxDailyHours: 8,
    maxWeeklyHours: 48,
    minRestBetweenShifts: 12,
    lateTolerance: 10,
    earlyDepartureTolerance: 10,
    enableBreakReminders: true,
    reminderInterval: 120,
    enableOvertimeAlerts: true,
    overtimeAlertThreshold: 30,
    isActive: true,
  });

  console.log("Phase 2 complete!");
}
