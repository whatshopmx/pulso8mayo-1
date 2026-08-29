import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format as formatDate } from "date-fns";

async function testPdf() {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const reportData = {
    title: "Resumen de Workflows",
    company: "Grupo Restaurantero Demo",
    generatedAt: new Date(),
    dateRange: { from: "2026-08-01", to: "2026-08-29" },
    summary: {
      total: 10,
      completed: 8,
      inProgress: 2,
      avgScore: 94.5,
    },
    workflows: [
      { id: "wf-1", templateName: "Apertura de Cocina", assigneeName: "Carlos Pérez", branchName: "Polanco", status: "COMPLETED", score: 98, createdAt: new Date() },
      { id: "wf-2", templateName: "Recepción de Alimentos", assigneeName: "Ana Gómez", branchName: "Roma", status: "IN_PROGRESS", score: null, createdAt: new Date() },
    ]
  };

  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = 18;

  doc.setFillColor(220, 38, 38);
  doc.rect(14, yPos - 4, 3, 16, "F");

  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text(reportData.title, 20, yPos + 2);

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("PULSO HORECA · Plataforma de Control Operativo y Calidad", 20, yPos + 8);
  yPos += 18;

  const summaryEntries = Object.entries(reportData.summary).map(([k, v]) => [
    k.replace(/([A-Z])/g, " $1").replace(/^./, str => str.toUpperCase()),
    String(v)
  ]);

  autoTable(doc, {
    startY: yPos,
    margin: { left: 14, right: 14 },
    head: [["Métrica", "Valor"]],
    body: summaryEntries,
    theme: "plain",
    styles: { fontSize: 8, cellPadding: 2 },
  });

  yPos = (doc as any).lastAutoTable.finalY + 6;

  const head = [["ID", "Plantilla", "Responsable", "Sucursal", "Estado", "Puntos", "Fecha"]];
  const body = reportData.workflows.map((w: any) => [
    w.id,
    w.templateName,
    w.assigneeName,
    w.branchName,
    w.status,
    w.score !== null ? `${w.score}%` : "-",
    formatDate(w.createdAt, "dd/MM/yyyy")
  ]);

  autoTable(doc, {
    startY: yPos,
    margin: { left: 14, right: 14 },
    head,
    body,
  });

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  console.log("PDF generated successfully, size bytes:", pdfBuffer.length);
}

async function testExcel() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Reporte");
  sheet.columns = [
    { header: "ID", key: "id", width: 15 },
    { header: "Plantilla", key: "templateName", width: 25 },
  ];
  sheet.addRow({ id: "123", templateName: "Apertura" });
  const buffer = await workbook.xlsx.writeBuffer();
  console.log("Excel generated successfully, size bytes:", buffer.byteLength);
}

async function run() {
  await testPdf();
  await testExcel();
}

run().catch(console.error);
