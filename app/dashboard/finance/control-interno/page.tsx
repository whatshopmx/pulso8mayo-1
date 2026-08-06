"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AuditLogTable, type AuditLogEntry } from "@/components/finance/audit-log-table";
import { ExcepcionesPanel, type Violation } from "@/components/finance/excepciones-panel";
import { useBranches } from "@/hooks/use-branches";
import { Shield, FileSearch, AlertTriangle } from "lucide-react";

/** Tope de entradas solicitadas a la bitácora; se avisa cuando hay más. */
const AUDIT_LIMIT = 100;

export default function ControlInternoPage() {
  const { branches, loading: branchesLoading } = useBranches();
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(true);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [violationsLoading, setViolationsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("audit");

  const fetchAuditLog = useCallback(async () => {
    setAuditLoading(true);
    try {
      const url = new URL("/api/finance/control-interno/audit-log", window.location.origin);
      if (selectedBranch !== "ALL") {
        url.searchParams.set("branchId", selectedBranch);
      }
      url.searchParams.set("limit", String(AUDIT_LIMIT));
      const res = await fetch(url.toString());
      const json = await res.json();
      if (res.ok && json.success) {
        setAuditEntries(json.data?.entries || []);
        setAuditTotal(json.data?.total ?? 0);
      }
    } catch (err) {
      console.error("Error fetching audit log:", err);
    } finally {
      setAuditLoading(false);
    }
  }, [selectedBranch]);

  const fetchViolations = useCallback(async () => {
    setViolationsLoading(true);
    try {
      const url = new URL("/api/finance/control-interno/excepciones", window.location.origin);
      if (selectedBranch !== "ALL") {
        url.searchParams.set("branchId", selectedBranch);
      }
      const res = await fetch(url.toString());
      const json = await res.json();
      if (res.ok && json.success) {
        setViolations(json.data?.violations || []);
      }
    } catch (err) {
      console.error("Error fetching violations:", err);
    } finally {
      setViolationsLoading(false);
    }
  }, [selectedBranch]);

  // Ambas cargas dependen del filtro de sucursal, no de la pestaña activa: el
  // badge de excepciones existe para avisar de lo que aún no se ha abierto, así
  // que no puede esperar a que se abra la pestaña que anuncia.
  useEffect(() => {
    fetchAuditLog();
  }, [fetchAuditLog]);

  useEffect(() => {
    fetchViolations();
  }, [fetchViolations]);

  const violationCount = violations.length;
  const highCount = violations.filter((v) => v.severity === "HIGH").length;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-7 w-7 text-primary" /> Control Interno
          </h1>
          <p className="text-sm text-muted-foreground">
            Bitácora de autorizaciones, doble control y detección de excepciones en gastos operativos.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-48">
            <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={branchesLoading}>
              <SelectTrigger>
                <SelectValue placeholder="Todas las sucursales" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas las sucursales</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="audit" className="gap-1.5">
            <FileSearch className="w-3.5 h-3.5" />
            Bitácora de Autorizaciones
          </TabsTrigger>
          <TabsTrigger value="excepciones" className="gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Excepciones
            {violationCount > 0 && (
              <span
                className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                  highCount > 0
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-warning text-warning-foreground"
                }`}
              >
                {violationCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <FileSearch className="w-4 h-4" />
                Bitácora de Autorizaciones
              </CardTitle>
              <CardDescription className="text-xs">
                Registro cronológico de todas las acciones sobre gastos operativos: creación, aprobación, rechazo y pago.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AuditLogTable entries={auditEntries} loading={auditLoading} />
              {/* Un corte silencioso es peor que una página lenta en una
                  superficie de cumplimiento: se declara lo que no se ve. */}
              {!auditLoading && auditTotal > auditEntries.length && (
                <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                  Mostrando las {auditEntries.length} entradas más recientes de {auditTotal} totales.
                  Filtra por sucursal para acotar el rango.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="excepciones">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Excepciones Detectadas
              </CardTitle>
              <CardDescription className="text-xs">
                Anomalías en la cadena de autorización: auto-aprobaciones, gastos sin aprobar por más de 48h, y aprobadores sin el rol requerido.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ExcepcionesPanel violations={violations} loading={violationsLoading} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
