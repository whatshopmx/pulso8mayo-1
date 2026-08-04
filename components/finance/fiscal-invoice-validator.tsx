"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, FileCheck, AlertCircle, Loader2, XCircle } from "lucide-react";

interface ValidationResult {
  uuid: string;
  isValid: boolean;
  status: "VIGENTE" | "CANCELADO" | "NO_ENCONTRADO" | "ERROR";
  emisorNombre: string;
  emisorRfc: string;
  receptorRfc: string;
  total: number;
  fechaEmision: string;
  fechaCertificacion: string;
}

export function FiscalInvoiceValidator() {
  const [form, setForm] = useState({
    emisorRfc: "",
    receptorRfc: "",
    uuid: "",
    totalCents: 0,
    fechaEmision: "",
  });
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({
      ...prev,
      [field]: field === "totalCents" ? Math.round(parseFloat(value || "0") * 100) : value,
    }));
    setResult(null);
    setError(null);
  };

  const handleValidate = async () => {
    setValidating(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/finance/fiscal/validate-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setResult(json.data);
      } else {
        setError(json?.error || "Error al validar la factura. Verifica los datos e intenta de nuevo.");
      }
    } catch (err) {
      console.error("Invoice validation error:", err);
      setError("Error de conexión al validar la factura.");
    } finally {
      setValidating(false);
    }
  };

  const statusBadge = result
    ? result.status === "VIGENTE"
      ? <Badge className="bg-emerald-100 text-emerald-700 gap-1"><FileCheck className="w-3 h-3" /> Vigente</Badge>
      : result.status === "CANCELADO"
      ? <Badge className="bg-red-100 text-red-700 gap-1"><XCircle className="w-3 h-3" /> Cancelado</Badge>
      : <Badge className="bg-amber-100 text-amber-700 gap-1"><AlertCircle className="w-3 h-3" /> {result.status}</Badge>
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-bold flex items-center gap-2">
          <Search className="w-4 h-4" />
          Validar Factura (CFDI)
        </CardTitle>
        <CardDescription className="text-xs">
          Verifica el estatus de una factura electrónica ante el SAT. Requiere FiscalAPI configurado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">RFC Emisor</Label>
            <Input
              className="h-8 text-xs"
              placeholder="Ej: ABC123456789"
              value={form.emisorRfc}
              onChange={(e) => handleChange("emisorRfc", e.target.value.toUpperCase())}
              maxLength={13}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">RFC Receptor</Label>
            <Input
              className="h-8 text-xs"
              placeholder="RFC de tu empresa"
              value={form.receptorRfc}
              onChange={(e) => handleChange("receptorRfc", e.target.value.toUpperCase())}
              maxLength={13}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs">UUID de la Factura</Label>
            <Input
              className="h-8 text-xs font-mono"
              placeholder="00000000-0000-0000-0000-000000000000"
              value={form.uuid}
              onChange={(e) => handleChange("uuid", e.target.value)}
              maxLength={36}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Total ($ MXN)</Label>
            <Input
              className="h-8 text-xs"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              onChange={(e) => handleChange("totalCents", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Fecha de Emisión</Label>
            <Input
              className="h-8 text-xs"
              type="date"
              value={form.fechaEmision}
              onChange={(e) => handleChange("fechaEmision", e.target.value)}
            />
          </div>
        </div>

        <Button
          onClick={handleValidate}
          disabled={validating || !form.uuid || !form.emisorRfc || !form.receptorRfc}
          className="w-full"
          size="sm"
        >
          {validating ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Search className="w-4 h-4 mr-2" />
          )}
          {validating ? "Validando..." : "Validar Factura"}
        </Button>

        {error && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <div className="border rounded-md p-3 space-y-2 bg-muted/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Resultado</span>
              {statusBadge}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Emisor: </span>
                <span className="font-medium">{result.emisorNombre || result.emisorRfc}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Total: </span>
                <span className="font-medium">${result.total?.toLocaleString("es-MX")}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Emisión: </span>
                <span>{new Date(result.fechaEmision).toLocaleDateString("es-MX")}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Certificación: </span>
                <span>{result.fechaCertificacion ? new Date(result.fechaCertificacion).toLocaleDateString("es-MX") : "—"}</span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
