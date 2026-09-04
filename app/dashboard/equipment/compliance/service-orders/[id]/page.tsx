"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, PageContainer } from "@/components/shared";
import {
  useServiceOrder,
  useUpdateServiceOrder,
  useTransitionServiceOrder,
  useSubmitServiceOrder,
  useAddQuote,
  useAddEvidence,
  useLinkInvoiceToServiceOrder,
  useSignConformity,
  useApproveRequest,
  useRejectRequest,
  useCostCenters,
} from "@/hooks/queries";
import { usePhotoUpload } from "@/components/shared/use-photo-upload";
import { useSession } from "@/hooks/use-session";
import { roleIsAtLeast } from "@/lib/permissions";
import {
  ArrowLeft,
  Loader2,
  Check,
  X,
  Send,
  CalendarPlus,
  Play,
  CheckCircle2,
  PenLine,
  Ban,
  Paperclip,
  ImageIcon,
  Clock,
  Receipt,
  Search,
  Link2,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "warning" }> = {
  DRAFT: { label: "Borrador", variant: "secondary" },
  PENDING_APPROVAL: { label: "Por Aprobar", variant: "warning" },
  APPROVED: { label: "Aprobada", variant: "default" },
  SCHEDULED: { label: "Programada", variant: "default" },
  IN_PROGRESS: { label: "En Ejecución", variant: "warning" },
  PENDING_CONFORMITY: { label: "Por Conformar", variant: "warning" },
  CLOSED: { label: "Cerrada", variant: "outline" },
  REJECTED: { label: "Rechazada", variant: "destructive" },
  CANCELLED: { label: "Cancelada", variant: "destructive" },
};

const TYPE_LABELS: Record<string, string> = {
  CORRECTIVO: "Correctivo",
  PREVENTIVO: "Preventivo",
  CONTRACTUAL: "Contractual",
  EXTRAORDINARIO: "Extraordinario",
};

