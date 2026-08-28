"use client";

import * as React from "react";
import { CheckCircle2, XCircle, AlertTriangle, Clock, RefreshCw, Upload, Image as ImageIcon, Camera } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { CameraCapture } from "@/components/shared/camera-capture";
import { usePhotoUpload } from "@/components/shared/use-photo-upload";

export interface AIVerificationStatus {
    verificationId?: string;
    status: 'pending' | 'analyzing' | 'success' | 'failed' | 'escalated';
    confidence?: number;
    reason?: string;
    provider?: string;
    timestamp?: Date;
    requiresManualReview?: boolean;
    escalated?: boolean;
    photoUrl?: string;
    retryCount?: number;
    maxRetries?: number;
}

export interface AIVerificationStatusProps {
    status: AIVerificationStatus;
    onRetry?: () => void;
    onUpload?: (file: File) => void;
    className?: string;
}

export function AIVerificationStatus({
    status,
    onRetry,
    onUpload,
    className
}: AIVerificationStatusProps) {
    const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const { uploadPhotos } = usePhotoUpload();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUpload) {
      onUpload(file);
    }
  };

  const handleCameraConfirm = async (files: File[]) => {
    try {
      const results = await uploadPhotos(files);
      if (results.length > 0 && onUpload) {
        const response = await fetch(results[0].url);
        const blob = await response.blob();
        const file = new File([blob], results[0].name, { type: blob.type });
        onUpload(file);
      }
    } catch {
      // Upload error handled by hook error state
    }
  };

    const getStatusIcon = () => {
        switch (status.status) {
            case 'pending':
                return <Clock className="h-8 w-8 text-muted-foreground" />;
            case 'analyzing':
                return <RefreshCw className="h-8 w-8 text-primary animate-spin" />;
            case 'success':
                return <CheckCircle2 className="h-8 w-8 text-success" />;
            case 'failed':
                return <XCircle className="h-8 w-8 text-destructive" />;
            case 'escalated':
                return <AlertTriangle className="h-8 w-8 text-warning" />;
            default:
                return <Clock className="h-8 w-8 text-muted-foreground" />;
        }
    };

    const getStatusColor = () => {
        switch (status.status) {
            case 'pending':
                return 'border-muted-foreground/25';
            case 'analyzing':
                return 'border-primary/40';
            case 'success':
                return 'border-success/40';
            case 'failed':
                return 'border-destructive/40';
            case 'escalated':
                return 'border-warning/40';
            default:
                return 'border-muted-foreground/25';
        }
    };

    const getStatusBadge = () => {
        const variants: Record<string, 'default' | 'destructive' | 'secondary' | 'outline' | 'success' | 'warning'> = {
            pending: 'secondary',
            analyzing: 'default',
            success: 'success',
            failed: 'destructive',
            escalated: 'warning'
        };

        const labels: Record<string, string> = {
            pending: 'Pendiente',
            analyzing: 'Analizando...',
            success: 'Aprobado',
            failed: 'Fallido',
            escalated: 'Escalado'
        };

        return (
            <Badge variant={variants[status.status] || 'outline'}>
                {labels[status.status] || status.status}
            </Badge>
        );
    };

    const getProgressValue = () => {
        if (status.status === 'analyzing') {
            return 60; // Simulate progress
        }
        if (status.status === 'success') {
            return 100;
        }
        if (status.status === 'failed' || status.status === 'escalated') {
            return 100;
        }
        return 0;
    };

    return (
        <Card className={cn("border-2 transition-colors", getStatusColor(), className)}>
            <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {getStatusIcon()}
                        <div>
                            <CardTitle className="text-lg">Verificación AI</CardTitle>
                            <CardDescription className="flex items-center gap-2">
                                {getStatusBadge()}
                                {status.provider && (
                                    <span className="text-xs text-muted-foreground">
                                        via {status.provider}
                                    </span>
                                )}
                            </CardDescription>
                        </div>
                    </div>
                    {status.confidence !== undefined && status.status !== 'pending' && (
                        <div className="text-right">
                            <div className="text-2xl font-bold font-mono">
                                {Math.round(status.confidence * 100)}%
                            </div>
                            <div className="text-xs text-muted-foreground">Confianza</div>
                        </div>
                    )}
                </div>
                {status.status === 'analyzing' && (
                    <Progress value={getProgressValue()} className="h-2" />
                )}
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Photo Preview */}
                {status.photoUrl && (
                    <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                        <img
                            src={status.photoUrl}
                            alt="Evidence"
                            className="h-full w-full object-cover"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <ImageIcon className="h-8 w-8 text-white/50" />
                        </div>
                    </div>
                )}

        {/* Upload Button (if pending) */}
        {status.status === 'pending' && onUpload && (
          <div className="flex flex-col items-center justify-center gap-4 py-8">
            <div className="text-center text-sm text-muted-foreground">
              Sube una foto para verificación
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="flex gap-2">
              <Button onClick={() => setCameraOpen(true)} variant="outline" className="gap-2">
                <Camera className="h-4 w-4" />
                Abrir Cámara
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
                <Upload className="h-4 w-4" />
                Subir Foto
              </Button>
            </div>
            <CameraCapture open={cameraOpen} onOpenChange={setCameraOpen} onConfirm={handleCameraConfirm} maxPhotos={1} />
          </div>
        )}

                {/* AI Analysis Result */}
                {status.reason && status.status !== 'pending' && (
                    <div className={cn(
                        "rounded-lg p-4 text-sm border",
                        status.status === 'success'
                            ? 'bg-success/10 text-foreground border-success/30'
                            : status.status === 'failed' || status.status === 'escalated'
                                ? 'bg-destructive/10 text-foreground border-destructive/30'
                                : 'bg-muted border-border'
                    )}>
                        <div className="font-semibold mb-1">
                            {status.status === 'success' ? '✓ ' : '✗ '}
                            Resultado:
                        </div>
                        {status.reason}
                    </div>
                )}

                {/* Retry Logic */}
                {(status.status === 'failed' || status.status === 'escalated') && onRetry && (
                    <div className="flex items-center justify-between gap-4">
                        {status.retryCount !== undefined && status.maxRetries !== undefined && (
                            <div className="text-sm font-mono text-muted-foreground">
                                Intento {status.retryCount}/{status.maxRetries}
                            </div>
                        )}
                        <Button
                            variant="outline"
                            onClick={onRetry}
                            disabled={status.retryCount !== undefined && status.maxRetries !== undefined && status.retryCount >= status.maxRetries}
                            className="gap-2"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Reintentar
                        </Button>
                    </div>
                )}

                {/* Escalation Notice */}
                {status.escalated && (
                    <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                            <div className="text-sm text-foreground">
                                <div className="font-semibold mb-1">Requiere Revisión Manual</div>
                                <p className="text-muted-foreground">
                                    La verificación falló después de {status.retryCount || 1} intento(s).
                                    Un supervisor ha sido notificado y revisará tu evidencia.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Manual Review Notice */}
                {status.requiresManualReview && !status.escalated && (
                    <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
                        <div className="flex items-start gap-3">
                            <Clock className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                            <div className="text-sm text-foreground">
                                <div className="font-semibold mb-1">Revisión Pendiente</div>
                                <p className="text-muted-foreground">
                                    Tu evidencia está siendo revisada por un supervisor.
                                    Recibirás una notificación cuando se complete la revisión.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Timestamp */}
                {status.timestamp && (
                    <div className="text-xs text-muted-foreground text-center font-mono">
                        {status.timestamp.toLocaleString('es-MX', {
                            dateStyle: 'medium',
                            timeStyle: 'short'
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/**
 * AIVerificationList - Display multiple verification statuses
 */
export interface AIVerificationListItem {
    id: string;
    workflowName: string;
    status: AIVerificationStatus;
}

export interface AIVerificationListProps {
    verifications: AIVerificationListItem[];
    onVerificationClick?: (id: string) => void;
    className?: string;
}

export function AIVerificationList({
    verifications,
    onVerificationClick,
    className
}: AIVerificationListProps) {
    if (verifications.length === 0) {
        return (
            <Card className={className}>
                <CardContent className="py-8 text-center text-muted-foreground">
                    No hay verificaciones pendientes
                </CardContent>
            </Card>
        );
    }

    return (
        <div className={cn("grid gap-4", className)}>
            {verifications.map((verification) => (
                <Card
                    key={verification.id}
                    className={cn(
                        "cursor-pointer transition-colors hover:bg-accent/50",
                        verification.status.status === 'success' && "border-success/40",
                        verification.status.status === 'failed' && "border-destructive/40",
                        verification.status.status === 'escalated' && "border-warning/40"
                    )}
                    onClick={() => onVerificationClick?.(verification.id)}
                >
                    <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                {verification.status.status === 'success' && (
                                    <CheckCircle2 className="h-5 w-5 text-success" />
                                )}
                                {verification.status.status === 'failed' && (
                                    <XCircle className="h-5 w-5 text-destructive" />
                                )}
                                {verification.status.status === 'escalated' && (
                                    <AlertTriangle className="h-5 w-5 text-warning" />
                                )}
                                {verification.status.status === 'analyzing' && (
                                    <RefreshCw className="h-5 w-5 text-primary animate-spin" />
                                )}
                                {verification.status.status === 'pending' && (
                                    <Clock className="h-5 w-5 text-muted-foreground" />
                                )}
                                <div>
                                    <div className="font-medium">{verification.workflowName}</div>
                                    <div className="text-xs text-muted-foreground">
                                        {verification.status.reason?.substring(0, 50) || 'Sin resultados'}
                                    </div>
                                </div>
                            </div>
                            <Badge variant={
                                verification.status.status === 'success' ? 'success' :
                                verification.status.status === 'failed' ? 'destructive' :
                                verification.status.status === 'escalated' ? 'warning' :
                                'secondary'
                            }>
                                {verification.status.status === 'success' ? 'Aprobado' :
                                 verification.status.status === 'failed' ? 'Fallido' :
                                 verification.status.status === 'escalated' ? 'Escalado' :
                                 verification.status.status === 'analyzing' ? 'Analizando' :
                                 'Pendiente'}
                            </Badge>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
