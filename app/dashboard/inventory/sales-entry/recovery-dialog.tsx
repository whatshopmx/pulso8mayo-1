"use client";

import { useState, useEffect, useCallback } from "react";
import { RecoveryCreateForm } from "./recovery-create-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileCheck2,
  ShieldCheck,
  XCircle,
  ArrowRight,
} from "lucide-react";

interface EvidenceSummary {
  id: string;
  attestationId: string;
  purpose: string;
  verifiedBy: string;
  verifiedRole: string;
  verifiedAt: string;
}

interface ProposalData {
  id: string;
  companyId: string;
  branchId: string;
  legacySaleId: string;
  requestedBy: string;
  reason: string;
  createdAt: string;
  proposalHash: string;
  stateHash: string;
  identity?: {
    source?: string;
    productKey?: string;
    saleDay?: string;
  };
  legacy?: {
    recipeId?: string;
    saleDay?: string;
    quantitySold?: string;
    totalRevenueCents?: number | null;
  };
  demand?: Array<{
    itemId: string;
    quantity: string;
    unit: string;
  }>;
  evidenceSummary?: EvidenceSummary[];
}

interface DecisionData {
  id: string;
  decision: "APPROVED" | "REJECTED";
  decidedBy: string;
  approverRole: string;
  decidedAt: string;
}

interface ProposalReviewResponse {
  proposal: ProposalData;
  decision: DecisionData | null;
  canDecide: boolean;
}

interface ApplyResult {
  applied: boolean;
  alreadyApplied?: boolean;
  revisionId?: string;
  revisionNumber?: number;
  movementsCount?: number;
  message?: string;
}

