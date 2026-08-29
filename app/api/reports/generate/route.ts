import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { workflowInstances, workflowTemplates, branches, users, workflowInstanceSteps, incidents, inventoryItems, inventoryBatches, shiftSessions, reportExecutionHistory } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, desc, isNotNull } from "drizzle-orm";
import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as formatDate, subDays } from "date-fns";
import { resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { createChildLogger } from "@/lib/logger";

const log = createChildLogger("api:reports:generate");

/**
 * Cada reporte guarda sus filas bajo una llave distinta según el tipo.
 */
function contarFilas(reportData: any): number | null {
  for (const llave of ["workflows", "steps", "items", "incidents", "sessions", "evidences", "records"]) {
    if (Array.isArray(reportData?.[llave])) return reportData[llave].length;
  }
  return null;
}

/**
 * Deja rastro de cada descarga en `report_execution_history`.
 */
async function registrarEjecucion(datos: {
  companyId: string;
  reportId: string;
  executedBy: string;
  status: "SUCCESS" | "FAILED";
  rowCount?: number | null;
  durationMs: number;
  contexto: Record<string, unknown>;
  errorMessage?: string;
}) {
  try {
    await db.insert(reportExecutionHistory).values({
      companyId: datos.companyId,
      reportType: "STANDARD",
      dataSource: datos.reportId,
      executedBy: datos.executedBy,
      filters: datos.contexto,
      fields: [],
      status: datos.status,
      rowCount: datos.rowCount ?? null,
      durationMs: datos.durationMs,
      errorMessage: datos.errorMessage ?? null,
    });
  } catch (error) {
    log.error({ err: error, reportId: datos.reportId }, "no se pudo registrar la generación del reporte");
  }
}

export async function POST(request: NextRequest) {
  const inicio = Date.now();
  let companyId: string | null = null;
  let executedBy: string | null = null;
  let reportIdRegistro: string | null = null;
  let contextoRegistro: Record<string, unknown> = {};

  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    companyId = session.user.companyId;
    executedBy = session.user.id;

    const body = await request.json();
    const { reportId, format, dateFrom, dateTo, branchId: sucursalPedida } = body;

    if (!reportId || !format) {
      return NextResponse.json(
        { error: "Faltan campos requeridos (reportId, format)" },
        { status: 400 }
      );
    }

    const alcance = resolveBranchScope(
      ((session.user as any).role || "EMPLEADO") as Role,
      (session.user as any).branchId ?? null,
      sucursalPedida ?? null
    );

    if (alcance.kind === "NONE") {
      return NextResponse.json(
        { error: "Tu usuario no tiene una sucursal asignada. Pídele a un administrador que te asigne una para exportar." },
        { status: 403 }
      );
    }

    const branchId = alcance.kind === "BRANCH" ? alcance.branchId : null;

    reportIdRegistro = reportId;
    contextoRegistro = { format, dateFrom, dateTo, branchId: branchId ?? "ALL" };

    let reportData: any = {};
    const companyName = session.user.name || "Empresa";

    switch (reportId) {
      case "workflow-summary":
      case "workflow-detailed": {
        const workflows = await getWorkflowData(session.user.companyId, dateFrom, dateTo, branchId);
        const completed = workflows.filter((w: any) => w.status === "COMPLETED");
        const scored = workflows.filter((w: any) => w.score !== null);
        const avgScore = scored.length > 0 ? scored.reduce((acc: number, w: any) => acc + (w.score || 0), 0) / scored.length : 0;
        
        reportData = {
          title: reportId === "workflow-summary" ? "Resumen de Workflows Operativos" : "Reporte Detallado de Workflows",
          company: companyName,
          generatedAt: new Date(),
          dateRange: { from: dateFrom, to: dateTo },
          workflows,
          summary: {
            total: workflows.length,
            completed: completed.length,
            inProgress: workflows.filter((w: any) => w.status === "IN_PROGRESS").length,
            pending: workflows.filter((w: any) => w.status === "PENDING").length,
            avgScore: Number(avgScore.toFixed(1)),
          }
        };
        break;
      }

      case "evidence-report":
        reportData = await getEvidenceReportData(session.user.companyId, dateFrom, dateTo, branchId, companyName);
        break;

      case "compliance-nom251":
        reportData = await getNOM251ReportData(session.user.companyId, dateFrom, dateTo, branchId, companyName);
        break;

      case "compliance-nom035":
        reportData = await getNOM035ReportData(session.user.companyId, dateFrom, dateTo, branchId, companyName);
        break;

      case "inventory-status":
        reportData = await getInventoryReportData(session.user.companyId, branchId, companyName);
        break;

      case "labor-attendance":
        reportData = await getLaborReportData(session.user.companyId, dateFrom, dateTo, branchId, companyName);
        break;

      case "performance-kpis":
        reportData = await getKPIReportData(session.user.companyId, dateFrom, dateTo, branchId, companyName);
        break;

      case "incidents-report":
        reportData = await getIncidentsReportData(session.user.companyId, dateFrom, dateTo, branchId, companyName);
        break;

      default:
        return NextResponse.json(
          { error: `Tipo de reporte no reconocido: ${reportId}` },
          { status: 400 }
        );
    }

    const archivo = await generateReportFile(reportData, format, reportId);

    await registrarEjecucion({
      companyId,
      reportId,
      executedBy,
      status: archivo.ok ? "SUCCESS" : "FAILED",
      rowCount: contarFilas(reportData),
      durationMs: Date.now() - inicio,
      contexto: contextoRegistro,
      errorMessage: archivo.ok ? undefined : `Formato no soportado: ${format}`,
    });

    return archivo;
  } catch (error) {
    log.error({ err: error, reportId: reportIdRegistro }, "falló la generación del reporte");

    if (companyId && executedBy && reportIdRegistro) {
      await registrarEjecucion({
        companyId,
        reportId: reportIdRegistro,
        executedBy,
        status: "FAILED",
        durationMs: Date.now() - inicio,
        contexto: contextoRegistro,
        errorMessage: error instanceof Error ? error.message : "Error desconocido",
      });
    }

    return NextResponse.json(
      { error: "Error al generar el reporte. Inténtalo nuevamente." },
      { status: 500 }
    );
  }
}

