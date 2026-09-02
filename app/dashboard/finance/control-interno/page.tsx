"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AuditLogTable, type AuditLogEntry } from "@/components/finance/audit-log-table";
import { ExcepcionesPanel, type Violation } from "@/components/finance/excepciones-panel";
import { ApprovalInbox } from "@/components/service-orders/approval-inbox";
import { ApprovalMatrixEditor } from "@/components/service-orders/approval-matrix-editor";
import { useBranch } from "@/lib/branch-context";
import { useSession } from "@/hooks/use-session";
import { useApprovalInbox } from "@/hooks/queries";
import { roleIsAtLeast } from "@/lib/permissions";
import { Shield, FileSearch, AlertTriangle, AlertCircle, RefreshCw, ClipboardCheck, SlidersHorizontal } from "lucide-react";

/** Tope de entradas solicitadas a la bitácora; se avisa cuando hay más. */
const AUDIT_LIMIT = 100;

export default function ControlInternoPage() {
  // Scope único: el control del header manda. Un segundo selector local hacía que
  // la página contestara sobre una sucursal distinta a la que el header anunciaba.
  const { selectedBranchId } = useBranch();
  const selectedBranch = selectedBranchId ?? "ALL";
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [violationsLoading, setViolationsLoading] = useState(true);
  const [violationsError, setViolationsError] = useState<string | null>(null);
  // Ventana de la detección de contratos recurrentes, tal como la declara el
  // servicio. No se fija en el cliente: si el servicio la cambia, la pantalla
  // no puede quedarse afirmando la anterior.
  const [contractWindowDays, setContractWindowDays] = useState<number | null>(null);
  /** Ventana de la detección de excepciones de gasto (A5.1), declarada por la ruta. */
  const [windowDays, setWindowDays] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("audit");

  // Bandeja OC/OS: el conteo alimenta el badge del tab; el contenido lo renderiza
  // <ApprovalInbox /> con la misma query de react-query (misma key → un solo fetch).
  const inbox = useApprovalInbox();
  const pendingApprovals = inbox.data?.total ?? 0;

  // La matriz solo se administra desde ADMIN+; el tab no existe para el resto.
  const { session } = useSession();
  const isAdmin = !!session?.user?.role && roleIsAtLeast(session.user.role, "ADMIN");

  const fetchAuditLog = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
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
      } else {
        // Una bitácora que no cargó no es una bitácora vacía. En una superficie
        // de cumplimiento las dos lecturas no pueden compartir render.
        setAuditError(json?.error || "El servidor no devolvió la bitácora de autorizaciones.");
        setAuditEntries([]);
        setAuditTotal(0);
      }
    } catch (err) {
      console.error("Error fetching audit log:", err);
      setAuditError("Error de conexión al cargar la bitácora. Revisa tu red e intenta de nuevo.");
      setAuditEntries([]);
      setAuditTotal(0);
    } finally {
      setAuditLoading(false);
    }
  }, [selectedBranch]);

  const fetchViolations = useCallback(async () => {
    setViolationsLoading(true);
    setViolationsError(null);
    try {
      const url = new URL("/api/finance/control-interno/excepciones", window.location.origin);
      if (selectedBranch !== "ALL") {
        url.searchParams.set("branchId", selectedBranch);
      }
      const res = await fetch(url.toString());
      const json = await res.json();
      if (res.ok && json.success) {
        setViolations(json.data?.violations || []);
        setContractWindowDays(
          typeof json.data?.contractVarianceWindowDays === "number"
            ? json.data.contractVarianceWindowDays
            : null
        );
        setWindowDays(typeof json.data?.windowDays === "number" ? json.data.windowDays : null);
      } else {
        // Sin esto, una conexión caída se rendía como "Sin excepciones detectadas /
        // Todos los gastos cumplen": una afirmación de cumplimiento inventada.
        setViolationsError(json?.error || "El servidor no devolvió el análisis de excepciones.");
        setViolations([]);
      }
    } catch (err) {
      console.error("Error fetching violations:", err);
      setViolationsError(
        "Error de conexión al analizar las excepciones. Revisa tu red e intenta de nuevo."
      );
      setViolations([]);
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
              // El tono distingue crítico de sólo-advertencia; el texto accesible
              // lo dice también, porque el color por sí solo no es un estado.
              <span
                className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${
                  highCount > 0
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-warning text-warning-foreground"
                }`}
              >
                {violationCount}
                <span className="sr-only">
                  {highCount > 0
                    ? ` excepciones, ${highCount} de severidad crítica`
                    : " excepciones, ninguna crítica"}
                </span>
              </span>
            )}
          </TabsTrigger>
          {/* Bandeja OC/OS (R4): scoping por rol/sucursal lo aplica el API. */}
          <TabsTrigger value="autorizaciones" className="gap-1.5">
            <ClipboardCheck className="w-3.5 h-3.5" />
            Autorizaciones
            {pendingApprovals > 0 && (
              <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full text-xs font-bold bg-primary text-primary-foreground">
                {pendingApprovals}
                <span className="sr-only"> autorizaciones pendientes en tu turno</span>
              </span>
            )}
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="matriz" className="gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Matriz de Autorización
            </TabsTrigger>
          )}
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
              {!auditLoading && auditError ? (
                <EmptyState
                  icon={AlertCircle}
                  title="No se pudo cargar la bitácora"
                  description={auditError}
                  action={
                    <Button variant="outline" size="sm" onClick={fetchAuditLog}>
                      <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
                    </Button>
                  }
                />
              ) : (
                <>
                  <AuditLogTable entries={auditEntries} loading={auditLoading} />
                  {/* Un corte silencioso es peor que una página lenta en una
                      superficie de cumplimiento: se declara lo que no se ve. */}
                  {!auditLoading && auditTotal > auditEntries.length && (
                    <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                      Mostrando las {auditEntries.length} entradas más recientes de {auditTotal} totales.
                      Filtra por sucursal desde el control del encabezado para acotar el rango.
                    </p>
                  )}
                </>
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
                Anomalías en la cadena de autorización —auto-aprobaciones, gastos sin aprobar por más de 48h, aprobadores sin el rol requerido— más las desviaciones de facturas contra sus contratos recurrentes y los faltantes repetidos de arqueo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!violationsLoading && violationsError ? (
                <EmptyState
                  icon={AlertCircle}
                  title="No se pudo analizar el cumplimiento"
                  description={violationsError}
                  action={
                    <Button variant="outline" size="sm" onClick={fetchViolations}>
                      <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
                    </Button>
                  }
                />
              ) : (
                <ExcepcionesPanel
                  violations={violations}
                  loading={violationsLoading}
                  contractWindowDays={contractWindowDays}
                  windowDays={windowDays}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="autorizaciones">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4" />
                Órdenes que requieren tu autorización
              </CardTitle>
              <CardDescription className="text-xs">
                OC y OS en tu nivel de turno según la matriz de autorización: monto, presupuesto restante y resolución con motivo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ApprovalInbox />
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="matriz">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4" />
                  Matriz de Autorización
                </CardTitle>
                <CardDescription className="text-xs">
                  Define qué rol aprueba cada rango de monto, cuántas cotizaciones exige y los niveles secuenciales para OC y OS.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ApprovalMatrixEditor />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
