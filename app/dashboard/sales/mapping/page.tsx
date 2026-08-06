"use client";

import { useEffect, useState } from "react";
import { MappingTemplateForm } from "@/components/sales/mapping-template-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/hooks/use-toast";
import { Plus, Settings2, Trash2, ArrowLeft, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import Link from "next/link";

interface PosTemplate {
  id: string;
  name: string;
  posSystem: string | null;
  mapping: Record<string, string>;
  isDefault: boolean;
  createdByName?: string | null;
  createdAt: string;
}

export default function MappingTemplatesPage() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<PosTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PosTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sales/mapping-templates");
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setTemplates(data.data || []);
        setError(null);
      } else {
        // Sin este `else`, un fallo de carga pintaba "Sin plantillas configuradas"
        // e invitaba a recrear una configuración que sí existe.
        setError(data?.error || "El servidor no devolvió las plantillas de mapeo.");
        setTemplates([]);
      }
    } catch (err) {
      console.error("Failed to load POS templates:", err);
      setError("Error de conexión al cargar las plantillas. Revisa tu red e intenta de nuevo.");
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/sales/mapping-templates/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTemplates((prev) => prev.filter((t) => t.id !== id));
        toast({ title: "Plantilla eliminada", description: "La plantilla de mapeo fue eliminada." });
      } else {
        toast({
          title: "No se pudo eliminar",
          description: data?.error || "El servidor rechazó la operación. Intenta de nuevo.",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Failed to delete template:", err);
      toast({
        title: "Error de conexión",
        description: "No se pudo eliminar la plantilla. Revisa tu red e intenta de nuevo.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
      setPendingDelete(null);
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
              <Link href="/dashboard/sales">
                <ArrowLeft className="w-4 h-4 mr-1" /> Volver a Ventas
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Plantillas de Mapeo POS</h1>
          <p className="text-sm text-muted-foreground">
            Administra las reglas de autodetección y mapeo de archivos exportados por Soft Restaurant, Aloha, Simphony, etc.
          </p>
        </div>

        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" /> Nueva Plantilla POS
          </Button>
        )}
      </div>

      {showForm ? (
        <MappingTemplateForm
          onSaved={() => {
            setShowForm(false);
            fetchTemplates();
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {loading ? (
            <div className="col-span-full py-12 flex justify-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando plantillas...
            </div>
          ) : error ? (
            <div className="col-span-full">
              <EmptyState
                icon={AlertCircle}
                title="No se pudieron cargar las plantillas"
                description={error}
                action={
                  <Button variant="outline" size="sm" onClick={fetchTemplates}>
                    <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
                  </Button>
                }
              />
            </div>
          ) : templates.length === 0 ? (
            <Card className="col-span-full py-12 text-center border-dashed">
              <CardContent className="space-y-3">
                <Settings2 className="w-10 h-10 text-muted-foreground mx-auto" />
                <h3 className="font-semibold text-lg">Sin plantillas configuradas</h3>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Configura una plantilla con un archivo POS de muestra para que el sistema aprenda la estructura de tus archivos.
                </p>
                <Button onClick={() => setShowForm(true)} className="mt-2">
                  <Plus className="w-4 h-4 mr-2" /> Crear primera plantilla
                </Button>
              </CardContent>
            </Card>
          ) : (
            templates.map((tpl) => (
              <Card key={tpl.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base font-bold flex items-center gap-2">
                        {tpl.name}
                        {tpl.isDefault && (
                          <Badge variant="secondary" className="bg-primary/10 text-primary text-xs">
                            Default
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        POS: {tpl.posSystem || "Genérico"}
                      </CardDescription>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => setPendingDelete(tpl)}
                      disabled={deletingId === tpl.id}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="bg-muted/40 p-2.5 rounded-md space-y-1">
                    <span className="font-semibold text-muted-foreground block text-xs">
                      Columnas Mapeadas ({Object.keys(tpl.mapping || {}).length}):
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(tpl.mapping || {}).map(([canon, src]) => (
                        <Badge key={canon} variant="outline" className="bg-background text-xs">
                          {canon}: <span className="font-mono text-muted-foreground ml-1">{String(src)}</span>
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                    <span>Creada por: {tpl.createdByName || "Admin"}</span>
                    <span>{new Date(tpl.createdAt).toLocaleDateString("es-MX")}</span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Delete confirmation — replaces native confirm() */}
      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta plantilla?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.name ? `“${pendingDelete.name}” se eliminará permanentemente. ` : ""}
              Los archivos POS que dependían de ella dejarán de mapearse automáticamente hasta que configures una nueva.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!!pendingDelete && deletingId === pendingDelete.id}
              onClick={() => pendingDelete && handleDelete(pendingDelete.id)}
            >
              {pendingDelete && deletingId === pendingDelete.id ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
