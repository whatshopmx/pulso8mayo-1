"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AccountingExport({ branchId }: { branchId?: string | null }) {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [version, setVersion] = useState("");
  const [downloading, setDownloading] = useState<"csv" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const downloadFile = async (format: "csv" | "pdf") => {
    setDownloading(format);
    setError(null);
    try {
      const qs = new URLSearchParams({
        year: String(year),
        month: String(month),
        format,
      });
      if (version.trim()) qs.set("version", version.trim());
      if (branchId) qs.set("branchId", branchId);

      const res = await fetch(`/api/finance/accounting/export?${qs.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "No se pudo descargar el expediente.");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const paddedMonth = String(month).padStart(2, "0");
      a.download = `expediente-cierre-${year}-${paddedMonth}${version.trim() ? `-v${version.trim()}` : ""}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Error de red al exportar el expediente del cierre.");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Download className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Exportar expediente del cierre</h2>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="fc19-year">
            Año
          </label>
          <input
            id="fc19-year"
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="block w-24 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="fc19-month">
            Mes
          </label>
          <select
            id="fc19-month"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="block rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, "0")}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="fc19-version">
            Versión (opcional)
          </label>
          <input
            id="fc19-version"
            type="number"
            min={1}
            placeholder="Activa / actual"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="block w-36 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={downloading !== null}
          onClick={() => void downloadFile("csv")}
        >
          <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
          {downloading === "csv" ? "Exportando CSV..." : "Descargar CSV"}
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={downloading !== null}
          onClick={() => void downloadFile("pdf")}
        >
          <FileText className="mr-1.5 h-3.5 w-3.5" />
          {downloading === "pdf" ? "Exportando PDF..." : "Descargar PDF"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
