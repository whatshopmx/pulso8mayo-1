"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";

export interface ExceptionEvidenceDialogProps {
  exceptionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEvidenceChanged?: () => void;
}

interface EvidenceItem {
  id: string;
  entityType: string;
  entityId: string;
  kind: string;
  mimeType: string | null;
  url: string;
  storageKey: string | null;
  resolvedUrl?: string;
  createdAt: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function ExceptionEvidenceDialog({
  exceptionId,
  open,
  onOpenChange,
  onEvidenceChanged,
}: ExceptionEvidenceDialogProps) {
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadEvidence = useCallback(async () => {
    if (!exceptionId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/exceptions/${exceptionId}/evidence`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? "Error al consultar evidencias.");
      }
      const loadedItems: EvidenceItem[] =
        json?.items ?? json?.data?.items ?? [];
      setItems(loadedItems);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al consultar evidencias."
      );
    } finally {
      setLoading(false);
    }
  }, [exceptionId]);

  useEffect(() => {
    if (open) {
      loadEvidence();
    } else {
      setItems([]);
    }
  }, [open, loadEvidence]);

  async function handleUpload(file: File) {
    if (file.size > MAX_FILE_SIZE) {
      toast.error("El archivo excede el tamaño máximo permitido de 10MB.");
      return;
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error(
        "Tipo de archivo no permitido. Solo se permiten imágenes y documentos (PDF, Word, texto)."
      );
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/exceptions/${exceptionId}/evidence`, {
        method: "POST",
        body: formData,
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? "Error al subir la evidencia.");
      }

      toast.success("Evidencia adjuntada correctamente.");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await loadEvidence();
      onEvidenceChanged?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al subir la evidencia."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(evidenceId: string) {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/exceptions/${exceptionId}/evidence?evidenceId=${encodeURIComponent(
          evidenceId
        )}`,
        {
          method: "DELETE",
        }
      );

      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.error?.message ?? "Error al retirar la evidencia."
        );
      }

      toast.success("Evidencia retirada.");
      await loadEvidence();
      onEvidenceChanged?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al retirar la evidencia."
      );
    } finally {
      setSubmitting(false);
    }
  }

  function getDisplayName(item: EvidenceItem): string {
    if (item.storageKey) {
      const parts = item.storageKey.split("/");
      return parts[parts.length - 1] || "Evidencia";
    }
    if (item.url && item.url.startsWith("local://")) {
      const parts = item.url.split("/");
      return parts[parts.length - 1] || "Evidencia";
    }
    return `Evidencia-${item.id.slice(0, 8)}`;
  }

  function getFileIcon(mimeType: string | null) {
    if (mimeType?.startsWith("image/")) {
      return <ImageIcon className="w-4 h-4 text-primary" />;
    }
    if (mimeType === "application/pdf") {
      return <FileText className="w-4 h-4 text-destructive" />;
    }
    return <Paperclip className="w-4 h-4 text-muted-foreground" />;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Paperclip className="w-4 h-4" />
            Evidencias de la Excepción
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Documentación adjunta, fotos de anomalías o comprobantes auditables.
          </DialogDescription>
        </DialogHeader>

        {/* Zona de subida */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleUpload(file);
          }}
          className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-muted-foreground/40 bg-muted/20"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.txt"
            className="hidden"
            id="exception-file-upload"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
            disabled={submitting}
          />
          <div className="flex flex-col items-center justify-center gap-1.5">
            <Upload className="w-6 h-6 text-muted-foreground" />
            <div className="text-xs text-muted-foreground">
              Arrastra un archivo aquí o{" "}
              <label
                htmlFor="exception-file-upload"
                className="text-primary font-medium cursor-pointer hover:underline"
              >
                selecciona uno
              </label>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Imágenes (PNG, JPG, WEBP) o documentos (PDF, Word) hasta 10MB.
            </p>
          </div>
        </div>

        {/* Lista de evidencias */}
        <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Cargando evidencias…
            </div>
          ) : items.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Sin evidencias adjuntas para esta excepción.
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-2.5 rounded-md border border-border bg-card hover:bg-muted/40 transition-colors text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {getFileIcon(item.mimeType)}
                  <div className="min-w-0 flex flex-col">
                    <span className="font-medium truncate max-w-[240px]">
                      {getDisplayName(item)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(item.createdAt), {
                        addSuffix: true,
                        locale: es,
                      })}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    asChild
                  >
                    <a
                      href={item.resolvedUrl || item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Ver o descargar evidencia"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(item.id)}
                    disabled={submitting}
                    title="Retirar evidencia"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
