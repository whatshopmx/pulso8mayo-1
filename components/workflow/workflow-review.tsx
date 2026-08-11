"use client";

import * as React from "react";
import { CheckCircle2, XCircle, Eye, Download, Calendar, User, MapPin, AlertTriangle, MessageSquare, ChevronDown, ImageIcon, Loader2, Circle, MinusCircle, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { scoreColorClass } from "@/lib/utils/score";
import { StepValue } from "@/components/workflow/step-value";
import {
  stepNeedsAttention,
  stepWasAnswered,
  type ResolvedReviewStep,
} from "@/lib/workflows/step-definitions";
import { toast } from "sonner";

export type { AIVerificationData, ResolvedReviewStep } from "@/lib/workflows/step-definitions";

export interface WorkflowReviewData {
  id: string;
  templateName: string;
  assigneeName: string | null;
  branchName: string | null;
  status: string;
  score: number | null;
  createdAt: Date;
  completedAt: Date | null;
  /** Ya unidos con su definición y en orden canónico (`resolveStepDefinitions`). */
  steps: ResolvedReviewStep[];
  /** null mientras nadie la ha revisado. */
  reviewStatus: 'APPROVED' | 'REJECTED' | null;
  reviewComment: string | null;
  reviewedAt: string | null;
}

export interface WorkflowReviewProps {
  workflow: WorkflowReviewData;
  // Devuelven promesa: handleReviewSubmit las espera para saber si falló.
  onApprove?: (workflowId: string, comment: string) => Promise<void> | void;
  onReject?: (workflowId: string, comment: string) => Promise<void> | void;
  className?: string;
}

function getEvidenceUrls(evidenceUrl: string | null): string[] {
  if (!evidenceUrl) return [];
  try {
    if (evidenceUrl.startsWith('[')) {
      return JSON.parse(evidenceUrl);
    }
    return [evidenceUrl];
  } catch {
    return [evidenceUrl];
  }
}

function formatTime(value: string | Date | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

export function WorkflowReview({
  workflow,
  onApprove,
  onReject,
  className
}: WorkflowReviewProps) {
  const [selectedEvidence, setSelectedEvidence] = React.useState<{ url: string; step: ResolvedReviewStep } | null>(null);
  const [reviewComment, setReviewComment] = React.useState("");
  const [reviewDialogOpen, setReviewDialogOpen] = React.useState(false);
  const [reviewAction, setReviewAction] = React.useState<'approve' | 'reject' | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Sólo se revisa una ejecución terminada, y sólo una vez. El servidor lo
  // vuelve a validar; aquí evitamos ofrecer una acción que va a fallar.
  const isReviewed = workflow.reviewStatus === 'APPROVED' || workflow.reviewStatus === 'REJECTED';
  const isCompleted = workflow.status === 'COMPLETED';

  const evidenceCount = workflow.steps.filter(s => !!s.evidenceUrl).length;
  const aiVerifiedCount = workflow.steps.filter(s => s.aiAnalysis?.passed === true).length;
  const aiFailedCount = workflow.steps.filter(s => s.aiAnalysis?.passed === false).length;
  const stepsToReview = React.useMemo(
    () => workflow.steps.filter(stepNeedsAttention),
    [workflow.steps]
  );

  const handleReviewSubmit = async () => {
    if (!reviewAction) return;

    setSubmitting(true);
    try {
      if (reviewAction === 'approve') {
        await onApprove?.(workflow.id, reviewComment);
        toast.success('Workflow aprobado exitosamente');
      } else {
        await onReject?.(workflow.id, reviewComment);
        toast.success('Workflow rechazado');
      }
      setReviewDialogOpen(false);
      setReviewComment("");
      setReviewAction(null);
    } catch (error: unknown) {
      toast.error('Error al procesar la revisión', {
        description: error instanceof Error ? error.message : 'Error desconocido',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openReviewDialog = (action: 'approve' | 'reject') => {
    setReviewAction(action);
    setReviewDialogOpen(true);
  };

  // La evidencia se abre con contexto: paso canónico + veredicto, para que el
  // diálogo anuncie algo con significado y no "una imagen".
  const handleSelectEvidence = React.useCallback((url: string, step: ResolvedReviewStep) => {
    setSelectedEvidence({ url, step });
  }, []);

  return (
    <div className={cn("space-y-6 pb-20 relative", className)}>
      {/* Workflow Summary */}
      <Card className="border border-border bg-card">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-2xl font-bold tracking-tight">{workflow.templateName}</CardTitle>
              <CardDescription className="mt-1">
                Completado el {workflow.completedAt ? new Date(workflow.completedAt).toLocaleDateString('es-MX', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                }) : 'N/A'}
              </CardDescription>
            </div>
            <div>
              {workflow.reviewStatus === 'REJECTED' ? (
                <Badge variant="destructive" className="text-sm font-semibold px-3 py-1">
                  Rechazado
                </Badge>
              ) : workflow.reviewStatus === 'APPROVED' ? (
                <Badge variant="success" className="text-sm font-semibold px-3 py-1">
                  Aprobado
                </Badge>
              ) : workflow.status === 'COMPLETED' ? (
                <Badge variant="outline" className="text-sm font-semibold px-3 py-1">
                  Completado
                </Badge>
              ) : workflow.status === 'FAILED' ? (
                <Badge variant="destructive" className="text-sm font-semibold px-3 py-1">
                  Fallido
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-sm font-semibold px-3 py-1">
                  {workflow.status}
                </Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-4 border-t border-border/60">
            <div className="flex items-center gap-2.5 text-sm">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Asignado a</div>
                <div className="font-medium">{workflow.assigneeName || 'Sin asignar'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Sucursal</div>
                <div className="font-medium">{workflow.branchName || 'N/A'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Creado</div>
                <div className="font-medium">{new Date(workflow.createdAt).toLocaleDateString('es-MX')}</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5 text-sm">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">Puntuación</div>
                <div className={cn("font-mono", scoreColorClass(workflow.score))}>{workflow.score !== null ? `${workflow.score}%` : 'N/A'}</div>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Verificación AI. Además del veredicto agregado, es donde viven los
          conteos de evidencia y de pasos verificados: los tabs que antes los
          exponían fragmentaban la secuencia del flujo, que es justo lo que hay
          que poder leer de corrido. */}
      {(aiVerifiedCount > 0 || aiFailedCount > 0 || evidenceCount > 0) && (
        <Card className="border border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">Verificación IA</CardTitle>
            <CardDescription>
              Resumen de verificación automática y evidencia recolectada
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {aiVerifiedCount > 0 && (
                <Alert className="border-success/30 bg-success/5 text-success">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <AlertTitle className="font-semibold">
                    {aiVerifiedCount} paso(s) verificado(s)
                  </AlertTitle>
                  <AlertDescription className="text-xs mt-1">
                    Estos pasos fueron verificados exitosamente por IA
                  </AlertDescription>
                </Alert>
              )}

              {aiFailedCount > 0 && (
                <Alert className="border-destructive/30 bg-destructive/5 text-destructive">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <AlertTitle className="font-semibold">
                    {aiFailedCount} paso(s) con observaciones
                  </AlertTitle>
                  <AlertDescription className="text-xs mt-1">
                    Estos pasos requieren revisión manual por discrepancias en la verificación IA
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {evidenceCount > 0 && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <ImageIcon className="h-4 w-4 shrink-0" />
                {evidenceCount === 1
                  ? '1 paso con evidencia adjunta'
                  : `${evidenceCount} pasos con evidencia adjunta`}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bitácora de la ejecución */}
      <Card className="border border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Bitácora de la ejecución</CardTitle>
          <CardDescription>
            Qué se pidió en cada paso y qué registró el operador
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all">
            <TabsList className="grid w-full grid-cols-2 gap-1">
              <TabsTrigger value="all">Todo ({workflow.steps.length})</TabsTrigger>
              <TabsTrigger value="review">
                Requiere atención ({stepsToReview.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-4">
              <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
                {workflow.steps.map((step) => (
                  <StepDetail
                    key={step.id}
                    step={step}
                    onSelectImage={handleSelectEvidence}
                  />
                ))}
              </div>
            </TabsContent>

            <TabsContent value="review" className="mt-4">
              {stepsToReview.length > 0 ? (
                <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
                  {stepsToReview.map((step) => (
                    <StepDetail
                      key={step.id}
                      step={step}
                      onSelectImage={handleSelectEvidence}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
                  No hay pasos con fallas o comentarios que requieran atención manual
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Barra de decisión. Una sola: antes existían esta y una tarjeta idéntica
          justo encima, visibles a la vez, y no había forma de saber si diferían. */}
      <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 text-sm min-w-0">
          <span className="font-semibold text-foreground truncate">{workflow.templateName}</span>
          <span className="text-muted-foreground hidden sm:inline">•</span>
          <span className="text-muted-foreground text-xs hidden sm:inline shrink-0">
            {workflow.steps.length === 1 ? "1 paso" : `${workflow.steps.length} pasos`}
          </span>
        </div>

        {isReviewed ? (
          <div className="flex items-center gap-2 text-sm shrink-0">
            {workflow.reviewStatus === 'APPROVED' ? (
              <CheckCircle2 className="h-4 w-4 text-success" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive" />
            )}
            <span className="font-medium">
              {workflow.reviewStatus === 'APPROVED' ? "Aprobado" : "Rechazado"}
            </span>
            {workflow.reviewedAt && (
              <span className="text-muted-foreground">
                el {new Date(workflow.reviewedAt).toLocaleDateString('es-MX', { dateStyle: 'long' })}
              </span>
            )}
          </div>
        ) : !isCompleted ? (
          <p className="text-sm text-muted-foreground shrink-0">
            Podrás revisarla cuando la ejecución termine.
          </p>
        ) : (
          <div className="flex items-center gap-3 shrink-0">
            <Button
              variant="outline"
              onClick={() => openReviewDialog('reject')}
              className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <XCircle className="h-4 w-4" />
              Rechazar
            </Button>
            <Button
              variant="default"
              onClick={() => openReviewDialog('approve')}
              className="gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4" />
              Aprobar
            </Button>
          </div>
        )}
      </div>

      {isReviewed && workflow.reviewComment && (
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-xs font-medium text-muted-foreground mb-1">
            {workflow.reviewStatus === 'APPROVED' ? "Nota de la revisión" : "Motivo del rechazo"}
          </p>
          <p className="text-sm">{workflow.reviewComment}</p>
        </div>
      )}

      {/* Image Preview Dialog. Anuncia paso + veredicto: sin contexto, la
          evidencia es un rectángulo sin significado. */}
      <Dialog open={!!selectedEvidence} onOpenChange={() => setSelectedEvidence(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Vista Previa de Evidencia</DialogTitle>
            {selectedEvidence && (
              <DialogDescription>
                Paso {selectedEvidence.step.position}: {stepLabel(selectedEvidence.step)}
                {selectedEvidence.step.aiAnalysis && (
                  <>
                    {' · '}
                    {selectedEvidence.step.aiAnalysis.passed ? 'Verificado por IA' : 'Requiere revisión'}
                  </>
                )}
              </DialogDescription>
            )}
          </DialogHeader>
          {selectedEvidence && (
            <div className="relative aspect-video max-h-[70vh] flex items-center justify-center bg-black/5 dark:bg-black/40 rounded-lg overflow-hidden">
              <img
                src={selectedEvidence.url}
                alt={`Evidencia del paso ${selectedEvidence.step.position}: ${stepLabel(selectedEvidence.step)}`}
                className="max-w-full max-h-full object-contain rounded-lg"
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = 'none';
                }}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" asChild className="gap-2">
              <a
                href={selectedEvidence?.url || ''}
                download={true}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="h-4 w-4" />
                Descargar
              </a>
            </Button>
            <Button variant="outline" onClick={() => setSelectedEvidence(null)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Comment Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === 'approve' ? 'Aprobar Workflow' : 'Rechazar Workflow'}
            </DialogTitle>
            <DialogDescription>
              {reviewAction === 'approve'
                ? 'Esta acción es definitiva y quedará registrada en el historial. Puedes agregar un comentario opcional.'
                : 'Esta acción es definitiva y quedará registrada en el historial. Por favor proporciona una razón.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>
                Comentario {reviewAction === 'reject' ? '*' : '(opcional)'}
              </Label>
              <Textarea
                placeholder="Agrega tu comentario aquí..."
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                className="min-h-[100px]"
                required={reviewAction === 'reject'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReviewDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant={reviewAction === 'approve' ? 'default' : 'outline'}
              className={cn(
                'gap-1.5',
                reviewAction === 'reject' && 'border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive'
              )}
              onClick={handleReviewSubmit}
              disabled={submitting || (reviewAction === 'reject' && !reviewComment.trim())}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : reviewAction === 'approve' ? (
                'Aprobar'
              ) : (
                'Rechazar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Un paso sin definición localizable no recibe un título inventado: se rotula
 * como lo que es. Antes esta pantalla mostraba `Step <uuid>` y parecía un
 * título de verdad.
 */
function stepLabel(step: ResolvedReviewStep): string {
  return step.title ?? "Paso sin definición en la plantilla";
}

interface StepDetailProps {
  step: ResolvedReviewStep;
  onSelectImage: (url: string, step: ResolvedReviewStep) => void;
}

function StepDetail({ step, onSelectImage }: StepDetailProps) {
  const needsAttention = stepNeedsAttention(step);
  // Los pasos con hallazgo son la razón por la que el revisor abrió la página:
  // llegan abiertos. Los limpios se leen de un vistazo y no piden espacio.
  const [expanded, setExpanded] = React.useState(needsAttention);
  const urls = getEvidenceUrls(step.evidenceUrl);
  const answered = stepWasAnswered(step);
  const time = formatTime(step.completedAt);

  // INFO no es una pregunta: es contexto que el operador leyó. Ni se responde ni
  // se revisa, así que no ocupa una fila de bitácora con estado y respuesta.
  if (step.type === 'INFO') {
    return (
      <div className="flex items-start gap-3 px-4 py-3 bg-muted/20">
        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{stepLabel(step)}</p>
          {step.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="transition-colors hover:bg-muted/30">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={`step-detail-${step.id}`}
        className="w-full p-4 cursor-pointer flex items-start justify-between gap-4 select-none text-left"
      >
        <div className="flex items-start gap-3 min-w-0">
          <StepStatusIcon status={step.status} needsAttention={needsAttention} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-xs font-medium text-muted-foreground shrink-0">
                Paso {step.position}
              </span>
              <span className={cn("font-medium text-sm", step.resolved ? "text-foreground" : "text-muted-foreground italic")}>
                {stepLabel(step)}
              </span>
            </div>
            {/* Quién y cuándo, visible sin expandir: en una revisión de
                cumplimiento la autoría del registro es parte del dato. */}
            {(step.completedByName || time) && (
              <p className="text-xs text-muted-foreground mt-1">
                {[step.completedByName, time].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {step.aiAnalysis && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs font-medium",
                step.aiAnalysis.passed
                  ? "bg-success/10 text-success border-success/20"
                  : "bg-destructive/10 text-destructive border-destructive/20"
              )}
            >
              {step.aiAnalysis.passed ? '✓ Verificado por IA' : '✗ Requiere revisión'}
            </Badge>
          )}
          {urls.length > 0 && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Eye className="h-3 w-3" />
              Evidencia ({urls.length})
            </Badge>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              expanded && "rotate-180"
            )}
          />
        </div>
      </button>

      {step.comment && !expanded && (
        <div className="px-4 pb-3 -mt-1">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <MessageSquare className="h-3 w-3 shrink-0" />
            {step.comment}
          </p>
        </div>
      )}

      {expanded && (
        <div id={`step-detail-${step.id}`} className="p-4 pt-3 border-t border-border/60 bg-muted/20 space-y-4">
          {!step.resolved && (
            <p className="text-xs text-muted-foreground">
              La plantilla ya no contiene la definición de este paso. Identificador registrado:{' '}
              <code className="font-mono text-foreground">{step.stepId}</code>
            </p>
          )}

          {step.description && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Se pidió</p>
              <p className="text-sm mt-1 text-foreground">{step.description}</p>
            </div>
          )}

          {/* Un paso que nunca se completó no tiene respuesta que mostrar: el
              `value` que trae es metadata sembrada al crear la instancia, no
              algo que el operador haya registrado. */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Registró</p>
            <div className="mt-1">
              {answered ? (
                <StepValue step={step} />
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  {step.status === 'SKIPPED' ? 'Paso omitido' : 'Sin registrar'}
                </p>
              )}
            </div>
          </div>

          {step.comment && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Nota del operador</p>
              <p className="text-sm mt-1 text-foreground bg-background p-2.5 rounded-md border border-border">
                {step.comment}
              </p>
            </div>
          )}

          {urls.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Evidencia ({urls.length})</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                {urls.map((url, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onSelectImage(url, step)}
                    aria-label={`Ampliar evidencia ${idx + 1} del paso ${step.position}`}
                    className="group relative aspect-video overflow-hidden rounded-md bg-muted border border-border cursor-pointer hover:ring-2 hover:ring-primary transition-all text-left"
                  >
                    <img
                      src={url}
                      alt={`Evidencia ${idx + 1} del paso ${step.position}`}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      onError={(e) => {
                        const target = e.currentTarget;
                        target.style.display = 'none';
                        if (target.nextElementSibling) {
                          (target.nextElementSibling as HTMLElement).style.display = 'flex';
                        }
                      }}
                    />
                    <div className="hidden absolute inset-0 items-center justify-center bg-muted text-muted-foreground text-xs p-2 text-center flex-col gap-1">
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      <span>Sin imagen</span>
                    </div>
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-medium gap-1">
                      <Eye className="h-3.5 w-3.5" /> Ampliar
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step.aiAnalysis && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Verificación IA</p>
              <Alert
                className={cn(
                  "mt-1.5",
                  step.aiAnalysis.passed
                    ? "border-success/30 bg-success/5 text-success"
                    : "border-destructive/30 bg-destructive/5 text-destructive"
                )}
              >
                {step.aiAnalysis.passed ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                )}
                <AlertTitle className="text-sm font-semibold">
                  {step.aiAnalysis.passed ? 'Verificación Exitosa' : 'Revisión Requerida'}
                </AlertTitle>
                <AlertDescription className="text-xs mt-1 space-y-1">
                  <p>{step.aiAnalysis.reason || step.aiAnalysis.notes || 'Sin detalles'}</p>
                  {step.aiAnalysis.confidence !== undefined && step.aiAnalysis.confidence !== null && (
                    <span className="inline-block font-mono text-xs opacity-80">
                      Nivel de confianza: {Math.round(step.aiAnalysis.confidence * 100)}%
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            </div>
          )}

          {step.completedAt && (
            <div className="text-xs text-muted-foreground font-mono pt-1">
              Completado: {new Date(step.completedAt).toLocaleString('es-MX')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** El estado del paso como icono; el texto lo lleva la fila. */
function StepStatusIcon({ status, needsAttention }: { status: string; needsAttention: boolean }) {
  const className = "h-4 w-4 shrink-0 mt-0.5";

  if (needsAttention) {
    return <AlertTriangle className={cn(className, "text-destructive")} aria-hidden="true" />;
  }
  if (status === 'COMPLETED') {
    return <CheckCircle2 className={cn(className, "text-success")} aria-hidden="true" />;
  }
  if (status === 'SKIPPED') {
    return <MinusCircle className={cn(className, "text-muted-foreground")} aria-hidden="true" />;
  }
  return <Circle className={cn(className, "text-muted-foreground")} aria-hidden="true" />;
}