function formatCurrency(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "$0.00";
  return `$${(cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
}

function formatDate(date: string | Date | null | undefined) {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" });
}

export default function ServiceOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useSession();

  const { data, isLoading, isError } = useServiceOrder(id);
  const submitMutation = useSubmitServiceOrder(id);
  const transitionMutation = useTransitionServiceOrder(id);
  const conformityMutation = useSignConformity(id);
  const approveMutation = useApproveRequest();
  const rejectMutation = useRejectRequest();

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [evidenceType, setEvidenceType] = useState<"ANTES" | "DESPUES">("ANTES");
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando orden…
        </div>
      </PageContainer>
    );
  }

  if (isError || !data) {
    return (
      <PageContainer>
        <div className="py-24 text-center space-y-4">
          <p className="text-muted-foreground">No se pudo cargar la orden.</p>
          <Button variant="ghost" asChild>
            <Link href="/dashboard/equipment/compliance/service-orders"><ArrowLeft className="h-4 w-4 mr-2" /> Volver</Link>
          </Button>
        </div>
      </PageContainer>
    );
  }

  const { order, quotes, evidence, approvals, invoice } = data;
  const statusCfg = STATUS_CONFIG[order.status] ?? { label: order.status, variant: "outline" as const };
  const userRole = session?.user?.role;
  const userId = session?.user?.id;
  const isCreator = userId === order.createdBy;

  // Nivel corriente: el PENDING con menor nivel. El usuario actúa si su rol
  // alcanza el requerido y no creó el documento (segregación de funciones).
  const pendingLevels = approvals.filter((a) => a.status === "PENDING").map((a) => a.level);
  const currentLevel = pendingLevels.length ? Math.min(...pendingLevels) : null;
  const currentRequest =
    currentLevel !== null
      ? approvals.find((a) => a.level === currentLevel && a.status === "PENDING")
      : undefined;
  const canApproveNow =
    !!currentRequest && !isCreator && !!userRole && roleIsAtLeast(userRole, currentRequest.requiredRole);
  const isManagerPlus = !!userRole && roleIsAtLeast(userRole, "GERENTE");
  const canWrite = !!userRole && roleIsAtLeast(userRole, "SUPERVISOR");
  const isTerminal = ["CLOSED", "REJECTED", "CANCELLED"].includes(order.status);
  const canUploadEvidence = !isTerminal && canWrite;

  const runTransition = async (action: string, scheduledDate?: string) => {
    try {
      await transitionMutation.mutateAsync({ action, ...(scheduledDate ? { scheduledDate } : {}) });
      toast.success(
        action === "schedule" ? "Servicio programado"
        : action === "start" ? "Ejecución iniciada"
        : action === "complete" ? "Completada; pendiente de conformidad"
        : "Orden cancelada",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error en la transición");
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={order.folio.startsWith("DRAFT") ? `Borrador ${order.folio}` : order.folio}
        description={`${TYPE_LABELS[order.type] ?? order.type}${order.scope ? ` · ${order.scope}` : ""}`}
        actions={
          <>
            <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
            <Button variant="ghost" asChild>
              <Link href="/dashboard/equipment/compliance/service-orders"><ArrowLeft className="h-4 w-4 mr-2" /> Volver</Link>
            </Button>
          </>
        }
      />

      {/* Acciones según estado × rol */}
      <div className="flex flex-wrap gap-2">
        {order.status === "DRAFT" && canWrite && (
          <>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <PenLine className="h-4 w-4 mr-2" /> Editar
            </Button>
            <Button
              onClick={async () => {
                try {
                  await submitMutation.mutateAsync();
                  toast.success("Enviada a aprobación");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo enviar");
                }
              }}
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Enviar a aprobación
            </Button>
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => runTransition("cancel")}>
              <Ban className="h-4 w-4 mr-2" /> Cancelar
            </Button>
          </>
        )}

        {order.status === "PENDING_APPROVAL" && canApproveNow && currentRequest && (
          <>
            <Button
              onClick={async () => {
                try {
                  const res = await approveMutation.mutateAsync(currentRequest.id);
                  toast.success(res?.documentFinalized ? "Nivel final aprobado. Orden aprobada." : "Nivel aprobado");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo aprobar");
                }
              }}
              disabled={approveMutation.isPending}
            >
              <Check className="h-4 w-4 mr-2" />
              Aprobar · nivel {currentRequest.level} ({currentRequest.requiredRole})
            </Button>
            <Button variant="destructive" onClick={() => setRejectOpen(true)}>
              <X className="h-4 w-4 mr-2" /> Rechazar
            </Button>
          </>
        )}

        {order.status === "APPROVED" && canWrite && (
          <>
            <Button onClick={() => { setScheduleDate(order.scheduledDate ? order.scheduledDate.slice(0, 10) : ""); setScheduleOpen(true); }}>
              <CalendarPlus className="h-4 w-4 mr-2" /> Programar
            </Button>
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => runTransition("cancel")}>
              <Ban className="h-4 w-4 mr-2" /> Cancelar
            </Button>
          </>
        )}

        {order.status === "SCHEDULED" && canWrite && (
          <>
            <Button onClick={() => runTransition("start")}><Play className="h-4 w-4 mr-2" /> Iniciar ejecución</Button>
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => runTransition("cancel")}>
              <Ban className="h-4 w-4 mr-2" /> Cancelar
            </Button>
          </>
        )}

        {order.status === "IN_PROGRESS" && canWrite && (
          <Button onClick={() => runTransition("complete")}>
            <CheckCircle2 className="h-4 w-4 mr-2" /> Marcar completada
          </Button>
        )}

        {order.status === "PENDING_CONFORMITY" && isManagerPlus && (
          <Button
            onClick={async () => {
              try {
                await conformityMutation.mutateAsync();
                toast.success("Conformidad firmada. Orden cerrada.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "No se pudo firmar la conformidad");
              }
            }}
            disabled={conformityMutation.isPending}
          >
            {conformityMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PenLine className="h-4 w-4 mr-2" />}
            Firmar conformidad y cerrar
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Información general */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Información</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4 text-sm">
              <InfoItem label="Tipo" value={TYPE_LABELS[order.type] ?? order.type} />
              <InfoItem
                label="Urgencia"
                value={
                  order.urgency === "EMERGENCIA" ? "Emergencia"
                  : order.urgency === "URGENTE" ? "Urgente"
                  : "Normal"
                }
              />
              <InfoItem label="Monto" value={formatCurrency(order.amount)} />
              <InfoItem label="Sucursal" value={order.branchName ?? "-"} />
              <InfoItem label="Centro de costo" value={order.costCenterName ? `${order.costCenterCode} · ${order.costCenterName}` : "Sin asignar"} />
              <InfoItem
                label="Proveedor"
                value={
                  order.serviceProviderName ? (
                    <span className="flex flex-col">
                      <Link href="/dashboard/equipment/providers" className="font-medium hover:underline text-primary">
                        {order.serviceProviderName}
                      </Link>
                      {(order.serviceProviderPhone || order.serviceProviderEmail) && (
                        <span className="text-xs text-muted-foreground font-normal">
                          {[order.serviceProviderPhone, order.serviceProviderEmail].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                  ) : (
                    order.supplierName ?? "-"
                  )
                }
              />
              <InfoItem label="Fecha programada" value={formatDate(order.scheduledDate)} />
              <InfoItem label="Creada" value={formatDate(order.createdAt)} />
              <InfoItem label="Completada" value={formatDate(order.completedAt)} />
            </dl>
            {(order.justification || order.technicalReport || order.conformitySignedBy) && <Separator className="my-4" />}
            {order.justification && (
              <div className="space-y-1 mb-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Justificación</p>
                <p className="text-sm">{order.justification}</p>
              </div>
            )}
            {order.technicalReport && (
              <div className="space-y-1 mb-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reporte técnico</p>
                <p className="text-sm whitespace-pre-wrap">{order.technicalReport}</p>
              </div>
            )}
            {order.conformitySignedBy && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Conformidad</p>
                <p className="text-sm">
                  Firmada por {order.conformitySignedBy} · {formatDate(order.conformitySignedAt)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Timeline de aprobación */}
        <Card>
          <CardHeader><CardTitle>Autorización</CardTitle></CardHeader>
          <CardContent>
            {approvals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {order.status === "DRAFT"
                  ? "Al enviar se genera la cadena según la matriz de autorización."
                  : "Sin cadena de autorización registrada."}
              </p>
            ) : (
              <ol className="space-y-4">
                {[...approvals].sort((a, b) => a.level - b.level).map((a) => (
                  <li key={a.id} className="flex gap-3 text-sm">
                    <span className="mt-0.5">
                      {a.status === "APPROVED" ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary"><Check className="h-3.5 w-3.5" /></span>
                      ) : a.status === "REJECTED" ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-destructive/10 text-destructive"><X className="h-3.5 w-3.5" /></span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-muted-foreground/30 text-muted-foreground"><Clock className="h-3 w-3" /></span>
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium">
                        Nivel {a.level} · {a.requiredRole}
                        {currentRequest?.id === a.id && (
                          <Badge variant="warning" className="ml-2">En turno</Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.status === "APPROVED" && a.resolvedAt && `Aprobado ${formatDate(a.resolvedAt)}`}
                        {a.status === "REJECTED" && a.resolvedAt && `Rechazado ${formatDate(a.resolvedAt)}`}
                        {a.status === "REJECTED" && a.reason && ` — ${a.reason}`}
                        {a.status === "PENDING" && `Esperando rol ${a.requiredRole}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Cotizaciones */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle>Cotizaciones ({quotes.length})</CardTitle>
            {order.status === "DRAFT" && canWrite && (
              <Button size="sm" variant="outline" onClick={() => setQuoteOpen(true)}>
                <Paperclip className="h-4 w-4 mr-1" /> Adjuntar
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {quotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {order.status === "DRAFT"
                  ? "Adjunta las cotizaciones que exige la matriz antes de enviar."
                  : "Sin cotizaciones adjuntas."}
              </p>
            ) : (
              <ul className="divide-y">
                {quotes.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <a href={q.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline block truncate max-w-[280px] sm:max-w-[420px]">
                        {q.supplierName ?? q.url}
                      </a>
                      <p className="text-xs text-muted-foreground">{formatDate(q.createdAt)}</p>
                    </div>
                    <span className="tabular-nums shrink-0">{formatCurrency(q.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Evidencias ANTES/DESPUES */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle>Evidencias</CardTitle>
            {canUploadEvidence && (
              <div className="flex gap-1">
                <Button size="sm" variant={evidenceType === "ANTES" ? "default" : "outline"} onClick={() => setEvidenceType("ANTES")}>Antes</Button>
                <Button size="sm" variant={evidenceType === "DESPUES" ? "default" : "outline"} onClick={() => setEvidenceType("DESPUES")}>Después</Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <EvidenceGallery evidence={evidence} uploadType={evidenceType} orderId={id} canUpload={canUploadEvidence} />
          </CardContent>
        </Card>

        {/* Factura asociada (control OC/OS) */}
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>Factura asociada</CardTitle></CardHeader>
          <CardContent>
            <LinkedInvoiceSection orderId={id} invoice={invoice} canWrite={canWrite} />
          </CardContent>
        </Card>
      </div>

      {/* Rechazar */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rechazar orden</DialogTitle>
            <DialogDescription>El documento pasa a RECHAZADA de inmediato.</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} placeholder="Motivo del rechazo…" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} aria-label="Motivo del rechazo" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>Volver</Button>
            <Button
              variant="destructive"
              disabled={rejectReason.trim().length < 3 || rejectMutation.isPending}
              onClick={async () => {
                try {
                  await rejectMutation.mutateAsync({ requestId: currentRequest!.id, reason: rejectReason.trim() });
                  toast.success("Orden rechazada");
                  setRejectOpen(false);
                  setRejectReason("");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo rechazar");
                }
              }}
            >
              Rechazar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Programar */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Programar servicio</DialogTitle>
            <DialogDescription>Define (opcional) la fecha de ejecución.</DialogDescription>
          </DialogHeader>
          <Input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} aria-label="Fecha programada" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setScheduleOpen(false)}>Cancelar</Button>
            <Button
              disabled={transitionMutation.isPending}
              onClick={async () => {
                await runTransition("schedule", scheduleDate || undefined);
                setScheduleOpen(false);
              }}
            >
              Programar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuoteDialog open={quoteOpen} onClose={() => setQuoteOpen(false)} orderId={id} />
      {order.status === "DRAFT" && (
        <EditDraftDialog open={editOpen} onClose={() => setEditOpen(false)} detail={data} />
      )}
    </PageContainer>
  );
}

const INVOICE_PAYMENT_LABEL: Record<string, string> = {
  PENDING: "Pendiente de pago",
  PAID: "Pagada",
  CANCELLED: "Cancelada",
};

/**
 * Factura ligada a la OS (control OC/OS), o el enlace manual de respaldo
 * cuando el auto-match al capturar el CFDI no aplicó — candidato ambiguo, o
 * la OS usa `serviceProviderId` en vez de `supplierId`.
 */
function LinkedInvoiceSection({
  orderId,
  invoice,
  canWrite,
}: {
  orderId: string;
  invoice: DetailData["invoice"];
  canWrite: boolean;
}) {
  const linkMutation = useLinkInvoiceToServiceOrder(orderId);
  const [uuidInput, setUuidInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  if (invoice) {
    return (
      <div className="flex items-start gap-3 text-sm">
        <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
          <Receipt className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="font-medium">
            {invoice.folio ? `Folio ${invoice.serie ? `${invoice.serie}-${invoice.folio}` : invoice.folio}` : `CFDI ${invoice.uuid.slice(0, 8)}`}
          </p>
          <p className="text-xs text-muted-foreground font-mono truncate">{invoice.uuid}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatCurrency(invoice.total)} · {formatDate(invoice.fecha)} ·{" "}
            <span className={invoice.paymentStatus === "PENDING" ? "text-warning-text" : ""}>
              {INVOICE_PAYMENT_LABEL[invoice.paymentStatus] ?? invoice.paymentStatus}
            </span>
          </p>
        </div>
      </div>
    );
  }

  if (!canWrite) {
    return <p className="text-sm text-muted-foreground">Aún no llega el CFDI de esta orden.</p>;
  }

  const search = async () => {
    const uuid = uuidInput.trim();
    if (!uuid) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/inventory/invoices?uuid=${encodeURIComponent(uuid)}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        setSearchError(json.error || "No se encontró una factura con ese folio fiscal.");
        return;
      }
      if (json.invoice.serviceOrderId) {
        setSearchError("Esa factura ya está ligada a otra orden de servicio.");
        return;
      }
      await linkMutation.mutateAsync(json.invoice.id);
      toast.success(`Factura ${json.invoice.folio ?? uuid.slice(0, 8)} enlazada a esta orden.`);
      setUuidInput("");
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Error al buscar la factura");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Aún no llega el CFDI de esta orden. Si el proveedor ya facturó y no se ligó solo, captura
        el folio fiscal (UUID) para enlazarla a mano.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          value={uuidInput}
          onChange={(e) => setUuidInput(e.target.value)}
          placeholder="Folio fiscal (UUID) del CFDI"
          className="font-mono text-xs sm:max-w-sm"
        />
        <Button size="sm" onClick={search} disabled={!uuidInput.trim() || searching}>
          {searching ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Search className="h-4 w-4 mr-1.5" />}
          Buscar y enlazar
        </Button>
      </div>
      {searchError && <p className="text-xs text-destructive flex items-center gap-1"><Link2 className="h-3 w-3" /> {searchError}</p>}
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Galería ANTES/DESPUES con subida directa (R2 presignado vía /api/upload). */
function EvidenceGallery({
  evidence, uploadType, orderId, canUpload,
}: {
  evidence: Array<{ id: string; type: string; url: string; description: string | null }>;
  uploadType: "ANTES" | "DESPUES";
  orderId: string;
  canUpload: boolean;
}) {
  const addEvidence = useAddEvidence(orderId);
  const { uploadPhotos, uploading } = usePhotoUpload();
  const inputId = `evidence-input-${orderId}`;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const uploaded = await uploadPhotos(Array.from(files));
      for (const u of uploaded) {
        await addEvidence.mutateAsync({ type: uploadType, url: u.url });
      }
      toast.success(`${uploaded.length} evidencia(s) subida(s) como ${uploadType === "ANTES" ? "'antes'" : "'después'"}`);
    } catch {
      toast.error("No se pudieron subir las imágenes");
    }
  };

  const groups: Array<{ label: string; items: typeof evidence }> = [
    { label: "Antes", items: evidence.filter((e) => e.type === "ANTES") },
    { label: "Después", items: evidence.filter((e) => e.type === "DESPUES") },
  ];

  return (
    <div className="space-y-4">
      {canUpload && (
        <div className="space-y-1">
          <Label htmlFor={inputId} className="flex items-center gap-2 cursor-pointer text-sm font-normal">
            <ImageIcon className="h-4 w-4" /> Subir foto ({uploadType === "ANTES" ? "antes" : "después"})
            {uploading && <Loader2 className="h-3 w-3 animate-spin" />}
          </Label>
          <input
            id={inputId}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          />
        </div>
      )}
      {groups.map((g) => (
        <div key={g.label}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">{g.label}</p>
          {g.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin fotos.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {g.items.map((ev) => (
                <a key={ev.id} href={ev.url} target="_blank" rel="noopener noreferrer" className="group block" title={ev.description ?? ""}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ev.url}
                    alt={ev.description ?? `Evidencia ${g.label}`}
                    className="aspect-square w-full rounded-md border object-cover transition-opacity group-hover:opacity-90"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function QuoteDialog({ open, onClose, orderId }: { open: boolean; onClose: () => void; orderId: string }) {
  const addQuote = useAddQuote(orderId);
  const { uploadPhotos, uploading } = usePhotoUpload();

  const [supplierName, setSupplierName] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [url, setUrl] = useState("");

  const cents = Math.round(parseFloat(amountStr || "0") * 100);

  const handleFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const [uploaded] = await uploadPhotos([files[0]]);
      setUrl(uploaded.url);
      toast.success("Archivo cargado");
    } catch {
      toast.error("No se pudo subir el archivo");
    }
  };

  const save = async () => {
    if (!url) {
      toast.error("Sube un archivo o pega una URL");
      return;
    }
    try {
      await addQuote.mutateAsync({ url, supplierName: supplierName || undefined, amount: cents || undefined });
      toast.success("Cotización agregada");
      onClose();
      setSupplierName(""); setAmountStr(""); setUrl("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar cotización");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjuntar cotización</DialogTitle>
          <DialogDescription>Sube el documento del proveedor o pega una URL.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="q-supplier">Proveedor</Label>
              <Input id="q-supplier" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="q-amount">Monto (MXN)</Label>
              <Input id="q-amount" inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ""))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-file">Documento (PDF/imagen)</Label>
            <Input id="q-file" type="file" accept="application/pdf,image/*" onChange={(e) => handleFile(e.target.files)} />
            {uploading && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Subiendo…
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-url">o URL</Label>
            <Input id="q-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={addQuote.isPending}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type DetailData = NonNullable<ReturnType<typeof useServiceOrder>["data"]>;

function EditDraftDialog({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: DetailData }) {
  const updateMutation = useUpdateServiceOrder(detail.order.id);
  const { data: ccData } = useCostCenters();
  const order = detail.order;

  // Estado local solo como "draft de edición"; null = usar valor original.
  const [scope, setScope] = useState<string | null>(null);
  const [justification, setJustification] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState<string | null>(null);
  const [costCenterId, setCostCenterId] = useState<string | null>(null);

  const scopeVal = scope ?? (order.scope ?? "");
  const justVal = justification ?? (order.justification ?? "");
  const amountVal = amountStr ?? (order.amount !== null ? (order.amount / 100).toFixed(2) : "");
  const ccVal = costCenterId ?? order.costCenterId ?? "";

  const save = async () => {
    try {
      await updateMutation.mutateAsync({
        scope: scopeVal || null,
        justification: justVal || null,
        amount: Math.round(parseFloat(amountVal || "0") * 100),
        costCenterId: ccVal || null,
      });
      toast.success("Borrador actualizado");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar borrador</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="ed-scope">Alcance</Label>
            <Input id="ed-scope" value={scopeVal} onChange={(e) => setScope(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ed-amount">Monto (MXN)</Label>
              <Input
                id="ed-amount"
                inputMode="decimal"
                value={amountVal}
                onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ""))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-cc">Centro de costo</Label>
              <Select value={ccVal || undefined} onValueChange={(v) => setCostCenterId(v)}>
                <SelectTrigger id="ed-cc"><SelectValue placeholder="Selecciona…" /></SelectTrigger>
                <SelectContent>
                  {(ccData?.costCenters ?? []).map((cc) => (
                    <SelectItem key={cc.id} value={cc.id}>{cc.code} · {cc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ed-just">Justificación</Label>
            <Textarea id="ed-just" rows={2} value={justVal} onChange={(e) => setJustification(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={updateMutation.isPending}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