export function RecoveryDialog({
  open,
  onOpenChange,
  branchId,
  initialProposalId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  initialProposalId?: string | null;
  onSuccess?: () => void;
}) {
  const [proposalIdInput, setProposalIdInput] = useState(initialProposalId ?? "");
  const [activeProposalId, setActiveProposalId] = useState<string | null>(initialProposalId ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ProposalReviewResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [createPending, setCreatePending] = useState(false);

  // Estados de decisión
  const [deciding, setDeciding] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState<"APPROVED" | "REJECTED">("APPROVED");

  // Estados de aplicación auditada AUD-02
  const [applying, setApplying] = useState(false);
  const [auditReason, setAuditReason] = useState("");
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

  useEffect(() => {
    if (initialProposalId) {
      setProposalIdInput(initialProposalId);
      setActiveProposalId(initialProposalId);
    }
  }, [initialProposalId]);

  const fetchProposal = useCallback(async (pId: string) => {
    if (!branchId || !pId) return;
    setLoading(true);
    setError(null);
    setApplyResult(null);
    try {
      const res = await fetch(
        `/api/inventory/sales-entry/recovery-proposals?branchId=${encodeURIComponent(
          branchId
        )}&proposalId=${encodeURIComponent(pId)}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudo cargar el expediente");
      }
      setReview(data.data);
      setActiveProposalId(pId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al consultar expediente");
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    if (open && activeProposalId) {
      fetchProposal(activeProposalId);
    }
    if (!open) {
      setError(null);
      setApplyResult(null);
    }
  }, [open, activeProposalId, fetchProposal]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = proposalIdInput.trim();
    if (clean) {
      fetchProposal(clean);
    }
  };

  const handleRecordDecision = async () => {
    if (!branchId || !activeProposalId || !review) return;
    setDeciding(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/sales-entry/recovery-decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          proposalId: activeProposalId,
          decision: selectedDecision,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "No se pudo registrar la decisión");
      }
      await fetchProposal(activeProposalId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar la decisión");
    } finally {
      setDeciding(false);
    }
  };

  const handleApplyRecovery = async () => {
    if (!branchId || !activeProposalId || !auditReason || auditReason.trim().length < 4) {
      setError("El motivo de auditoría AUD-02 debe tener al menos 4 caracteres.");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/sales-entry/recovery-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          proposalId: activeProposalId,
          reason: auditReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al aplicar recuperación histórica");
      }
      setApplyResult(data.data);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al ejecutar la aplicación");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!createPending) onOpenChange(nextOpen);
    }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Recuperación Histórica de Ventas e Inventario
          </DialogTitle>
          <DialogDescription>
            Resolución auditada (AUD-02) de ventas huérfanas legadas con segregación de funciones.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Button type="button" variant="outline" disabled={loading || deciding || applying || createPending}
            onClick={() => setCreating(!creating)}>
            {creating ? "Consultar expediente existente" : "Crear expediente"}
          </Button>
          {creating ? <RecoveryCreateForm branchId={branchId} onPendingChange={setCreatePending} onCreated={(id) => {
            setProposalIdInput(id);
            setReview(null);
            setAuditReason("");
            setApplyResult(null);
            setError(null);
            setCreating(false);
            setActiveProposalId(id);
          }} /> : <>
          {/* Selector / Búsqueda de expediente si no está fijo */}
          <form onSubmit={handleSearch} className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="rec-prop-id" className="text-xs">
                ID del Expediente (UUID)
              </Label>
              <Input
                id="rec-prop-id"
                placeholder="00000000-0000-0000-0000-000000000000"
                value={proposalIdInput}
                onChange={(e) => setProposalIdInput(e.target.value)}
                disabled={loading || deciding || applying}
                className="font-mono text-xs"
              />
            </div>
            <Button type="submit" variant="secondary" disabled={loading || !proposalIdInput.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Consultar"}
            </Button>
          </form>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Cargando expediente y estado documental…
            </div>
          )}

          {review && !loading && (
            <div className="space-y-4">
              {/* Tarjeta de detalles del expediente */}
              <div className="rounded-md border p-3 text-sm space-y-3 bg-muted/30">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="font-medium text-xs text-muted-foreground">Expediente ID</span>
                  <span className="font-mono text-xs">{review.proposal.id}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Solicitado por:</span>
                    <p className="font-mono truncate">{review.proposal.requestedBy}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Fecha registro:</span>
                    <p>{new Date(review.proposal.createdAt).toLocaleString("es-MX")}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Motivo inicial:</span>
                    <p className="font-normal">{review.proposal.reason}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1 border-t text-xs">
                  <Badge variant="outline" className="font-mono text-xs">
                    Propuesta: {review.proposal.proposalHash.slice(0, 12)}…
                  </Badge>
                  <Badge variant="outline" className="font-mono text-xs">
                    Estado: {review.proposal.stateHash.slice(0, 12)}…
                  </Badge>
                </div>
              </div>

              {/* Fuentes y Atestaciones */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Evidencias Atestiguadas
                </Label>
                <div className="grid gap-2">
                  {(review.proposal.evidenceSummary ?? []).map((proof) => (
                    <div
                      key={proof.id}
                      className="flex items-center justify-between rounded border px-3 py-1.5 text-xs bg-background"
                    >
                      <div className="flex items-center gap-2">
                        <FileCheck2 className="h-4 w-4 text-primary" />
                        <div>
                          <span className="font-semibold">{proof.purpose}</span>
                          <span className="text-muted-foreground ml-2">por {proof.verifiedBy}</span>
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {proof.verifiedRole}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              {/* Demanda calculada de ingredientes */}
              {review.proposal.demand && review.proposal.demand.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Demanda de Inventario Calculada
                  </Label>
                  <div className="rounded border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1 text-left">Artículo</th>
                          <th className="px-3 py-1 text-right">Cantidad</th>
                          <th className="px-3 py-1 text-left">Unidad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {review.proposal.demand.map((item, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="px-3 py-1 font-mono text-xs truncate max-w-[200px]">
                              {item.itemId}
                            </td>
                            <td className="px-3 py-1 text-right tabular-nums">{item.quantity}</td>
                            <td className="px-3 py-1">{item.unit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Sección de Decisión Administrativa */}
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Decisión Administrativa</span>
                  {review.decision ? (
                    <Badge
                      variant={review.decision.decision === "APPROVED" ? "default" : "destructive"}
                      className="flex items-center gap-1"
                    >
                      {review.decision.decision === "APPROVED" ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <XCircle className="h-3 w-3" />
                      )}
                      {review.decision.decision === "APPROVED" ? "Aprobado" : "Rechazado"}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Pendiente de Decisión</Badge>
                  )}
                </div>

                {review.decision ? (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>
                      Decidido por: <span className="font-mono">{review.decision.decidedBy}</span> (
                      {review.decision.approverRole})
                    </p>
                    <p>Fecha: {new Date(review.decision.decidedAt).toLocaleString("es-MX")}</p>
                  </div>
                ) : review.canDecide ? (
                  <div className="space-y-3 pt-2">
                    <p className="text-xs text-muted-foreground">
                      Como administrador independiente al solicitante, emite la resolución
                      formal sobre este expediente:
                    </p>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="radio"
                          name="decision-choice"
                          checked={selectedDecision === "APPROVED"}
                          onChange={() => setSelectedDecision("APPROVED")}
                          className="h-3.5 w-3.5"
                        />
                        Aprobar para aplicación
                      </label>
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="radio"
                          name="decision-choice"
                          checked={selectedDecision === "REJECTED"}
                          onChange={() => setSelectedDecision("REJECTED")}
                          className="h-3.5 w-3.5"
                        />
                        Rechazar expediente
                      </label>
                    </div>
                    <Button
                      size="sm"
                      onClick={handleRecordDecision}
                      disabled={deciding}
                      className="w-full sm:w-auto"
                    >
                      {deciding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Registrar Decisión
                    </Button>
                  </div>
                ) : (
                  <Alert className="py-2 text-xs">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    <AlertDescription>
                      Segregación de funciones: El usuario que solicitó la propuesta no puede
                      aprobarla. Se requiere la revisión de otro administrador o superadmin.
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              {/* Sección de Aplicación Auditada AUD-02 */}
              {review.decision?.decision === "APPROVED" && (
                <div className="rounded-md border p-3 space-y-3 bg-muted/10">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">Aplicación Auditada (AUD-02)</span>
                    <Badge variant="outline" className="border-primary text-primary">
                      Listo para aplicar
                    </Badge>
                  </div>

                  {!applyResult ? (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        La aplicación descontará los lotes por FEFO, registrará los movimientos
                        físicos con prefijo <code className="font-mono">salecons:</code> y creará la
                        Revisión 1 para desbloquear ventas ordinarias.
                      </p>
                      <div className="space-y-1">
                        <Label htmlFor="audit-reason" className="text-xs">
                          Motivo de Auditoría AUD-02 *
                        </Label>
                        <Input
                          id="audit-reason"
                          placeholder="Ej. Conciliación física y documental de venta legada corte 001"
                          value={auditReason}
                          onChange={(e) => setAuditReason(e.target.value)}
                          disabled={applying}
                          className="text-xs"
                        />
                        <p className="text-xs text-muted-foreground">
                          Mínimo 4 caracteres. Quedará registrado en bitácora inmutable.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={handleApplyRecovery}
                        disabled={applying || auditReason.trim().length < 4}
                        className="w-full"
                      >
                        {applying ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Aplicando consumo y audit log…
                          </>
                        ) : (
                          <>
                            <ArrowRight className="mr-2 h-4 w-4" />
                            Aplicar Consumo e Inventario
                          </>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <Alert className="border-success/50 bg-success/10 text-success-foreground py-2">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <AlertDescription className="text-xs space-y-1">
                        <p className="font-semibold">
                          {applyResult.alreadyApplied
                            ? "El expediente ya había sido aplicado previamente."
                            : "¡Recuperación histórica aplicada exitosamente!"}
                        </p>
                        <p className="text-muted-foreground">
                          Revisión {applyResult.revisionNumber ?? 1} registrada. Las ventas
                          ordinarias de esta sucursal y fecha ya están habilitadas sin bloqueo.
                        </p>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </div>
          )}
          </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
