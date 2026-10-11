"use client";

/**
 * useShiftExport Hook
 * Handles export of shift data to CSV, Excel, and PDF formats
 */

import { useState, useCallback } from "react";
import { Shift, ShiftExportData } from "@/lib/types";
import { format } from "date-fns";

export type ExportFormat = "csv" | "excel" | "pdf";

export interface ExportOptions {
  filename?: string;
  includeHeaders?: boolean;
}

export interface UseShiftExportReturn {
  exportToCSV: (shifts: Shift[], options?: ExportOptions) => void;
  exportToExcel: (shifts: Shift[], options?: ExportOptions) => void;
  exportToPDF: (shifts: Shift[], options?: ExportOptions) => void;
  isExporting: boolean;
  lastExport: { format: ExportFormat; count: number } | null;
}

/** Serializa sólo los turnos autorizados que entrega la vista del planificador. */
export function buildShiftCsv(shifts: Shift[], includeHeaders = true): string {
  if (shifts.length === 0) throw new Error("No hay turnos para exportar");

  const cell = (value: string | undefined) => {
    let text = value ?? "";
    // Las hojas de cálculo interpretan estos prefijos incluso entre comillas.
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = shifts.map((shift) => [
    shift.userName, shift.branchName, shift.role, shift.shiftDate,
    shift.startTime, shift.endTime, shift.status, shift.notes,
  ].map(cell).join(","));
  if (includeHeaders) {
    rows.unshift("Empleado,Sucursal,Rol,Fecha,Hora Inicio,Hora Fin,Estado,Notas");
  }
  return `\uFEFF${rows.join("\r\n")}`;
}

export function useShiftExport(): UseShiftExportReturn {
  const [isExporting, setIsExporting] = useState(false);
  const [lastExport, setLastExport] = useState<{ format: ExportFormat; count: number } | null>(null);

  const convertToExportData = (shifts: Shift[]): ShiftExportData[] => {
    return shifts.map((shift) => ({
      employee: shift.userName,
      role: shift.role,
      date: shift.shiftDate,
      startTime: shift.startTime,
      endTime: shift.endTime,
      status: shift.status,
      notes: shift.notes || "",
    }));
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    try {
      document.body.appendChild(link);
      link.click();
    } finally {
      link.remove();
      URL.revokeObjectURL(url);
    }
  };

  const exportToCSV = useCallback(
    (shifts: Shift[], options: ExportOptions = {}) => {
      setIsExporting(true);
      try {
        const { filename = `turnos_${format(new Date(), "yyyy-MM-dd")}.csv`, includeHeaders = true } = options;
        downloadFile(buildShiftCsv(shifts, includeHeaders), filename, "text/csv;charset=utf-8;");
        setLastExport({ format: "csv", count: shifts.length });
      } finally {
        setIsExporting(false);
      }
    },
    []
  );

  const exportToExcel = useCallback(
    (shifts: Shift[], options: ExportOptions = {}) => {
      setIsExporting(true);
      try {
        const data = convertToExportData(shifts);
        const { filename = `turnos_${format(new Date(), "yyyy-MM-dd")}.xlsx` } = options;

        // For Excel, we'll create a simple HTML table that Excel can open
        const headers = ["Empleado", "Rol", "Fecha", "Hora Inicio", "Hora Fin", "Estado", "Notas"];

        const html = `
          <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/1999/xhtml">
          <head>
            <meta charset="UTF-8">
            <style>
              table { border-collapse: collapse; }
              th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
              th { background-color: #f0f0f0; font-weight: bold; }
            </style>
          </head>
          <body>
            <table>
              <thead>
                <tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>
              </thead>
              <tbody>
                ${data
                  .map(
                    (row) => `
                  <tr>
                    <td>${row.employee}</td>
                    <td>${row.role}</td>
                    <td>${row.date}</td>
                    <td>${row.startTime}</td>
                    <td>${row.endTime}</td>
                    <td>${row.status}</td>
                    <td>${row.notes || ""}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </body>
          </html>
        `;

        downloadFile(html, filename, "application/vnd.ms-excel");
        setLastExport({ format: "excel", count: shifts.length });
      } finally {
        setIsExporting(false);
      }
    },
    []
  );

  const exportToPDF = useCallback(
    (shifts: Shift[], options: ExportOptions = {}) => {
      setIsExporting(true);
      try {
        // For PDF, we'll open a print dialog with formatted HTML
        const data = convertToExportData(shifts);
        const { filename = `turnos_${format(new Date(), "yyyy-MM-dd")}` } = options;

        const printWindow = window.open("", "_blank");
        if (!printWindow) {
          console.error("Failed to open print window");
          return;
        }

        const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>${filename}</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 20px; }
              h1 { color: #333; }
              table { width: 100%; border-collapse: collapse; margin-top: 20px; }
              th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
              th { background-color: #4a5568; color: white; }
              tr:nth-child(even) { background-color: #f9f9f9; }
              .header { margin-bottom: 20px; }
              .date { color: #666; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>Reporte de Turnos</h1>
              <p class="date">Generado: ${format(new Date(), "dd/MM/yyyy HH:mm")}</p>
              <p>Total de turnos: ${shifts.length}</p>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Rol</th>
                  <th>Fecha</th>
                  <th>Hora Inicio</th>
                  <th>Hora Fin</th>
                  <th>Estado</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                ${data
                  .map(
                    (row) => `
                  <tr>
                    <td>${row.employee}</td>
                    <td>${row.role}</td>
                    <td>${row.date}</td>
                    <td>${row.startTime}</td>
                    <td>${row.endTime}</td>
                    <td>${row.status}</td>
                    <td>${row.notes || "-"}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
            <script>
              window.onload = function() {
                window.print();
              };
            </script>
          </body>
          </html>
        `;

        printWindow.document.write(html);
        printWindow.document.close();
        setLastExport({ format: "pdf", count: shifts.length });
      } finally {
        setIsExporting(false);
      }
    },
    []
  );

  return {
    exportToCSV,
    exportToExcel,
    exportToPDF,
    isExporting,
    lastExport,
  };
}
