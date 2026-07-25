import { useCallback } from "react";
import { toast } from "sonner";

interface CsvExportOptions {
  headers: string[];
  rows: (string | number)[][];
  filename: string;
  useBom?: boolean;
}

export function useExportCsv() {
  const exportToCsv = useCallback(({ headers, rows, filename, useBom = false }: CsvExportOptions) => {
    if (rows.length === 0) {
      toast.error("No hay datos para exportar");
      return;
    }

    const escapeCsv = (value: string | number): string => {
      const str = String(value);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\n");

    const blob = new Blob([useBom ? "\uFEFF" : "", csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast.success("Reporte exportado exitosamente");
  }, []);

  return { exportToCsv };
}
