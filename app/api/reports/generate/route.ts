import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { workflowInstances, workflowTemplates, branches, users, workflowInstanceSteps, incidents, inventoryItems, inventoryBatches, shiftSessions } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, desc, isNotNull } from "drizzle-orm";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { format as formatDate, subDays } from "date-fns";

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { reportId, format, dateFrom, dateTo, branchId } = body;

    if (!reportId || !format) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    let reportData: any = {};

    switch (reportId) {
      case "workflow-summary":
      case "workflow-detailed":
        const workflows = await getWorkflowData(session.user.companyId, dateFrom, dateTo, branchId);
        reportData = {
          title: reportId === "workflow-summary" ? "Resumen de Workflows" : "Reporte Detallado de Workflows",
          company: session.user.name || "Empresa",
          generatedAt: new Date(),
          dateRange: { from: dateFrom, to: dateTo },
          workflows,
          summary: {
            total: workflows.length,
            completed: workflows.filter((w: any) => w.status === "COMPLETED").length,
            inProgress: workflows.filter((w: any) => w.status === "IN_PROGRESS").length,
            pending: workflows.filter((w: any) => w.status === "PENDING").length,
            avgScore: workflows.filter((w: any) => w.score !== null).reduce((acc: number, w: any) => acc + (w.score || 0), 0) / workflows.filter((w: any) => w.score !== null).length || 0,
          }
        };
        break;

      case "evidence-report":
        reportData = await getEvidenceReportData(session.user.companyId, dateFrom, dateTo, branchId);
        break;

      case "compliance-nom251":
        reportData = await getNOM251ReportData(session.user.companyId, dateFrom, dateTo, branchId);
        break;

      case "inventory-status":
        reportData = await getInventoryReportData(session.user.companyId, branchId);
        break;

      case "labor-attendance":
        reportData = await getLaborReportData(session.user.companyId, dateFrom, dateTo, branchId);
        break;

      case "performance-kpis":
        reportData = await getKPIReportData(session.user.companyId, dateFrom, dateTo, branchId);
        break;

      case "incidents-report":
        reportData = await getIncidentsReportData(session.user.companyId, dateFrom, dateTo, branchId);
        break;

      default:
        return NextResponse.json(
          { error: "Unknown report type" },
          { status: 400 }
        );
    }

    return await generateReportFile(reportData, format, reportId);
  } catch (error) {
    console.error("Failed to generate report:", error);
    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 }
    );
  }
}

async function generateReportFile(reportData: any, format: string, reportId: string): Promise<NextResponse> {
  const upperFormat = format.toUpperCase();
  if (upperFormat === "EXCEL") {
    return generateExcelReport(reportData, reportId);
  } else if (upperFormat === "PDF") {
    return generatePDFReport(reportData, reportId);
  }
  return NextResponse.json({ success: true, data: reportData, message: "Report generated successfully" });
}

