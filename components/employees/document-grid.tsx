"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  FileText,
  Eye,
  Download,
  CheckCircle,
  Trash2,
  Upload,
  Search,
  Filter,
} from "lucide-react";
import { useTranslations } from "next-intl";

export interface Document {
  id: string;
  name: string;
  type: string;
  uploadDate: Date;
  status: "VALIDATED" | "PENDING" | "EXPIRED" | "REJECTED";
  expirationDate?: Date;
  url: string;
}

interface DocumentGridProps {
  documents: Document[];
  onValidate: (docId: string) => void;
  onDelete: (docId: string) => void;
  onUpload: () => void;
  onView: (docId: string) => void;
}

const DOCUMENT_TYPES = [
  "CONTRACT",
  "ID",
  "PROOF_OF_ADDRESS",
  "BANK_INFO",
  "MEDICAL_CERTIFICATE",
  "TRAINING_CERTIFICATE",
  "OTHER",
] as const;

const DOCUMENT_STATUSES = ["VALIDATED", "PENDING", "EXPIRED", "REJECTED"] as const;

const STATUS_COLORS: Record<string, string> = {
  VALIDATED: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  EXPIRED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  REJECTED: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
};

const getFileIcon = (type: string) => {
  switch (type) {
    case "CONTRACT":
      return <FileText className="h-8 w-8 text-blue-500" />;
    case "ID":
      return <FileText className="h-8 w-8 text-purple-500" />;
    default:
      return <FileText className="h-8 w-8 text-gray-500" />;
  }
};

export function DocumentGrid({
  documents,
  onValidate,
  onDelete,
  onUpload,
  onView,
}: DocumentGridProps) {
  const t = useTranslations("labor.employees.documents");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  // `doc.type` llega como texto libre; una clave desconocida muestra el valor.
  const typeLabel = (type: string) => (t.has(`types.${type}`) ? t(`types.${type}`) : type);

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch = doc.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === "ALL" || doc.type === filterType;
    const matchesStatus = filterStatus === "ALL" || doc.status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  if (documents.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">{t("noDocuments")}</h3>
          <p className="text-sm text-muted-foreground text-center mb-4">
            {t("noDocumentsHint")}
          </p>
          <Button onClick={onUpload}>
            <Upload className="mr-2 h-4 w-4" />
            {t("uploadDocument")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[180px]">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder={t("typePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("allTypes")}</SelectItem>
              {DOCUMENT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {typeLabel(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder={t("statusPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("allStatuses")}</SelectItem>
              {DOCUMENT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`statuses.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={onUpload}>
            <Upload className="mr-2 h-4 w-4" />
            {t("upload")}
          </Button>
        </div>
      </div>

      {/* Document Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredDocuments.map((doc) => (
          <Card
            key={doc.id}
            className="hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => onView(doc.id)}
          >
            <CardContent className="pt-6">
              <div className="flex flex-col items-center mb-4">
                {getFileIcon(doc.type)}
                <h4 className="font-medium text-sm mt-3 text-center truncate w-full px-2">
                  {doc.name}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {typeLabel(doc.type)}
                </p>
              </div>

              <div className="space-y-2">
                <Badge
                  className={STATUS_COLORS[doc.status]}
                  variant="secondary"
                >
                  {t(`statuses.${doc.status}`)}
                </Badge>

                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    {t("uploaded", {
                      date: format(new Date(doc.uploadDate), "MMM d, yyyy", { locale: es }),
                    })}
                  </p>
                  {doc.expirationDate && (
                    <p>
                      {t("expiresLabel")}{" "}
                      <span className={doc.status === "EXPIRED" ? "text-red-600 font-semibold" : ""}>
                        {format(new Date(doc.expirationDate), "MMM d, yyyy", { locale: es })}
                      </span>
                    </p>
                  )}
                </div>

                <div className="flex gap-2 pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onView(doc.id);
                    }}
                  >
                    <Eye className="mr-1 h-3 w-3" />
                    {t("view")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(doc.url, "_blank");
                    }}
                  >
                    <Download className="mr-1 h-3 w-3" />
                    {t("download")}
                  </Button>
                </div>

                {doc.status === "PENDING" && (
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onValidate(doc.id);
                    }}
                  >
                    <CheckCircle className="mr-1 h-3 w-3" />
                    {t("validate")}
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs text-red-600 hover:text-red-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(t("deleteConfirm"))) {
                      onDelete(doc.id);
                    }
                  }}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  {t("delete")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredDocuments.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t("noMatches")}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
