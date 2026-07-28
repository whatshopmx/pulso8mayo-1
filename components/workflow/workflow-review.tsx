"use client";

import * as React from "react";
import { CheckCircle2, XCircle, Eye, Download, Calendar, User, MapPin, AlertTriangle, MessageSquare, ChevronDown, ImageIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface AIVerificationData {
    passed?: boolean;
    confidence?: number;
    notes?: string;
    reason?: string;
    detectedIssues?: string;
    [key: string]: unknown;
}

export interface WorkflowReviewStep {
    id: string;
    stepId: string;
    title: string;
    type: string;
    status: string;
    value: unknown;
    evidenceUrl: string | null;
    aiAnalysis: AIVerificationData | null;
    comment: string | null;
    completedAt: Date | null;
}

export interface WorkflowReviewData {
  id: string;
  templateName: string;
  assigneeName: string | null;
  branchName: string | null;
  status: string;
  score: number | null;
  createdAt: Date;
  completedAt: Date | null;
  steps: WorkflowReviewStep[];
}

export interface WorkflowReviewProps {
  workflow: WorkflowReviewData;
  onApprove?: (workflowId: string, comment: string) => void;
  onReject?: (workflowId: string, comment: string) => void;
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

export function WorkflowReview({
  workflow,
  onApprove,
  onReject,
  className
}: WorkflowReviewProps) {
  const [selectedImage, setSelectedImage] = React.useState<string | null>(null);
  const [reviewComment, setReviewComment] = React.useState("");
  const [reviewDialogOpen, setReviewDialogOpen] = React.useState(false);
  const [reviewAction, setReviewAction] = React.useState<'approve' | 'reject' | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const evidenceSteps = workflow.steps.filter(s => !!s.evidenceUrl);
  const aiVerifiedSteps = workflow.steps.filter(s => s.aiAnalysis && s.aiAnalysis.passed);
  const aiFailedSteps = workflow.steps.filter(s => s.aiAnalysis && !s.aiAnalysis.passed);
  const stepsToReview = workflow.steps.filter(
    s => (s.aiAnalysis && !s.aiAnalysis.passed) || (s.comment && s.comment.trim() !== "") || s.status === 'FAILED' || s.status === 'REJECTED'
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
              {workflow.status === 'COMPLETED' ? (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-sm font-semibold px-3 py-1">
                  Completado
                </Badge>
              ) : workflow.status === 'APPROVED' ? (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-sm font-semibold px-3 py-1">
                  Aprobado
                </Badge>
              ) : workflow.status === 'REJECTED' || workflow.status === 'FAILED' ? (
                <Badge variant="destructive" className="text-sm font-semibold px-3 py-1">
                  {workflow.status === 'REJECTED' ? 'Rechazado' : 'Fallido'}
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
                <div className="font-medium font-mono">{workflow.score !== null ? `${workflow.score}%` : 'N/A'}</div>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* AI Verification Summary */}
      {(aiVerifiedSteps.length > 0 || aiFailedSteps.length > 0) && (
        <Card className="border border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">Verificación AI</CardTitle>
            <CardDescription>
              Resumen de verificación automática por inteligencia artificial
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {aiVerifiedSteps.length > 0 && (
                <Alert className="border-emerald-500/30 bg-emerald-500/5 text-emerald-900 dark:text-emerald-200">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <AlertTitle className="font-semibold text-emerald-950 dark:text-emerald-100">
                    {aiVerifiedSteps.length} paso(s) verificado(s)
                  </AlertTitle>
                  <AlertDescription className="text-xs text-emerald-800 dark:text-emerald-300 mt-1">
                    Estos pasos fueron verificados exitosamente por AI
                  </AlertDescription>
                </Alert>
              )}

              {aiFailedSteps.length > 0 && (
                <Alert className="border-destructive/30 bg-destructive/5 text-destructive dark:text-red-300">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <AlertTitle className="font-semibold">
                    {aiFailedSteps.length} paso(s) con observaciones
                  </AlertTitle>
                  <AlertDescription className="text-xs mt-1">
                    Estos pasos requieren revisión manual por discrepancias en la verificación AI
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Evidence Gallery */}
      {evidenceSteps.length > 0 && (
        <Card className="border border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">Galería de Evidencias</CardTitle>
            <CardDescription>
              {evidenceSteps.length} paso(s) con evidencia fotográfica
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {evidenceSteps.flatMap((step, index) => {
                const urls = getEvidenceUrls(step.evidenceUrl);
                return urls.map((url, urlIndex) => (
                  <div
                    key={`${step.id}-${urlIndex}`}
                    className="group relative aspect-square overflow-hidden rounded-lg bg-muted border border-border cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                    onClick={() => setSelectedImage(url)}
                  >
                    <img
                      src={url}
                      alt={`${step.title} - Evidencia ${urlIndex + 1}`}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      onError={(e) => {
                        const target = e.currentTarget;
                        target.style.display = 'none';
                        if (target.nextElementSibling) {
                          (target.nextElementSibling as HTMLElement).style.display = 'flex';
                        }
                      }}
                    />
                    <div className="hidden absolute inset-0 items-center justify-center bg-muted text-muted-foreground text-xs p-2 text-center flex-col gap-1">
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      <span>Evidencia</span>
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="absolute bottom-0 left-0 right-0 p-3">
                        <p className="text-xs text-white font-medium mb-1 line-clamp-1">
                          Paso {index + 1}: {step.title}
                        </p>
                        {step.aiAnalysis && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              step.aiAnalysis.passed
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                                : "bg-destructive/20 text-red-300 border-destructive/30"
                            )}
                          >
                            {step.aiAnalysis.passed ? '✓ AI Verified' : '✗ AI Fail'}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ));
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step Details */}
      <Card className="border border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Detalle de Pasos</CardTitle>
          <CardDescription>
            Información completa de cada paso del workflow
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all">
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 gap-1">
              <TabsTrigger value="all">Todos ({workflow.steps.length})</TabsTrigger>
              <TabsTrigger value="review">
                Por Revisar ({stepsToReview.length})
              </TabsTrigger>
              <TabsTrigger value="evidence">Con Evidencia ({evidenceSteps.length})</TabsTrigger>
              <TabsTrigger value="ai-verified">AI Verified ({aiVerifiedSteps.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-4">
              <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
                {workflow.steps.map((step, index) => (
                  <StepDetail
                    key={step.id}
                    step={step}
                    index={index}
                    onSelectImage={setSelectedImage}
                  />
                ))}
              </div>
            </TabsContent>

            <TabsContent value="review" className="mt-4">
              {stepsToReview.length > 0 ? (
                <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
                  {stepsToReview.map((step, index) => (
                    <StepDetail
                      key={step.id}
                      step={step}
                      index={index}
                      onSelectImage={setSelectedImage}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
                  No hay pasos con fallas o comentarios que requieran atención manual
                </div>
              )}
            </TabsContent>

            <TabsContent value="evidence" className="mt-4">
              {evidenceSteps.length > 0 ? (
                <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
                  {evidenceSteps.map((step, index) => (
                    <StepDetail
                      key={step.id}
                      step={step}
                      index={index}
                      onSelectImage={setSelectedImage}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
                  No hay pasos con evidencia
                </div>
              )}
            </TabsContent>

            <TabsContent value="ai-verified" className="mt-4">
              {aiVerifiedSteps.length > 0 ? (
                <div className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
                  {aiVerifiedSteps.map((step, index) => (
                    <StepDetail
                      key={step.id}
                      step={step}
                      index={index}
                      onSelectImage={setSelectedImage}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
                  No hay pasos verificados por AI
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Review Actions Card */}
      <Card className="border border-border bg-card">
        <CardHeader>
          <CardTitle className="text-lg">Revisión del Workflow</CardTitle>
          <CardDescription>
            Aprueba o rechaza la ejecución del workflow
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-between gap-4">
          <Button
            variant="outline"
            onClick={() => openReviewDialog('reject')}
            className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <XCircle className="h-4 w-4" />
            Rechazar Workflow
          </Button>
          <Button
            onClick={() => openReviewDialog('approve')}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700"
          >
            <CheckCircle2 className="h-4 w-4" />
            Aprobar Workflow
          </Button>
        </CardFooter>
      </Card>

      {/* Sticky Quick Action Bar */}
      <div className="sticky bottom-4 z-20 flex items-center justify-between gap-4 p-4 rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-lg">
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold text-foreground">{workflow.templateName}</span>
          <span className="text-muted-foreground hidden sm:inline">•</span>
          <span className="text-muted-foreground text-xs hidden sm:inline">{workflow.steps.length} pasos</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openReviewDialog('reject')}
            className="gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive text-xs"
          >
            <XCircle className="h-3.5 w-3.5" />
            Rechazar
          </Button>
          <Button
            size="sm"
            onClick={() => openReviewDialog('approve')}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700 text-xs font-medium"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Aprobar
          </Button>
        </div>
      </div>

      {/* Image Preview Dialog */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Vista Previa de Evidencia</DialogTitle>
          </DialogHeader>
          {selectedImage && (
            <div className="relative aspect-video max-h-[70vh] flex items-center justify-center bg-black/5 dark:bg-black/40 rounded-lg overflow-hidden">
              <img
                src={selectedImage}
                alt="Evidencia"
                className="max-w-full max-h-full object-contain rounded-lg"
                onError={(e) => {
                  const target = e.currentTarget;
                  target.style.display = 'none';
                }}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => window.open(selectedImage || '', '_blank')}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Descargar
            </Button>
            <Button onClick={() => setSelectedImage(null)}>
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
                ? '¿Estás seguro de aprobar este workflow? Puedes agregar un comentario opcional.'
                : '¿Estás seguro de rechazar este workflow? Por favor proporciona una razón.'}
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
              onClick={handleReviewSubmit}
              className={cn(
                reviewAction === 'approve'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-destructive text-white hover:bg-destructive/90'
              )}
              disabled={submitting || (reviewAction === 'reject' && !reviewComment.trim())}
            >
              {submitting ? 'Procesando...' : reviewAction === 'approve' ? 'Aprobar' : 'Rechazar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface StepDetailProps {
  step: WorkflowReviewStep;
  index: number;
  onSelectImage: (url: string) => void;
}

function StepDetail({ step, index, onSelectImage }: StepDetailProps) {
  const [expanded, setExpanded] = React.useState(false);
  const urls = getEvidenceUrls(step.evidenceUrl);

  return (
    <div className="transition-colors hover:bg-muted/30">
      <div
        className="p-4 cursor-pointer flex items-center justify-between gap-4 select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 flex-wrap">
          {step.status === 'COMPLETED' ? (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs font-medium">
              Paso {index + 1}
            </Badge>
          ) : step.status === 'SKIPPED' ? (
            <Badge variant="secondary" className="text-xs font-medium">
              Paso {index + 1} (Omitido)
            </Badge>
          ) : (
            <Badge variant="destructive" className="text-xs font-medium">
              Paso {index + 1}
            </Badge>
          )}
          <span className="font-medium text-sm text-foreground">{step.title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {step.aiAnalysis && (
            <Badge
              variant="outline"
              className={cn(
                "text-xs font-medium",
                step.aiAnalysis.passed
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : "bg-destructive/10 text-destructive border-destructive/20"
              )}
            >
              {step.aiAnalysis.passed ? '✓ AI Verified' : '✗ AI Fail'}
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
      </div>

      {step.comment && !expanded && (
        <div className="px-4 pb-3 -mt-1">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <MessageSquare className="h-3 w-3 shrink-0" />
            {step.comment}
          </p>
        </div>
      )}

      {expanded && (
        <div className="p-4 pt-3 border-t border-border/60 bg-muted/20 space-y-4">
          {step.comment && (
            <div>
              <Label className="text-xs font-semibold text-muted-foreground">Comentario del Operador:</Label>
              <p className="text-sm mt-1 text-foreground bg-background p-2.5 rounded-md border border-border">
                {step.comment}
              </p>
            </div>
          )}

          {step.value !== null && step.value !== undefined && (
            <div>
              <Label className="text-xs font-semibold text-muted-foreground">Valor Registrado:</Label>
              <div className="text-sm mt-1 font-mono bg-background p-2.5 rounded-md border border-border">
                {typeof step.value === 'object' ? JSON.stringify(step.value, null, 2) : String(step.value)}
              </div>
            </div>
          )}

          {urls.length > 0 && (
            <div>
              <Label className="text-xs font-semibold text-muted-foreground">Evidencias ({urls.length}):</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                {urls.map((url, idx) => (
                  <div
                    key={idx}
                    className="group relative aspect-video overflow-hidden rounded-md bg-muted border border-border cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                    onClick={() => onSelectImage(url)}
                  >
                    <img
                      src={url}
                      alt={`Evidencia ${idx + 1}`}
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
                  </div>
                ))}
              </div>
            </div>
          )}

          {step.aiAnalysis && (
            <div>
              <Label className="text-xs font-semibold text-muted-foreground">Análisis de Inteligencia Artificial:</Label>
              <Alert
                className={cn(
                  "mt-1.5",
                  step.aiAnalysis.passed
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-900 dark:text-emerald-200"
                    : "border-destructive/30 bg-destructive/5 text-destructive dark:text-red-300"
                )}
              >
                {step.aiAnalysis.passed ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                )}
                <AlertTitle className="text-sm font-semibold">
                  {step.aiAnalysis.passed ? 'Verificación Exitosa' : 'Revisión Requerida'}
                </AlertTitle>
                <AlertDescription className="text-xs mt-1 space-y-1">
                  <p>{step.aiAnalysis.reason || step.aiAnalysis.notes || 'Sin detalles'}</p>
                  {step.aiAnalysis.confidence !== undefined && (
                    <span className="inline-block font-mono text-[11px] opacity-80">
                      Nivel de confianza: {Math.round(step.aiAnalysis.confidence * 100)}%
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            </div>
          )}

          {step.completedAt && (
            <div className="text-[11px] text-muted-foreground font-mono pt-1">
              Completado: {new Date(step.completedAt).toLocaleString('es-MX')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