async function generateExcelReport(reportData: any, reportId: string): Promise<NextResponse> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Reporte");

  let columns: any[] = [];
  let rows: any[] = [];

  switch (reportId) {
    case "evidence-report":
      columns = [
        { header: "ID Instancia", key: "instanceId", width: 20 },
        { header: "Plantilla", key: "templateName", width: 30 },
        { header: "Paso", key: "stepTitle", width: 25 },
        { header: "Estado", key: "status", width: 15 },
        { header: "Tiene Evidencia", key: "hasEvidence", width: 15 },
        { header: "Fecha", key: "completedAt", width: 25 },
      ];
      rows = reportData.steps || [];
      break;

    case "inventory-status":
      columns = [
        { header: "SKU", key: "sku", width: 15 },
        { header: "Nombre", key: "name", width: 30 },
        { header: "Categoria", key: "category", width: 20 },
        { header: "Stock Actual", key: "currentStock", width: 15 },
        { header: "Nivel Minimo", key: "minLevel", width: 15 },
        { header: "Estado", key: "stockStatus", width: 15 },
      ];
      rows = reportData.items || [];
      break;

    case "incidents-report":
      columns = [
        { header: "ID", key: "id", width: 20 },
        { header: "Titulo", key: "title", width: 35 },
        { header: "Severidad", key: "severity", width: 15 },
        { header: "Estado", key: "status", width: 15 },
        { header: "Sucursal", key: "branchName", width: 20 },
        { header: "Detectado", key: "detectedAt", width: 25 },
      ];
      rows = reportData.incidents || [];
      break;

    case "labor-attendance":
      columns = [
        { header: "Empleado", key: "employeeName", width: 25 },
        { header: "Fecha", key: "date", width: 15 },
        { header: "Entrada", key: "startTime", width: 15 },
        { header: "Salida", key: "endTime", width: 15 },
        { header: "Horas Trabajadas", key: "hoursWorked", width: 15 },
        { header: "Horas Extra", key: "overtimeHours", width: 15 },
      ];
      rows = reportData.sessions || [];
      break;

    default:
      columns = [
        { header: "ID", key: "id", width: 20 },
        { header: "Plantilla", key: "templateName", width: 30 },
        { header: "Asignado a", key: "assigneeName", width: 25 },
        { header: "Sucursal", key: "branchName", width: 20 },
        { header: "Estado", key: "status", width: 15 },
        { header: "Puntuacion", key: "score", width: 15 },
        { header: "Fecha Creacion", key: "createdAt", width: 25 },
      ];
      rows = reportData.workflows || [];
  }

  sheet.columns = columns;
  sheet.addRow([reportData.title]);
  sheet.addRow([`Generado: ${formatDate(reportData.generatedAt || new Date(), "yyyy-MM-dd HH:mm")}`]);
  if (reportData.dateRange) {
    sheet.addRow([`Periodo: ${reportData.dateRange.from || "Inicio"} a ${reportData.dateRange.to || "Fin"}`]);
  }
  sheet.addRow([]);

  rows.forEach((row: any) => {
    const rowData: any = {};
    columns.forEach((col: any) => {
      let value = row[col.key];
      if (col.key === "createdAt" || col.key === "completedAt" || col.key === "detectedAt") {
        value = value ? formatDate(new Date(value), "yyyy-MM-dd HH:mm") : "N/A";
      } else if (typeof value === "boolean") {
        value = value ? "Si" : "No";
      }
      rowData[col.key] = value ?? "N/A";
    });
    sheet.addRow(rowData);
  });

  if (reportData.summary) {
    sheet.addRow([]);
    sheet.addRow(["RESUMEN"]);
    Object.entries(reportData.summary).forEach(([key, value]: [string, any]) => {
      sheet.addRow([key, typeof value === "number" ? value.toFixed(2) : value]);
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${reportId}.xlsx"`
    }
  });
}

