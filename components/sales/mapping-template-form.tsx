"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Upload, CheckCircle2, AlertCircle, HelpCircle, FileText, Loader2 } from "lucide-react";
import {
  CANONICAL_FIELDS,
  CanonicalField,
  FIELD_LABELS,
  matchFieldAlias,
  normalizeHeader,
} from "@/lib/services/pos-column-aliases";

interface MappingTemplateFormProps {
  onSaved?: () => void;
  onCancel?: () => void;
}

interface ColumnDetectResult {
  header: string;
  mappedField: CanonicalField | "unmapped";
  confidence: "high" | "medium" | "none";
}

const POS_SYSTEM_SUGGESTIONS = [
  "Soft Restaurant",
  "Aloha POS",
  "Simphony (Oracle)",
  "Poster POS",
  "Square",
  "Aspel CAJA",
  "Eleventa",
  "SICAR",
  "Genérico / Personalizado",
];

export function MappingTemplateForm({ onSaved, onCancel }: MappingTemplateFormProps) {
  const [name, setName] = useState("");
  const [posSystem, setPosSystem] = useState("Soft Restaurant");
  const [isDefault, setIsDefault] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [detectedColumns, setDetectedColumns] = useState<ColumnDetectResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setLoading(true);

    try {
      const text = await file.text();
      // First line of CSV/Text or sample headers
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) {
        throw new Error("El archivo no contiene filas legibles.");
      }

      // Simple CSV header split (or fallback comma/tab split)
      const rawHeaders = lines[0]
        .split(/[,;\t]/)
        .map((h) => h.replace(/^["']|["']$/g, "").trim())
        .filter((h) => h.length > 0);

      if (rawHeaders.length === 0) {
        throw new Error("No se detectaron encabezados de columnas.");
      }

      setHeaders(rawHeaders);

      // Auto-detect mappings for each header
      const detected: ColumnDetectResult[] = rawHeaders.map((header) => {
        const match = matchFieldAlias(header);
        if (match.field) {
          return {
            header,
            mappedField: match.field,
            confidence: match.confidence === "high" ? "high" : "medium",
          };
        }
        return {
          header,
          mappedField: "unmapped",
          confidence: "none",
        };
      });

      setDetectedColumns(detected);
      if (!name) {
        setName(`Plantilla ${file.name.replace(/\.[^/.]+$/, "")}`);
      }
    } catch (err: any) {
      setError(err.message || "Error al procesar el archivo de muestra.");
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (index: number, newField: CanonicalField | "unmapped") => {
    setDetectedColumns((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              mappedField: newField,
              confidence: newField === "unmapped" ? "none" : "high",
            }
          : item
      )
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Ingresa un nombre para la plantilla.");
      return;
    }

    const mappingObj: Record<string, string> = {};
    detectedColumns.forEach((col) => {
      if (col.mappedField !== "unmapped") {
        mappingObj[col.mappedField] = col.header;
      }
    });

    if (Object.keys(mappingObj).length === 0) {
      setError("Debes mapear al menos una columna (ej. Venta total o Fecha).");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/sales/mapping-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          posSystem: posSystem || null,
          mapping: mappingObj,
          isDefault,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "No se pudo guardar la plantilla.");
      }

      if (onSaved) onSaved();
    } catch (err: any) {
      setError(err.message || "Error al guardar la plantilla.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl font-bold">Configurar Plantilla de Mapeo POS</CardTitle>
        <CardDescription>
          Mapea las columnas del archivo exportado por tu sistema de punto de venta (POS) a los campos canónicos de Pulso HORECA.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <div className="p-3 text-sm bg-destructive/10 text-destructive border border-destructive/20 rounded-md">
            {error}
          </div>
        )}

        {/* Step 1: Upload Sample File */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">1. Sube un archivo POS de muestra (.csv o .xlsx exportado)</Label>
          <div className="flex items-center gap-4">
            <label className="flex items-center justify-center gap-2 px-4 py-3 border border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors text-sm text-muted-foreground w-full">
              <Upload className="w-4 h-4 text-primary" />
              <span>{headers.length > 0 ? `Encabezados cargados (${headers.length} columnas)` : "Seleccionar archivo de muestra..."}</span>
              <input
                type="file"
                accept=".csv,.xlsx,.txt"
                className="hidden"
                onChange={handleFileUpload}
                disabled={loading}
              />
            </label>
          </div>
        </div>

        {/* Step 2: Metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">Nombre de la Plantilla</Label>
            <Input
              id="template-name"
              placeholder="ej. Soft Restaurant - Sucursal Condesa"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pos-system">Sistema POS</Label>
            <Select value={posSystem} onValueChange={setPosSystem}>
              <SelectTrigger id="pos-system">
                <SelectValue placeholder="Selecciona sistema POS" />
              </SelectTrigger>
              <SelectContent>
                {POS_SYSTEM_SUGGESTIONS.map((sys) => (
                  <SelectItem key={sys} value={sys}>
                    {sys}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Step 3: Column Mapping Table */}
        {detectedColumns.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">2. Mapeo de Columnas Detectadas</Label>
              <span className="text-xs text-muted-foreground">
                Las coincidencias sugeridas se muestran con insignias de confianza
              </span>
            </div>

            <div className="border rounded-md overflow-hidden divide-y text-sm">
              {detectedColumns.map((col, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-2 hover:bg-muted/30">
                  <div className="flex items-center gap-2 min-w-0 sm:w-1/2">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="font-mono text-xs truncate font-medium">{col.header}</span>
                    {col.confidence === "high" && (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1 text-[10px] py-0">
                        <CheckCircle2 className="w-3 h-3" /> Exacto
                      </Badge>
                    )}
                    {col.confidence === "medium" && (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1 text-[10px] py-0">
                        <AlertCircle className="w-3 h-3" /> Aproximado
                      </Badge>
                    )}
                    {col.confidence === "none" && (
                      <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200 gap-1 text-[10px] py-0">
                        <HelpCircle className="w-3 h-3" /> Sin asignar
                      </Badge>
                    )}
                  </div>

                  <div className="sm:w-1/2">
                    <Select
                      value={col.mappedField}
                      onValueChange={(val) => handleFieldChange(idx, val as CanonicalField | "unmapped")}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Seleccionar campo canónico..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unmapped">⚪ No mapear (Ignorar)</SelectItem>
                        {CANONICAL_FIELDS.map((field) => (
                          <SelectItem key={field} value={field}>
                            🟢 {FIELD_LABELS[field]} ({field})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t">
          {onCancel && (
            <Button variant="outline" type="button" onClick={onCancel} disabled={loading}>
              Cancelar
            </Button>
          )}
          <Button type="button" onClick={handleSave} disabled={loading || detectedColumns.length === 0}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Guardar Plantilla
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