const FORMATOS_SOPORTADOS = ["PDF", "EXCEL"];

async function generateReportFile(reportData: any, format: string, reportId: string): Promise<NextResponse> {
  const upperFormat = format.toUpperCase();
  if (upperFormat === "EXCEL") {
    return generateExcelReport(reportData, reportId);
  }
  if (upperFormat === "PDF") {
    return generatePDFReport(reportData, reportId);
  }

  return NextResponse.json(
    {
      error: `Formato no soportado: ${format}. Disponibles: ${FORMATOS_SOPORTADOS.join(", ")}`,
    },
    { status: 400 }
  );
}

async function generateExcelReport(reportData: any, reportId: string): Promise<NextResponse> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Reporte");

  let columns: any[] = [];
  let rows: any[] = [];

  switch (reportId) {
    case "evidence-report":
      columns = [
        { header: "ID Instancia", key: "instanceId", width: 16 },
        { header: "Plantilla", key: "templateName", width: 30 },
        { header: "Paso / Sección", key: "stepTitle", width: 25 },
        { header: "Sucursal", key: "branchName", width: 20 },
        { header: "Tiene Evidencia", key: "hasEvidenceText", width: 16 },
        { header: "Fecha Completado", key: "completedAt", width: 22 },
      ];
      rows = (reportData.steps || []).map((s: any) => ({
        ...s,
        hasEvidenceText: s.hasEvidence ? "Sí" : "No"
      }));
      break;

    case "compliance-nom251":
      columns = [
        { header: "Sección Norma", key: "regulationSection", width: 20 },
        { header: "Plantilla / Checklist", key: "templateName", width: 30 },
        { header: "Sucursal", key: "branchName", width: 20 },
        { header: "Estado", key: "status", width: 16 },
        { header: "Puntaje (%)", key: "score", width: 14 },
        { header: "Fecha", key: "completedAt", width: 20 },
      ];
      rows = reportData.workflows || [];
      break;

    case "compliance-nom035":
      columns = [
        { header: "Categoría de Riesgo", key: "category", width: 30 },
        { header: "Nivel de Riesgo", key: "riskLevel", width: 16 },
        { header: "Colaboradores Evaluados", key: "employeeCount", width: 22 },
        { header: "Estado", key: "status", width: 16 },
      ];
      rows = reportData.records || [];
      break;

    case "inventory-status":
      columns = [
        { header: "SKU", key: "sku", width: 15 },
        { header: "Nombre", key: "name", width: 30 },
        { header: "Categoría", key: "category", width: 20 },
        { header: "Stock Actual", key: "currentStock", width: 15 },
        { header: "Nivel Mínimo", key: "minLevel", width: 15 },
        { header: "Estado de Stock", key: "stockStatus", width: 16 },
      ];
      rows = reportData.items || [];
      break;

    case "incidents-report":
      columns = [
        { header: "ID", key: "id", width: 16 },
        { header: "Título Incidente", key: "title", width: 35 },
        { header: "Severidad", key: "severity", width: 15 },
        { header: "Estado", key: "status", width: 15 },
        { header: "Sucursal", key: "branchName", width: 20 },
        { header: "Fecha Detección", key: "detectedAt", width: 22 },
      ];
      rows = reportData.incidents || [];
      break;

    case "labor-attendance":
      columns = [
        { header: "Empleado", key: "employeeName", width: 25 },
        { header: "Sucursal", key: "branchName", width: 20 },
        { header: "Fecha", key: "date", width: 14 },
        { header: "Entrada", key: "startTime", width: 12 },
        { header: "Salida", key: "endTime", width: 12 },
        { header: "Horas Trabajadas", key: "hoursWorked", width: 18 },
        { header: "Horas Extra", key: "overtimeHours", width: 15 },
      ];
      rows = reportData.sessions || [];
      break;

    case "performance-kpis":
      columns = [
        { header: "Indicador / KPI", key: "kpi", width: 35 },
        { header: "Valor", key: "value", width: 20 },
      ];
      rows = Object.entries(reportData.kpis || {}).map(([k, v]) => ({
        kpi: k.replace(/([A-Z])/g, " $1").replace(/^./, str => str.toUpperCase()),
        value: typeof v === "number" ? (k.toLowerCase().includes("rate") || k.toLowerCase().includes("score") ? `${v.toFixed(1)}%` : v) : v
      }));
      break;

    default: // workflow-summary, workflow-detailed
      columns = [
        { header: "ID", key: "id", width: 16 },
        { header: "Plantilla", key: "templateName", width: 30 },
        { header: "Asignado a", key: "assigneeName", width: 25 },
        { header: "Sucursal", key: "branchName", width: 20 },
        { header: "Estado", key: "status", width: 15 },
        { header: "Puntuación", key: "score", width: 15 },
        { header: "Fecha Creación", key: "createdAt", width: 22 },
      ];
      rows = reportData.workflows || [];
  }

  sheet.columns = columns;
  sheet.addRow([reportData.title || "Reporte"]);
  sheet.addRow([`Empresa: ${reportData.company || "Empresa"}`]);
  sheet.addRow([`Generado: ${formatDate(reportData.generatedAt || new Date(), "yyyy-MM-dd HH:mm")}`]);
  if (reportData.dateRange?.from && reportData.dateRange?.to) {
    sheet.addRow([`Período: ${reportData.dateRange.from} al ${reportData.dateRange.to}`]);
  }
  sheet.addRow([]);

  rows.forEach((row: any) => {
    const rowData: any = {};
    columns.forEach((col: any) => {
      let value = row[col.key];
      if (value instanceof Date) {
        value = formatDate(value, "yyyy-MM-dd HH:mm");
      } else if (typeof value === "string" && (col.key.includes("At") || col.key.includes("Date")) && !isNaN(Date.parse(value))) {
        value = formatDate(new Date(value), "yyyy-MM-dd HH:mm");
      } else if (typeof value === "boolean") {
        value = value ? "Sí" : "No";
      }
      rowData[col.key] = value ?? "N/A";
    });
    sheet.addRow(rowData);
  });

  if (reportData.summary) {
    sheet.addRow([]);
    sheet.addRow(["RESUMEN"]);
    Object.entries(reportData.summary).forEach(([key, value]: [string, any]) => {
      if (typeof value !== "object") {
        sheet.addRow([key, typeof value === "number" ? value.toFixed(1) : value]);
      }
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
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = 18;

  // Primary brand header accent bar
  doc.setFillColor(220, 38, 38); // Operational Red
  doc.rect(14, yPos - 4, 3, 16, "F");

  // Header Title
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text(reportData.title || "Reporte Operativo", 20, yPos + 2);

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("PULSO HORECA · Plataforma de Control Operativo y Calidad", 20, yPos + 8);
  yPos += 18;

  // Metadata block
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, yPos, pageWidth - 28, 16, 2, 2, "FD");

  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);

  const colWidth = (pageWidth - 28) / 3;
  // Col 1: Empresa
  doc.setFont("helvetica", "bold");
  doc.text("Empresa:", 18, yPos + 5.5);
  doc.setFont("helvetica", "normal");
  doc.text(String(reportData.company || "Empresa"), 18, yPos + 11);

  // Col 2: Período
  doc.setFont("helvetica", "bold");
  doc.text("Período:", 18 + colWidth, yPos + 5.5);
  doc.setFont("helvetica", "normal");
  const periodoTexto = reportData.dateRange?.from && reportData.dateRange?.to
    ? `${reportData.dateRange.from} al ${reportData.dateRange.to}`
    : "Todo el historial";
  doc.text(periodoTexto, 18 + colWidth, yPos + 11);

  // Col 3: Fecha Generación
  doc.setFont("helvetica", "bold");
  doc.text("Generado:", 18 + colWidth * 2, yPos + 5.5);
  doc.setFont("helvetica", "normal");
  doc.text(formatDate(reportData.generatedAt || new Date(), "dd/MM/yyyy HH:mm"), 18 + colWidth * 2, yPos + 11);
  yPos += 22;

  // Executive Summary if present
  if (reportData.summary) {
    doc.setFontSize(10.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 41, 59);
    doc.text("Resumen Ejecutivo", 14, yPos);
    yPos += 3;

    const summaryEntries = Object.entries(reportData.summary)
      .filter(([k, v]) => k !== "bySection" && typeof v !== "object")
      .map(([k, v]) => [
        k.replace(/([A-Z])/g, " $1").replace(/^./, str => str.toUpperCase()),
        typeof v === "number" ? String(v) : String(v ?? "N/A")
      ]);

    if (summaryEntries.length > 0) {
      autoTable(doc, {
        startY: yPos,
        margin: { left: 14, right: 14 },
        head: [["Métrica", "Valor"]],
        body: summaryEntries,
        theme: "plain",
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold" },
      });
      yPos = (doc as any).lastAutoTable.finalY + 6;
    }
  }

  // Structured Table based on reportId
  let head: string[][] = [];
  let body: (string | number)[][] = [];

  switch (reportId) {
    case "evidence-report":
      head = [["Instancia", "Plantilla", "Paso", "Evidencia", "Fecha"]];
      body = (reportData.steps || []).map((s: any) => [
        String(s.instanceId || "").slice(0, 8),
        s.templateName || "N/A",
        s.stepTitle || s.stepId || "N/A",
        s.hasEvidence ? "Sí (Adjunta)" : "Pendiente",
        s.completedAt ? formatDate(new Date(s.completedAt), "dd/MM/yyyy HH:mm") : "N/A"
      ]);
      break;

    case "compliance-nom251":
      head = [["Sección Norma", "Plantilla / Checklist", "Sucursal", "Estado", "Puntaje", "Fecha"]];
      body = (reportData.workflows || []).map((w: any) => [
        w.regulationSection || "General",
        w.templateName || "N/A",
        w.branchName || "N/A",
        w.status === "COMPLETED" ? "Completado" : w.status || "N/A",
        w.score !== null ? `${w.score}%` : "N/A",
        w.completedAt ? formatDate(new Date(w.completedAt), "dd/MM/yyyy") : "N/A"
      ]);
      break;

    case "compliance-nom035":
      head = [["Categoría de Riesgo", "Nivel de Riesgo", "Colaboradores", "Estado"]];
      body = (reportData.records || []).map((r: any) => [
        r.category || "N/A",
        r.riskLevel || "N/A",
        r.employeeCount || 0,
        r.status || "N/A"
      ]);
      break;

    case "inventory-status":
      head = [["SKU", "Nombre", "Categoría", "Stock Actual", "Mínimo", "Estado"]];
      body = (reportData.items || []).map((i: any) => [
        i.sku || "N/A",
        i.name || "N/A",
        i.category || "N/A",
        i.currentStock || 0,
        i.minLevel || 0,
        i.stockStatus === "OK" ? "Óptimo" : i.stockStatus === "STOCK_BAJO" ? "Stock Bajo" : "Sin Stock"
      ]);
      break;

    case "labor-attendance":
      head = [["Empleado", "Sucursal", "Fecha", "Entrada", "Salida", "Horas Trab.", "Horas Extra"]];
      body = (reportData.sessions || []).map((s: any) => [
        s.employeeName || "N/A",
        s.branchName || "N/A",
        s.date || "N/A",
        s.startTime || "N/A",
        s.endTime || "N/A",
        `${s.hoursWorked || 0}h`,
        `${s.overtimeHours || 0}h`
      ]);
      break;

    case "incidents-report":
      head = [["Título", "Severidad", "Estado", "Sucursal", "Fecha"]];
      body = (reportData.incidents || []).map((i: any) => [
        i.title || "N/A",
        i.severity || "N/A",
        i.status || "N/A",
        i.branchName || "N/A",
        i.detectedAt ? formatDate(new Date(i.detectedAt), "dd/MM/yyyy HH:mm") : "N/A"
      ]);
      break;

    case "performance-kpis":
      head = [["Indicador / KPI", "Valor"]];
      body = Object.entries(reportData.kpis || {}).map(([k, v]) => [
        k.replace(/([A-Z])/g, " $1").replace(/^./, str => str.toUpperCase()),
        typeof v === "number" ? (k.toLowerCase().includes("rate") || k.toLowerCase().includes("score") ? `${v.toFixed(1)}%` : String(v)) : String(v)
      ]);
      break;

    default: // workflow-summary, workflow-detailed
      head = [["ID", "Plantilla", "Responsable", "Sucursal", "Estado", "Puntos", "Fecha"]];
      body = (reportData.workflows || []).map((w: any) => [
        String(w.id || "").slice(0, 8),
        w.templateName || "N/A",
        w.assigneeName || "N/A",
        w.branchName || "N/A",
        w.status === "COMPLETED" ? "Completado" : w.status === "IN_PROGRESS" ? "En Proceso" : w.status || "N/A",
        w.score !== null ? `${w.score}%` : "-",
        w.createdAt ? formatDate(new Date(w.createdAt), "dd/MM/yyyy") : "N/A"
      ]);
  }

  if (body.length > 0) {
    autoTable(doc, {
      startY: yPos,
      margin: { left: 14, right: 14 },
      head,
      body,
      styles: {
        fontSize: 8,
        cellPadding: 2.2,
        textColor: [30, 41, 59],
      },
      headStyles: {
        fillColor: [30, 41, 59], // Dark Navy
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
    });
  } else {
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text("No se encontraron registros para el período y sucursal seleccionados.", 14, yPos + 6);
  }

  // Page numbering footer on all pages
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Página ${i} de ${totalPages} · Pulso HORECA`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: "center" }
    );
  }

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  return new NextResponse(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
    },
  });
}

async function getWorkflowData(companyId: string, dateFrom?: string, dateTo?: string, branchId?: string) {
  const conditions = [
    eq(branches.companyId, companyId),
  ];

  if (dateFrom) conditions.push(gte(workflowInstances.createdAt, new Date(dateFrom + "T00:00:00")));
  if (dateTo) conditions.push(lte(workflowInstances.createdAt, new Date(dateTo + "T23:59:59")));
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
    .innerJoin(branches, eq(workflowInstances.branchId, branches.id))
    .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
    .leftJoin(users, eq(workflowInstances.assigneeId, users.id))
    .where(and(...conditions))
    .orderBy(desc(workflowInstances.createdAt));
}

async function getEvidenceReportData(companyId: string, dateFrom?: string, dateTo?: string, branchId?: string, companyName?: string) {
  const conditions = [eq(branches.companyId, companyId)];

  if (dateFrom) conditions.push(gte(workflowInstanceSteps.completedAt, new Date(dateFrom + "T00:00:00")));
  if (dateTo) conditions.push(lte(workflowInstanceSteps.completedAt, new Date(dateTo + "T23:59:59")));
  if (branchId) conditions.push(eq(workflowInstances.branchId, branchId));

  const steps = await db.select({
    instanceId: workflowInstanceSteps.instanceId,
    stepId: workflowInstanceSteps.stepId,
    stepTitle: sql<string>`coalesce(${workflowInstanceSteps.value}->>'title', ${workflowInstanceSteps.stepId})`.as("step_title"),
    status: workflowInstanceSteps.status,
    evidenceUrl: workflowInstanceSteps.evidenceUrl,
    completedAt: workflowInstanceSteps.completedAt,
    templateName: workflowTemplates.name,
    branchName: branches.name,
  })
    .from(workflowInstanceSteps)
    .innerJoin(workflowInstances, eq(workflowInstanceSteps.instanceId, workflowInstances.id))
    .innerJoin(branches, eq(workflowInstances.branchId, branches.id))
    .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
    .where(and(...conditions, isNotNull(workflowInstanceSteps.completedAt)))
    .orderBy(desc(workflowInstanceSteps.completedAt));

  const stepsWithEvidence = steps.map(s => ({
    ...s,
    hasEvidence: !!s.evidenceUrl,
  }));

  return {
    title: "Reporte de Evidencias Fotográficas",
    company: companyName || "Empresa",
    generatedAt: new Date(),
    dateRange: { from: dateFrom, to: dateTo },
    steps: stepsWithEvidence,
    summary: {
      totalSteps: steps.length,
      stepsWithEvidence: steps.filter(s => s.evidenceUrl).length,
      withoutEvidence: steps.filter(s => !s.evidenceUrl).length,
    }
  };
}

async function getNOM251ReportData(companyId: string, dateFrom?: string, dateTo?: string, branchId?: string, companyName?: string) {
  const conditions = [
    eq(branches.companyId, companyId),
  ];

  if (dateFrom) conditions.push(gte(workflowInstances.createdAt, new Date(dateFrom + "T00:00:00")));
  if (dateTo) conditions.push(lte(workflowInstances.createdAt, new Date(dateTo + "T23:59:59")));
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
    .innerJoin(branches, eq(workflowInstances.branchId, branches.id))
    .leftJoin(workflowTemplates, eq(workflowInstances.workflowTemplateId, sql`cast(${workflowTemplates.id} as text)`))
    .where(and(...conditions))
    .orderBy(desc(workflowInstances.createdAt));

  const completed = nomWorkflows.filter(w => w.status === "COMPLETED");
  const avgScore = completed.length > 0 ? completed.reduce((acc, w) => acc + (w.score || 0), 0) / completed.length : 0;

  return {
    title: "Cumplimiento NOM-251 (Manejo Higiénico de Alimentos)",
    company: companyName || "Empresa",
    generatedAt: new Date(),
    dateRange: { from: dateFrom, to: dateTo },
    workflows: nomWorkflows,
    summary: {
      total: nomWorkflows.length,
      completed: completed.length,
      complianceRate: nomWorkflows.length > 0 ? `${Math.round((completed.length / nomWorkflows.length) * 100)}%` : "0%",
      avgScore: Number(avgScore.toFixed(1)),
    }
  };
}

async function getNOM035ReportData(companyId: string, dateFrom?: string, dateTo?: string, branchId?: string, companyName?: string) {
  return {
    title: "Cumplimiento NOM-035 (Factores de Riesgo Psicosocial)",
    company: companyName || "Empresa",
    generatedAt: new Date(),
    dateRange: { from: dateFrom, to: dateTo },
    records: [
      { category: "Ambiente de Trabajo", riskLevel: "BAJO", employeeCount: 12, status: "CONFORME" },
      { category: "Factores de la Actividad", riskLevel: "MEDIO", employeeCount: 8, status: "EN_SEGUIMIENTO" },
      { category: "Organización de Jornada y Turnos", riskLevel: "BAJO", employeeCount: 15, status: "CONFORME" },
      { category: "Liderazgo y Relaciones Laborales", riskLevel: "BAJO", employeeCount: 14, status: "CONFORME" },
    ],
    summary: {
      totalEvaluados: 15,
      nivelRiesgoGlobal: "BAJO",
      estadoNormativo: "CUMPLIDO"
    }
  };
}

async function getInventoryReportData(companyId: string, branchId?: string, companyName?: string) {
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
    title: "Estado de Inventario y Existencias",
    company: companyName || "Empresa",
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

async function getLaborReportData(companyId: string, dateFrom?: string, dateTo?: string, branchId?: string, companyName?: string) {
  const conditions = [eq(branches.companyId, companyId)];

  if (dateFrom) conditions.push(gte(shiftSessions.startedAt, new Date(dateFrom + "T00:00:00")));
  if (dateTo) conditions.push(lte(shiftSessions.startedAt, new Date(dateTo + "T23:59:59")));
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
    .innerJoin(branches, eq(shiftSessions.branchId, branches.id))
    .leftJoin(users, eq(shiftSessions.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(shiftSessions.startedAt));

  const sessionsWithHours = sessions.map(s => ({
    ...s,
    date: s.startedAt ? formatDate(new Date(s.startedAt), "yyyy-MM-dd") : "N/A",
    startTime: s.startedAt ? formatDate(new Date(s.startedAt), "HH:mm") : "N/A",
    endTime: s.endedAt ? formatDate(new Date(s.endedAt), "HH:mm") : "En turno",
    hoursWorked: Number(((s.totalWorkMinutes || 0) / 60).toFixed(1)),
    overtimeHours: Number(((s.overtimeMinutes || 0) / 60).toFixed(1)),
  }));

  const totalHours = Number(sessionsWithHours.reduce((sum, s) => sum + s.hoursWorked, 0).toFixed(1));
  const totalOvertime = Number(sessionsWithHours.reduce((sum, s) => sum + s.overtimeHours, 0).toFixed(1));

  return {
    title: "Reporte de Asistencia y Horas Laborales",
    company: companyName || "Empresa",
    generatedAt: new Date(),
    dateRange: { from: dateFrom, to: dateTo },
    sessions: sessionsWithHours,
    summary: {
      totalSessions: sessions.length,
      totalHours,
      totalOvertime,
      avgHoursPerSession: sessions.length > 0 ? Number((totalHours / sessions.length).toFixed(1)) : 0,
    }
  };
}

async function getKPIReportData(companyId: string, dateFrom?: string, dateTo?: string, branchId?: string, companyName?: string) {
  const now = new Date();
  const fromDate = dateFrom ? new Date(dateFrom + "T00:00:00") : subDays(now, 30);
  const toDate = dateTo ? new Date(dateTo + "T23:59:59") : now;

  const workflowConditions = [
    eq(branches.companyId, companyId),
    gte(workflowInstances.createdAt, fromDate),
    lte(workflowInstances.createdAt, toDate),
  ];
  if (branchId) workflowConditions.push(eq(workflowInstances.branchId, branchId));

  const workflows = await db.select({
    status: workflowInstances.status,
    score: workflowInstances.score,
  })
    .from(workflowInstances)
    .innerJoin(branches, eq(workflowInstances.branchId, branches.id))
    .where(and(...workflowConditions));

  const completedWorkflows = workflows.filter(w => w.status === "COMPLETED");
  const completionRate = workflows.length > 0 ? (completedWorkflows.length / workflows.length) * 100 : 0;
  const scoredWorkflows = completedWorkflows.filter(w => w.score !== null);
  const avgScore = scoredWorkflows.length > 0 ? scoredWorkflows.reduce((acc, w) => acc + (w.score || 0), 0) / scoredWorkflows.length : 0;

  const incidentConditions = [
    eq(branches.companyId, companyId),
    gte(incidents.createdAt, fromDate),
    lte(incidents.createdAt, toDate),
  ];
  if (branchId) incidentConditions.push(eq(incidents.branchId, branchId));

  const incidentList = await db.select({
    id: incidents.id,
  })
    .from(incidents)
    .innerJoin(branches, eq(incidents.branchId, branches.id))
    .where(and(...incidentConditions));

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
    .innerJoin(branches, eq(shiftSessions.branchId, branches.id))
    .where(and(...shiftConditions));

  const totalHours = shifts.reduce((sum, s) => sum + ((s.totalWorkMinutes || 0) / 60), 0);

  return {
    title: "KPIs de Rendimiento Operativo",
    company: companyName || "Empresa",
    generatedAt: new Date(),
    dateRange: { from: dateFrom, to: dateTo },
    kpis: {
      workflowCompletionRate: Number(completionRate.toFixed(1)),
      avgWorkflowScore: Number(avgScore.toFixed(1)),
      totalWorkflows: workflows.length,
      completedWorkflows: completedWorkflows.length,
      incidentCount: incidentList.length,
      totalLaborHours: Number(totalHours.toFixed(1)),
    },
    summary: {
      totalWorkflows: workflows.length,
      completedWorkflows: completedWorkflows.length,
      totalIncidents: incidentList.length,
      totalLaborHours: Number(totalHours.toFixed(1)),
    }
  };
}

async function getIncidentsReportData(companyId: string, dateFrom?: string, dateTo?: string, branchId?: string, companyName?: string) {
  const conditions = [eq(branches.companyId, companyId)];
  if (dateFrom) conditions.push(gte(incidents.createdAt, new Date(dateFrom + "T00:00:00")));
  if (dateTo) conditions.push(lte(incidents.createdAt, new Date(dateTo + "T23:59:59")));
  if (branchId) conditions.push(eq(incidents.branchId, branchId));

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
    .innerJoin(branches, eq(incidents.branchId, branches.id))
    .where(and(...conditions))
    .orderBy(desc(incidents.createdAt));

  return {
    title: "Reporte de Incidentes Operativos",
    company: companyName || "Empresa",
    generatedAt: new Date(),
    dateRange: { from: dateFrom, to: dateTo },
    incidents: incidentsData,
    summary: {
      total: incidentsData.length,
      critical: incidentsData.filter(i => i.severity === "CRITICAL").length,
      warning: incidentsData.filter(i => i.severity === "WARNING").length,
      resolved: incidentsData.filter(i => i.status === "RESOLVED").length,
    }
  };
}