async function generatePDFReport(reportData: any, reportId: string): Promise<NextResponse> {
  return await new Promise<NextResponse>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(new NextResponse(pdfBuffer, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${reportId}.pdf"`
          }
        }));
      });

      doc.fontSize(20).text(reportData.title, { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`Empresa: ${reportData.company || "Empresa"}`);
      doc.text(`Fecha Generacion: ${formatDate(reportData.generatedAt || new Date(), "yyyy-MM-dd HH:mm")}`);
      if (reportData.dateRange) {
        doc.text(`Periodo: ${reportData.dateRange.from || "Inicio"} a ${reportData.dateRange.to || "Fin"}`);
      }
      doc.moveDown();

      if (reportData.summary) {
        doc.fontSize(14).text("Resumen Ejecutivo");
        doc.fontSize(10).text(`Total: ${reportData.summary.total}`);
        doc.text(`Completados: ${reportData.summary.completed}`);
        doc.text(`En progreso: ${reportData.summary.inProgress}`);
        doc.text(`Promedio Puntos: ${reportData.summary.avgScore?.toFixed(2) || "N/A"}`);
        doc.moveDown();
      }

      if (reportData.workflows && reportData.workflows.length > 0) {
        doc.fontSize(14).text("Listado de Workflows");
        doc.moveDown();
        reportData.workflows.forEach((w: any) => {
          doc.fontSize(10).text(`[${w.status}] ${w.templateName || "N/A"} - Asignado a: ${w.assigneeName || "N/A"}`);
          doc.moveDown(0.5);
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function getWorkflowData(companyId: string, dateFrom?: string, dateTo?: string, branchId?: string) {
  const conditions = [
    eq(workflowTemplates.companyId, companyId),
    eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`)
  ];

  if (dateFrom) conditions.push(gte(workflowInstances.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(workflowInstances.createdAt, new Date(dateTo)));
  if (branchId) conditions.push(eq(workflowInstances.branchId, branchId));

  return await db.select({
    id: workflowInstances.id,
    templateName: workflowTemplates.name,
    status: workflowInstances.status,
    score: workflowInstances.score,
    assigneeName: users.name,
    branchName: branches.name,
    createdAt: workflowInstances.createdAt,
    completedAt: workflowInstances.completedAt,
  })
    .from(workflowInstances)
    .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
    .leftJoin(users, eq(workflowInstances.assigneeId, users.id))
    .leftJoin(branches, eq(workflowInstances.branchId, branches.id))
    .where(and(...conditions));
}

async function getEvidenceReportData(companyId: string, dateFrom?: string, dateTo?: string, branchId?: string) {
  const conditions = [eq(workflowTemplates.companyId, companyId)];

  if (dateFrom) conditions.push(gte(workflowInstanceSteps.completedAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(workflowInstanceSteps.completedAt, new Date(dateTo)));
  if (branchId) conditions.push(eq(workflowInstances.branchId, branchId));

  const steps = await db.select({
    instanceId: workflowInstanceSteps.instanceId,
    stepId: workflowInstanceSteps.stepId,
    stepTitle: sql<string>`${workflowInstanceSteps.value}->>'title'`.as("step_title"),
    status: workflowInstanceSteps.status,
    evidenceUrl: workflowInstanceSteps.evidenceUrl,
    completedAt: workflowInstanceSteps.completedAt,
    templateName: workflowTemplates.name,
    branchName: branches.name,
  })
    .from(workflowInstanceSteps)
    .leftJoin(workflowInstances, eq(workflowInstanceSteps.instanceId, workflowInstances.id))
    .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
    .leftJoin(branches, eq(workflowInstances.branchId, branches.id))
    .where(and(...conditions, isNotNull(workflowInstanceSteps.completedAt)));

  const stepsWithEvidence = steps.map(s => ({
    ...s,
    hasEvidence: !!s.evidenceUrl,
  }));

  return {
    title: "Reporte de Evidencias",
    company: "Empresa",
    generatedAt: new Date(),
    dateRange: { from: dateFrom, to: dateTo },
    steps: stepsWithEvidence,
    summary: {
      totalSteps: steps.length,
      stepsWithEvidence: steps.filter(s => s.evidenceUrl).length,
    }
  };
}

async function getNOM251ReportData(companyId: string, dateFrom?: string, dateTo?: string, branchId?: string) {
  const conditions = [
    eq(workflowTemplates.companyId, companyId),
    eq(workflowTemplates.complianceType, "NOM-251"),
  ];

  if (dateFrom) conditions.push(gte(workflowInstances.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(workflowInstances.createdAt, new Date(dateTo)));
  if (branchId) conditions.push(eq(workflowInstances.branchId, branchId));

  const nomWorkflows = await db.select({
    id: workflowInstances.id,
    templateName: workflowTemplates.name,
    regulationSection: workflowTemplates.regulationSection,
    status: workflowInstances.status,
    score: workflowInstances.score,
    branchName: branches.name,
    completedAt: workflowInstances.completedAt,
  })
    .from(workflowInstances)
    .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
    .leftJoin(branches, eq(workflowInstances.branchId, branches.id))
    .where(and(...conditions));

  const completed = nomWorkflows.filter(w => w.status === "COMPLETED");
  const avgScore = completed.length > 0 ? completed.reduce((acc, w) => acc + (w.score || 0), 0) / completed.length : 0;

  return {
    title: "Cumplimiento NOM-251",
    company: "Empresa",
    generatedAt: new Date(),
    dateRange: { from: dateFrom, to: dateTo },
    workflows: nomWorkflows,
    summary: {
      total: nomWorkflows.length,
      completed: completed.length,
      complianceRate: nomWorkflows.length > 0 ? (completed.length / nomWorkflows.length) * 100 : 0,
      avgScore: avgScore,
      bySection: nomWorkflows.reduce((acc: any, w) => {
        const section = w.regulationSection || "Otro";
        acc[section] = (acc[section] || 0) + 1;
        return acc;
      }, {}),
    }
  };
}

async function getInventoryReportData(companyId: string, branchId?: string) {
  const itemConditions = [eq(inventoryItems.companyId, companyId)];

  const items = await db.select({
    id: inventoryItems.id,
    name: inventoryItems.name,
    sku: inventoryItems.sku,
    category: inventoryItems.category,
    unit: inventoryItems.unit,
    minLevel: inventoryItems.minLevel,
  })
    .from(inventoryItems)
    .where(and(...itemConditions));

  const itemsWithStock = await Promise.all(items.map(async (item) => {
    const batchConditions = [eq(inventoryBatches.itemId, item.id)];
    if (branchId) batchConditions.push(eq(inventoryBatches.branchId, branchId));

    const batches = await db.select({
      currentQuantity: inventoryBatches.currentQuantity
    })
      .from(inventoryBatches)
      .where(and(...batchConditions));

    const currentStock = batches.reduce((sum, b) => sum + Number(b.currentQuantity || 0), 0);
    const minLevel = item.minLevel || 0;

    let stockStatus = "OK";
    if (currentStock === 0) stockStatus = "SIN_STOCK";
    else if (currentStock <= minLevel) stockStatus = "STOCK_BAJO";

    return {
      ...item,
      currentStock,
      stockStatus,
    };
  }));

  const lowStock = itemsWithStock.filter(i => i.stockStatus === "STOCK_BAJO");
  const outOfStock = itemsWithStock.filter(i => i.stockStatus === "SIN_STOCK");
  const okStock = itemsWithStock.filter(i => i.stockStatus === "OK");

  return {
    title: "Estado de Inventario",
    company: "Empresa",
    generatedAt: new Date(),
    items: itemsWithStock,
    summary: {
      totalItems: items.length,
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length,
      okStockCount: okStock.length,
    }
  };
}

async function getLaborReportData(companyId: string, dateFrom?: string, dateTo?: string, branchId?: string) {
  const conditions = [eq(branches.companyId, companyId)];

  if (dateFrom) conditions.push(gte(shiftSessions.startedAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(shiftSessions.startedAt, new Date(dateTo)));
  if (branchId) conditions.push(eq(shiftSessions.branchId, branchId));

  const sessions = await db.select({
    id: shiftSessions.id,
    employeeName: users.name,
    startedAt: shiftSessions.startedAt,
    endedAt: shiftSessions.endedAt,
    totalWorkMinutes: shiftSessions.totalWorkMinutes,
    overtimeMinutes: shiftSessions.overtimeMinutes,
    branchName: branches.name,
  })
    .from(shiftSessions)
    .leftJoin(users, eq(shiftSessions.userId, users.id))
    .leftJoin(branches, eq(shiftSessions.branchId, branches.id))
    .where(and(...conditions));

  const sessionsWithHours = sessions.map(s => ({
    ...s,
    date: s.startedAt ? formatDate(new Date(s.startedAt), "yyyy-MM-dd") : "N/A",
    startTime: s.startedAt ? formatDate(new Date(s.startedAt), "HH:mm") : "N/A",
    endTime: s.endedAt ? formatDate(new Date(s.endedAt), "HH:mm") : "N/A",
    hoursWorked: (s.totalWorkMinutes || 0) / 60,
    overtimeHours: (s.overtimeMinutes || 0) / 60,
  }));

  const totalHours = sessionsWithHours.reduce((sum, s) => sum + s.hoursWorked, 0);
  const totalOvertime = sessionsWithHours.reduce((sum, s) => sum + s.overtimeHours, 0);

  return {
    title: "Asistencia y Horas",
    company: "Empresa",
    generatedAt: new Date(),
    dateRange: { from: dateFrom, to: dateTo },
    sessions: sessionsWithHours,
    summary: {
      totalSessions: sessions.length,
      totalHours,
      totalOvertime,
      avgHoursPerSession: sessions.length > 0 ? totalHours / sessions.length : 0,
    }
  };
}

async function getKPIReportData(companyId: string, dateFrom?: string, dateTo?: string, branchId?: string) {
  const now = new Date();
  const fromDate = dateFrom ? new Date(dateFrom) : subDays(now, 30);
  const toDate = dateTo ? new Date(dateTo) : now;

  const workflowConditions = [
    eq(workflowTemplates.companyId, companyId),
    gte(workflowInstances.createdAt, fromDate),
    lte(workflowInstances.createdAt, toDate),
  ];
  if (branchId) workflowConditions.push(eq(workflowInstances.branchId, branchId));

  const workflows = await db.select({
    status: workflowInstances.status,
    score: workflowInstances.score,
  })
    .from(workflowInstances)
    .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
    .where(and(...workflowConditions));

  const completedWorkflows = workflows.filter(w => w.status === "COMPLETED");
  const completionRate = workflows.length > 0 ? (completedWorkflows.length / workflows.length) * 100 : 0;
  const avgScore = completedWorkflows.length > 0 ? completedWorkflows.reduce((acc, w) => acc + (w.score || 0), 0) / completedWorkflows.length : 0;

  const incidentConditions = branchId ? and(
    eq(incidents.branchId, branchId),
    gte(incidents.createdAt, fromDate),
    lte(incidents.createdAt, toDate)
  ) : and(
    gte(incidents.createdAt, fromDate),
    lte(incidents.createdAt, toDate)
  );

  const incidentCount = await db.select({
    count: sql<number>`count(*)`.as("count")
  })
    .from(incidents)
    .where(incidentConditions);

  const shiftConditions = [
    eq(branches.companyId, companyId),
    gte(shiftSessions.startedAt, fromDate),
    lte(shiftSessions.startedAt, toDate),
  ];
  if (branchId) shiftConditions.push(eq(shiftSessions.branchId, branchId));

  const shifts = await db.select({
    totalWorkMinutes: shiftSessions.totalWorkMinutes
  })
    .from(shiftSessions)
    .where(and(...shiftConditions));

  const totalHours = shifts.reduce((sum, s) => sum + ((s.totalWorkMinutes || 0) / 60), 0);

  return {
    title: "KPIs de Rendimiento",
    company: "Empresa",
    generatedAt: new Date(),
    dateRange: { from: dateFrom, to: dateTo },
    kpis: {
      workflowCompletionRate: completionRate,
      avgWorkflowScore: avgScore,
      totalWorkflows: workflows.length,
      completedWorkflows: completedWorkflows.length,
      incidentCount: incidentCount[0]?.count || 0,
      totalLaborHours: totalHours,
      avgHoursPerDay: shifts.length > 0 ? totalHours / shifts.length : 0,
    },
  };
}

async function getIncidentsReportData(companyId: string, dateFrom?: string, dateTo?: string, branchId?: string) {
  const conditions: any[] = [];
  if (dateFrom) conditions.push(gte(incidents.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(incidents.createdAt, new Date(dateTo)));

  const incidentsData = await db.select({
    id: incidents.id,
    title: incidents.title,
    description: incidents.description,
    severity: incidents.severity,
    status: incidents.status,
    detectedAt: incidents.createdAt,
    branchName: branches.name,
  })
    .from(incidents)
    .leftJoin(workflowInstances, eq(incidents.instanceId, workflowInstances.id))
    .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
    .leftJoin(branches, eq(incidents.branchId, branches.id))
    .where(and(
      eq(workflowTemplates.companyId, companyId),
      ...conditions
    ));

  return {
    title: "Reporte de Incidentes",
    company: "Empresa",
    generatedAt: new Date(),
    dateRange: { from: dateFrom, to: dateTo },
    incidents: incidentsData,
    summary: {
      total: incidentsData.length,
      critical: incidentsData.filter(i => i.severity === "CRITICAL").length,
      warning: incidentsData.filter(i => i.severity === "WARNING").length,
      fatal: incidentsData.filter(i => i.severity === "FATAL").length,
      resolved: incidentsData.filter(i => i.status === "RESOLVED").length,
    }
  };
}
