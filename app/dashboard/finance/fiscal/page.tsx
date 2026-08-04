"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FiscalInvoiceValidator } from "@/components/finance/fiscal-invoice-validator";
import { Receipt, FileText, AlertCircle, Loader2, CheckCircle } from "lucide-react";

interface TimbradoResult {
  uuid: string;
  status: string;
  cadenaOriginal: string;
  selloDigital: string;
  fechaTimbrado: string;
}

export default function FiscalPage() {
  const [nominaForm, setNominaForm] = useState({
    empleadoRfc: "",
    empleadoNombre: "",
    empleadoCurp: "",
    periodo: "",
    totalPercepciones: 0,
    totalDeducciones: 0,
  });
  const [timbrando, setTimbrando] = useState(false);
  const [timbradoResult, setTimbradoResult] = useState<TimbradoResult | null>(null);
  const [timbradoError, setTimbradoError] = useState<string | null>(null);

  const handleNominaChange = (field: string, value: string) => {
    setNominaForm((prev) => ({
      ...prev,
      [field]:
        field === "totalPercepciones" || field === "totalDeducciones"
          ? Math.round(parseFloat(value || "0") * 100)
          : value,
    }));
    setTimbradoResult(null);
    setTimbradoError(null);
  };

  const handleTimbrar = async () => {
    setTimbrando(true);
    setTimbradoError(null);
    setTimbradoResult(null);
    try {
      const res = await fetch("/api/finance/fiscal/timbrar-nomina", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nominaForm),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setTimbradoResult(json.data);
      } else {
        setTimbradoError(json?.error || "Error al timbrar la nómina.");
      }
    } catch (err) {
      console.error("Timbrar nomina error:", err);
      setTimbradoError("Error de conexión al timbrar la nómina.");
    } finally {
      setTimbrando(false);
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Receipt className="h-7 w-7 text-primary" /> Fiscal y Facturación
        </h1>
        <p className="text-sm text-muted-foreground">
          Validación de facturas CFDI ante el SAT y timbrado de nómina vía FiscalAPI.
        </p>
      </div>

      <Tabs defaultValue="validar" className="space-y-4">
        <TabsList>
          <TabsTrigger value="validar" className="gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Validar Factura
          </TabsTrigger>
          <TabsTrigger value="nomina" className="gap-1.5">
            <Receipt className="w-3.5 h-3.5" />
            Timbrado Nómina
          </TabsTrigger>
        </TabsList>

        <TabsContent value="validar">
          <FiscalInvoiceValidator />
        </TabsContent>

        <TabsContent value="nomina">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Receipt className="w-4 h-4" />
                Timbrar CFDI de Nómina
              </CardTitle>
              <CardDescription className="text-xs">
                Genera el timbrado fiscal de un comprobante de nómina. Requiere FiscalAPI configurado.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">RFC del Empleado</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="Ej: XAXX010101000"
                    value={nominaForm.empleadoRfc}
                    onChange={(e) => handleNominaChange("empleadoRfc", e.target.value.toUpperCase())}
                    maxLength={13}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Nombre del Empleado</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="Nombre completo"
                    value={nominaForm.empleadoNombre}
                    onChange={(e) => handleNominaChange("empleadoNombre", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">CURP (opcional)</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="CURP"
                    value={nominaForm.empleadoCurp}
                    onChange={(e) => handleNominaChange("empleadoCurp", e.target.value.toUpperCase())}
                    maxLength={18}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Período</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="2025-01"
                    value={nominaForm.periodo}
                    onChange={(e) => handleNominaChange("periodo", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Total Percepciones ($ MXN)</Label>
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    onChange={(e) => handleNominaChange("totalPercepciones", e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Total Deducciones ($ MXN)</Label>
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    onChange={(e) => handleNominaChange("totalDeducciones", e.target.value)}
                  />
                </div>
              </div>

              <Button
                onClick={handleTimbrar}
                disabled={timbrando || !nominaForm.empleadoRfc || !nominaForm.empleadoNombre || !nominaForm.periodo || nominaForm.totalPercepciones <= 0}
                className="w-full"
                size="sm"
              >
                {timbrando ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Receipt className="w-4 h-4 mr-2" />
                )}
                {timbrando ? "Timbrando..." : "Timbrar Nómina"}
              </Button>

              {timbradoError && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {timbradoError}
                </div>
              )}

              {timbradoResult && (
                <div className="border rounded-md p-4 space-y-3 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Timbrado exitoso</span>
                    <Badge className="bg-emerald-100 text-emerald-700 gap-1">
                      <CheckCircle className="w-3 h-3" /> TIMBRADO
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">UUID: </span>
                      <span className="font-mono font-medium">{timbradoResult.uuid}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Fecha de Timbrado: </span>
                      <span>{new Date(timbradoResult.fechaTimbrado).toLocaleString("es-MX")}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cadena Original: </span>
                      <span className="font-mono text-[10px] break-all">{timbradoResult.cadenaOriginal || "—"}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
