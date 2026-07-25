"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  FileText,
  Eye,
  Download,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Trash2,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";
import { DocumentUpload } from "@/components/labor/document-upload";

interface DocumentsTabProps {
  documents: any[];
  employeeId: string;
  companyId?: string;
  onSuccess?: () => void;
  canEdit?: boolean;
  canValidate?: boolean;
  loading?: boolean;
}

const documentTypeLabels: Record<string, string> = {
  CONTRACT: "Contrato Individual",
  ID: "Identificación Oficial (INE)",
  PROOF_OF_ADDRESS: "Comprobante de Domicilio",
  TAX_ID: "RFC",
  BANK_INFO: "Información Bancaria (CLABE)",
  CERTIFICATE: "Certificados de Capacitación",
  TRAINING: "Capacitación STPS",
  MEDICAL_EXAM: "Examen Médico",
  PERMIT: "Permisos Especiales",
  OTHER: "Otro",
};

const DOCUMENT_TYPES = [
  { value: 'CONTRACT', label: 'Contrato Individual' },
  { value: 'ID', label: 'Identificación Oficial (INE)' },
  { value: 'PROOF_OF_ADDRESS', label: 'Comprobante de Domicilio' },
  { value: 'TAX_ID', label: 'RFC' },
  { value: 'BANK_INFO', label: 'Información Bancaria (CLABE)' },
  { value: 'CERTIFICATE', label: 'Certificados de Capacitación' },
  { value: 'TRAINING', label: 'Capacitación STPS' },
  { value: 'MEDICAL_EXAM', label: 'Examen Médico' },
  { value: 'PERMIT', label: 'Permisos Especiales' },
  { value: 'OTHER', label: 'Otro' }
];

const statusLabels: Record<string, string> = {
  VALIDATED: "Validado",
  PENDING: "Pendiente",
  EXPIRED: "Expirado",
  REJECTED: "Rechazado",
};

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  VALIDATED: "default",
  PENDING: "secondary",
  EXPIRED: "destructive",
  REJECTED: "destructive",
};

const statusIcons: Record<string, typeof CheckCircle> = {
  VALIDATED: CheckCircle,
  PENDING: Clock,
  EXPIRED: AlertCircle,
  REJECTED: XCircle,
};

const requiredDocuments = ["CONTRACT", "ID", "TAX_ID", "BANK_INFO"];

