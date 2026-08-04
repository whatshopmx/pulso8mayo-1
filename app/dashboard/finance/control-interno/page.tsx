"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AuditLogTable } from "@/components/finance/audit-log-table";
import { ExcepcionesPanel } from "@/components/finance/excepciones-panel";
import { Shield, FileSearch, AlertTriangle } from "lucide-react";

interface Branch {
  id: string;
  name: string;
}

export default function ControlInternoPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [auditEntries, setAuditEntries] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [violations, setViolations] = useState<any[]>([]);
  const [violationsLoading, setViolationsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("audit");

  useEffect(() => {
    async function fetchBranches() {
      try {
        const res = await fetch("/api/branches");
        const data = await res.json();
        const list = data.data || data.branches || (Array.isArray(data) ? data : []);
        setBranches(list);
      } catch (err) {
        console.error("Error fetching branches:", err);
      }
    }
    fetchBranches();
  }, []);

  const fetchAuditLog = useCallback(async () => {
    setAuditLoading(true);
    try {
      const url = new URL("/api/finance/control-interno/audit-log", window.location.origin);
      if (selectedBranch !== "ALL") {
        url.searchParams.set("branchId", selectedBranch);
      }
      url.searchParams.set("limit", "100");
      const res = await fetch(url.toString());
      const json = await res.json();
      if (res.ok && json.success) {
        setAuditEntries(json.data?.entries || []);
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
  }, []);

  useEffect(() => {
    if (activeTab === "audit") {
      fetchAuditLog();
    } else {
      fetchViolations();
    }
  }, [activeTab, fetchAuditLog, fetchViolations]);

  const violationCount = violations.length;
  const highCount = violations.filter((v: any) => v.severity === "HIGH").length;

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
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
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
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${highCount > 0 ? "bg-red-500 text-white" : "bg-amber-500 text-white"}`}>
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
