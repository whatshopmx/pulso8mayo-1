import "dotenv/config";
import { db } from "@/lib/db";
import {
  workflowInstanceSteps, workflowInstances, branches,
  civilProtectionDrills, extinguisherInspections, exitChecklistItems,
} from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { syncStepEvidence } from "@/lib/workflows/step-evidence";
import { COMPANY_ID, DEMO_BRANCHES, USER_ADMIN } from "./seed-constants";

function daysAgo(n: number, hourOfDay = 10): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hourOfDay, 0, 0, 0);
  return d;
}

function daysAhead(n: number, hourOfDay = 10): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hourOfDay, 0, 0, 0);
  return d;
}

export async function main() {
  console.log("=== Phase 19: Evidencia canónica (EVI-01) y protección civil ===");

  // --------------------------------------------------------------------
  // 1. Espejo canónico `evidence` desde fuentes REALES: los pasos de
  //    workflow ya sembrados con adjuntos. Usa syncStepEvidence (la misma
  //    función del runtime), así el demo replica el contracto EVI-01 y
  //    re-corridas son idempotentes (delete+insert por paso).
  // --------------------------------------------------------------------
  const steps = await db.select({
    stepRowId: workflowInstanceSteps.id,
    evidenceUrl: workflowInstanceSteps.evidenceUrl,
    completedBy: workflowInstanceSteps.completedBy,
    companyId: branches.companyId,
    branchId: workflowInstances.branchId,
  }).from(workflowInstanceSteps)
    .innerJoin(workflowInstances, eq(workflowInstances.id, workflowInstanceSteps.instanceId))
    .innerJoin(branches, eq(branches.id, workflowInstances.branchId))
    .where(and(
      eq(branches.companyId, COMPANY_ID),
      sql`${workflowInstanceSteps.evidenceUrl} IS NOT NULL AND BTRIM(${workflowInstanceSteps.evidenceUrl}) <> ''`,
    ))
    .orderBy(desc(workflowInstanceSteps.completedAt))
    .limit(80);

  let reflejos = 0;
  for (const step of steps) {
    const stored = await syncStepEvidence({
      companyId: step.companyId,
      branchId: step.branchId,
      stepRowId: step.stepRowId,
      evidenceUrl: step.evidenceUrl,
      createdBy: step.completedBy ?? USER_ADMIN,
    });
    reflejos += stored;
  }
  console.log(`Evidencia canónica reflejada: ${reflejos} adjuntos sobre ${steps.length} pasos.`);

  // --------------------------------------------------------------------
  // 2. Protección civil (fixtures demo, delete-then-insert por empresa).
  //    Diseñados para ejercitar los KPIs del servicio: 1 extintor vencido,
  //    1 por vencer en 30 días y 1 salida bloqueada.
  // --------------------------------------------------------------------
  const [branch1, branch2, branch3] = DEMO_BRANCHES;

  await db.delete(civilProtectionDrills).where(eq(civilProtectionDrills.companyId, COMPANY_ID));
  await db.delete(extinguisherInspections).where(eq(extinguisherInspections.companyId, COMPANY_ID));
  await db.delete(exitChecklistItems).where(eq(exitChecklistItems.companyId, COMPANY_ID));

  await db.insert(civilProtectionDrills).values([
    {
      companyId: COMPANY_ID, branchId: branch1.id,
      drillType: "EVACUACION", result: "EXITOSO",
      drillDate: daysAgo(15), participantsCount: 32, evacuationTimeSec: 220,
      activatedAlarm: true,
      observations: "Evacuación completa en 3:40. Roll-call en punto de reunión al 100%.",
      evidenceUrls: ["local://evidence/simulacro-evacuacion-condesa-1.jpg", "local://evidence/simulacro-evacuacion-condesa-2.jpg"],
      reportUrl: "local://documents/acta-simulacro-condesa.pdf",
      coordinatorName: "Carlos Méndez", coordinatorPhone: "+52 55 1234 0001",
      createdBy: USER_ADMIN,
    },
    {
      companyId: COMPANY_ID, branchId: branch2.id,
      drillType: "SISMO", result: "ACEPTABLE",
      drillDate: daysAgo(40, 16), participantsCount: 27, evacuationTimeSec: 264,
      activatedAlarm: true,
      observations: "2 comensales quedaron en la terraza; reforzar el anclaje del personal de zona exterior.",
      evidenceUrls: ["local://evidence/simulacro-sismo-polanco-1.jpg"],
      coordinatorName: "María García", coordinatorPhone: "+52 55 1234 0002",
      createdBy: USER_ADMIN,
    },
    {
      companyId: COMPANY_ID, branchId: branch3.id,
      drillType: "INCENDIO", result: "REQUIERE_MEJORA",
      drillDate: daysAgo(90), participantsCount: 19, evacuationTimeSec: 340,
      activatedAlarm: false,
      observations: "La alarma manual no se activó desde cocina; reportar al proveedor de mantenimiento.",
      evidenceUrls: ["local://evidence/simulacro-incendio-roma-1.jpg"],
      coordinatorName: "Juan López", coordinatorPhone: "+52 55 1234 0003",
      createdBy: USER_ADMIN,
    },
  ]);

  await db.insert(extinguisherInspections).values([
    // Condesa: cocina óptimo + hall aceptable por vencer (alimenta KPI "por vencer")
    {
      companyId: COMPANY_ID, branchId: branch1.id,
      extinguisherId: "EXT-COC-001", location: "Cocina principal",
      extinguisherType: "PQS", capacityKg: 6,
      inspectionDate: daysAgo(10), pressureOk: true, sealOk: true, hoseOk: true, labelOk: true,
      generalStatus: "OPTIMO",
      expirationDate: daysAhead(400), lastRechargeDate: daysAgo(100), nextInspectionDate: daysAhead(80),
      evidenceUrl: "local://evidence/ext-co2-condesa.jpg",
      inspectorName: "Servicios Bravo", inspectorNotes: "Sin observaciones.",
      createdBy: USER_ADMIN,
    },
    {
      companyId: COMPANY_ID, branchId: branch1.id,
      extinguisherId: "EXT-SAL-001", location: "Hall de entrada",
      extinguisherType: "ABC", capacityKg: 3,
      inspectionDate: daysAgo(10), pressureOk: true, sealOk: true, hoseOk: true, labelOk: false,
      generalStatus: "ACEPTABLE",
      expirationDate: daysAhead(350), lastRechargeDate: daysAgo(200), nextInspectionDate: daysAhead(25),
      evidenceUrl: "local://evidence/ext-abc-condesa.jpg",
      inspectorName: "Servicios Bravo",
      inspectorNotes: "Etiqueta con desgaste; pedir reemplazo en próxima recarga.",
      createdBy: USER_ADMIN,
    },
    // Polanco: cocina VENCIDO (alimenta KPI "expirados" + acción inmediata)
    {
      companyId: COMPANY_ID, branchId: branch2.id,
      extinguisherId: "EXT-COC-002", location: "Cocina principal",
      extinguisherType: "CO2", capacityKg: 5,
      inspectionDate: daysAgo(3), pressureOk: false, sealOk: true, hoseOk: true, labelOk: true,
      generalStatus: "REQUIERE_RECARGA",
      expirationDate: daysAgo(30), lastRechargeDate: daysAgo(500), nextInspectionDate: daysAhead(5),
      evidenceUrl: "local://evidence/ext-co2-polanco.jpg",
      ocrRawData: { rawText: "FECHA DE VENCIMIENTO: 2026-09-XX", confidence: 0.86 },
      ocrProcessedAt: daysAgo(3, 11),
      inspectorName: "Servicios Bravo",
      inspectorNotes: "Manómetro en zona roja y febril vencido — recarga URGENTE.",
      createdBy: USER_ADMIN,
    },
    {
      companyId: COMPANY_ID, branchId: branch2.id,
      extinguisherId: "EXT-SAL-002", location: "Pasillo a sanitarios",
      extinguisherType: "ABC", capacityKg: 3,
      inspectionDate: daysAgo(3), pressureOk: true, sealOk: true, hoseOk: true, labelOk: true,
      generalStatus: "OPTIMO",
      expirationDate: daysAhead(420), lastRechargeDate: daysAgo(60), nextInspectionDate: daysAhead(180),
      evidenceUrl: "local://evidence/ext-abc-polanco.jpg",
      inspectorName: "Servicios Bravo",
      createdBy: USER_ADMIN,
    },
    // Roma: dos óptimos de respaldo
    {
      companyId: COMPANY_ID, branchId: branch3.id,
      extinguisherId: "EXT-COC-003", location: "Cocina principal",
      extinguisherType: "PQS", capacityKg: 6,
      inspectionDate: daysAgo(5), pressureOk: true, sealOk: true, hoseOk: true, labelOk: true,
      generalStatus: "OPTIMO",
      expirationDate: daysAhead(390), lastRechargeDate: daysAgo(40), nextInspectionDate: daysAhead(85),
      evidenceUrl: "local://evidence/ext-pqs-roma.jpg",
      inspectorName: "Servicios Bravo",
      createdBy: USER_ADMIN,
    },
    {
      companyId: COMPANY_ID, branchId: branch3.id,
      extinguisherId: "EXT-BAR-003", location: "Barra",
      extinguisherType: "CO2", capacityKg: 5,
      inspectionDate: daysAgo(5), pressureOk: true, sealOk: true, hoseOk: true, labelOk: true,
      generalStatus: "OPTIMO",
      expirationDate: daysAhead(410), lastRechargeDate: daysAgo(90), nextInspectionDate: daysAhead(90),
      evidenceUrl: "local://evidence/ext-co2-barra-roma.jpg",
      inspectorName: "Servicios Bravo",
      createdBy: USER_ADMIN,
    },
  ]);

  const inspectRound = "Semanal";
  await db.insert(exitChecklistItems).values([
    // Condesa: bloqueo demo (alimenta el KPI de salidas obstruidas)
    {
      companyId: COMPANY_ID, branchId: branch1.id,
      exitLocation: "Salida trasera",
      isClear: false, signageOk: true, emergencyLightOk: true, doorOpensOk: true,
      accessWidthCm: 55,
      photoUrl: "local://evidence/salida-trasera-condesa.jpg",
      photos: ["local://evidence/salida-trasera-condesa.jpg", "local://evidence/salida-trasera-condesa-2.jpg"],
      issuesDetected: "Caja de merma bloqueando el arco de la puerta; mover al cuartito de limpieza.",
      notes: "El resto del pasillo despejado.",
      inspectedAt: daysAgo(2, 9), inspectedBy: USER_ADMIN, inspectionRound: inspectRound,
    },
    {
      companyId: COMPANY_ID, branchId: branch1.id,
      exitLocation: "Puerta principal",
      isClear: true, signageOk: true, emergencyLightOk: true, doorOpensOk: true,
      accessWidthCm: 120,
      photoUrl: "local://evidence/salida-principal-condesa.jpg",
      photos: ["local://evidence/salida-principal-condesa.jpg"],
      notes: "Sin observaciones.",
      inspectedAt: daysAgo(2, 9), inspectedBy: USER_ADMIN, inspectionRound: inspectRound,
    },
    // Polanco: sin bloqueos
    {
      companyId: COMPANY_ID, branchId: branch2.id,
      exitLocation: "Puerta de terraza",
      isClear: true, signageOk: true, emergencyLightOk: true, doorOpensOk: true,
      accessWidthCm: 110,
      photoUrl: "local://evidence/salida-terraza-polanco.jpg",
      photos: ["local://evidence/salida-terraza-polanco.jpg"],
      inspectedAt: daysAgo(2, 14), inspectedBy: USER_ADMIN, inspectionRound: inspectRound,
    },
    // Roma: puera pesada con luz de emergencia intermitente
    {
      companyId: COMPANY_ID, branchId: branch3.id,
      exitLocation: "Puerta principal",
      isClear: true, signageOk: true, emergencyLightOk: false, doorOpensOk: true,
      accessWidthCm: 115,
      photoUrl: "local://evidence/salida-principal-roma.jpg",
      photos: ["local://evidence/salida-principal-roma.jpg"],
      issuesDetected: "Luz de emergencia parpadea; batería a revisión.",
      inspectedAt: daysAgo(1, 9), inspectedBy: USER_ADMIN, inspectionRound: inspectRound,
    },
  ]);

  console.log("Protección civil demo: 3 simulacros, 6 extintores (1 vencido, 1 por vencer), 4 checklists de salida (1 bloqueada).");
}