export function DocumentsTab({
  documents = [],
  employeeId,
  companyId,
  onSuccess,
  canEdit = false,
  canValidate = false,
  loading = false
}: DocumentsTabProps) {
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState("");
  const [operationLoading, setOperationLoading] = useState(false);

  const uploadedRequired = requiredDocuments.filter((type) =>
    documents?.some((doc) => doc.documentType === type && doc.status === 'VALIDATED')
  ).length;
  
  const compliancePercentage = Math.round(
    (uploadedRequired / requiredDocuments.length) * 100
  );

  const handleValidate = async (documentId: string, status: 'VALIDATED' | 'REJECTED') => {
    setOperationLoading(true);
    try {
      const response = await fetch(`/api/documents/validate?documentId=${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (response.ok) {
        toast.success(status === 'VALIDATED' ? "Documento validado" : "Documento rechazado");
        onSuccess?.();
      } else {
        toast.error("Error al procesar el documento");
      }
    } catch (error) {
      console.error("Error validating document:", error);
      toast.error("Error al procesar el documento");
    } finally {
      setOperationLoading(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!confirm('¿Estás seguro de eliminar este documento?')) return;

    setOperationLoading(true);
    try {
      const response = await fetch(`/api/documents?documentId=${documentId}`, {
        method: "DELETE"
      });

      if (response.ok) {
        toast.success("Documento eliminado");
        onSuccess?.();
      } else {
        toast.error("Error al eliminar documento");
      }
    } catch (error) {
      console.error("Error deleting document:", error);
      toast.error("Error al eliminar documento");
    } finally {
      setOperationLoading(false);
    }
  };

  const handleView = async (doc: any) => {
    try {
      if (doc.fileKey) {
        const response = await fetch(`/api/documents/url?documentId=${doc.id}`);
        if (response.ok) {
          const data = await response.json();
          window.open(data.url, '_blank');
          return;
        } else {
          console.error("Failed to get document URL:", response.status, response.statusText);
          toast.error("Error al obtener la URL del documento");
        }
      }
      if (doc.documentUrl) {
        window.open(doc.documentUrl, '_blank');
      } else {
        toast.error("No hay URL disponible para este documento");
      }
    } catch (error) {
      console.error("Error viewing document:", error);
      toast.error("Error al ver el documento");
    }
  };

  const handleUploadSuccess = () => {
    setIsUploadDialogOpen(false);
    setSelectedDocType("");
    onSuccess?.();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Cargando expediente digital...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Required Documents Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Expediente de Cumplimiento LFT</CardTitle>
          <CardDescription>
            Documentos obligatorios según la Ley Federal del Trabajo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-sm">
                {uploadedRequired} de {requiredDocuments.length} documentos validados
              </Label>
              <Label className="text-sm font-semibold">
                {compliancePercentage}%
              </Label>
            </div>
            <Progress value={compliancePercentage} className="h-2" />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              {requiredDocuments.map((type) => {
                const doc = documents?.find((d) => d.documentType === type && d.status === 'VALIDATED');
                return (
                  <div
                    key={type}
                    className={`p-3 border rounded-lg ${
                      doc ? "border-green-500 bg-green-50" : "border-dashed"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {doc ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium">
                        {documentTypeLabels[type] || type}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upload Document */}
      {canEdit && (
        <Card>
            <CardHeader>
            <CardTitle>Subir Documentos</CardTitle>
            <CardDescription>Agrega nuevos archivos al expediente del empleado</CardDescription>
            </CardHeader>
            <CardContent>
            <div
                className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:border-primary transition-colors bg-muted/30"
                onClick={() => setIsUploadDialogOpen(true)}
            >
                <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-1">Cargar Archivo</h3>
                <p className="text-muted-foreground text-sm">
                PDF, JPG, PNG o Word hasta 10MB
                </p>
            </div>
            </CardContent>
        </Card>
      )}

      {/* Document Gallery */}
      <Card>
        <CardHeader>
          <CardTitle>Galería de Documentos</CardTitle>
          <CardDescription>
            Todos los documentos registrados en este expediente
          </CardDescription>
        </CardHeader>
        <CardContent>
          {documents && documents.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {documents.map((doc: any, index: number) => {
                const StatusIcon = statusIcons[doc.status] || Clock;
                return (
                  <div key={index} className="p-4 border rounded-lg space-y-3 bg-card hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <FileText className="h-5 w-5 text-primary shrink-0" />
                        <div className="overflow-hidden">
                          <div className="font-medium text-sm truncate">
                            {doc.documentName || documentTypeLabels[doc.documentType] || "Documento"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {doc.createdAt
                              ? format(new Date(doc.createdAt), "d MMM, yyyy", { locale: es })
                              : "N/A"}
                          </div>
                        </div>
                      </div>
                      <Badge variant={statusColors[doc.status] || "outline"} className="shrink-0">
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {statusLabels[doc.status] || doc.status}
                      </Badge>
                    </div>

                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                            <span>Tipo:</span>
                            <span className="font-medium text-foreground">{documentTypeLabels[doc.documentType] || doc.documentType}</span>
                        </div>
                        {doc.expirationDate && (
                            <div className="flex justify-between">
                                <span>Vencimiento:</span>
                                <span className={cn(
                                    "font-medium",
                                    new Date(doc.expirationDate) < new Date() ? "text-destructive" : "text-foreground"
                                )}>
                                    {format(new Date(doc.expirationDate), "d MMM, yyyy", { locale: es })}
                                </span>
                            </div>
                        )}
                    </div>

                    <Separator />

                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => handleView(doc)}>
                        <Eye className="h-3 w-3 mr-1" />
                        Ver
                      </Button>
                      {canEdit && (
                         <Button variant="outline" size="sm" className="flex-1 text-destructive hover:text-destructive" onClick={() => handleDelete(doc.id)} disabled={operationLoading}>
                            <Trash2 className="h-3 w-3 mr-1" />
                            Borrar
                        </Button>
                      )}
                    </div>

                    {canValidate && doc.status === "PENDING" && (
                      <div className="flex gap-2 pt-2">
                         <Button
                           variant="default"
                           size="sm"
                           className="flex-1 bg-green-600 hover:bg-green-700"
                           onClick={() => handleValidate(doc.id, 'VALIDATED')}
                           disabled={operationLoading}
                         >
                           <CheckCircle className="h-3 w-3 mr-1" />
                           Validar
                         </Button>
                         <Button
                           variant="destructive"
                           size="sm"
                           className="flex-1"
                           onClick={() => handleValidate(doc.id, 'REJECTED')}
                           disabled={operationLoading}
                         >
                          <XCircle className="h-3 w-3 mr-1" />
                          Rechazar
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-semibold mb-2">No hay documentos</h3>
              <p className="text-muted-foreground text-sm mb-4">
                Este empleado aún no tiene documentos en su expediente. Sube documentos para completar su perfil.
              </p>
              {canEdit && (
                <Button onClick={() => setIsUploadDialogOpen(true)} variant="outline">
                  <Upload className="mr-2 h-4 w-4" />
                  Subir Primer Documento
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
            <DialogHeader>
                <DialogTitle>Subir Nuevo Documento</DialogTitle>
                <DialogDescription>
                    Selecciona el tipo de documento y el archivo a cargar.
                </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 flex-1 overflow-y-auto px-1">
                <div className="space-y-2">
                    <Label>Tipo de Documento</Label>
                    <Select value={selectedDocType} onValueChange={setSelectedDocType}>
                        <SelectTrigger>
                            <SelectValue placeholder="Seleccionar tipo..." />
                        </SelectTrigger>
                        <SelectContent>
                            {DOCUMENT_TYPES.map((type) => (
                                <SelectItem key={type.value} value={type.value}>
                                    {type.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {selectedDocType && (
                    <DocumentUpload
                        documentType={selectedDocType}
                        documentName={documentTypeLabels[selectedDocType]}
                        employeeId={employeeId}
                        companyId={companyId}
                        isRequired={requiredDocuments.includes(selectedDocType)}
                        onSuccess={handleUploadSuccess}
                        onCancel={() => setIsUploadDialogOpen(false)}
                    />
                )}
            </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Helper function for cn
function cn(...inputs: any[]) {
    return inputs.filter(Boolean).join(" ");
}
