"use client";

import { useEffect, useState } from "react";
import { MappingTemplateForm } from "@/components/sales/mapping-template-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Settings2, Trash2, CheckCircle, ArrowLeft, Loader2 } from "lucide-react";
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
  const [templates, setTemplates] = useState<PosTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sales/mapping-templates");
      const data = await res.json();
      if (res.ok && data.success) {
        setTemplates(data.data || []);
      }
    } catch (err) {
      console.error("Failed to load POS templates:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro de que deseas eliminar esta plantilla de mapeo?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/sales/mapping-templates/${id}`, { method: "DELETE" });
      if (res.ok) {
        setTemplates((prev) => prev.filter((t) => t.id !== id));
      }
    } catch (err) {
      console.error("Failed to delete template:", err);
    } finally {
      setDeletingId(null);
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
                          <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px]">
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
                      onClick={() => handleDelete(tpl.id)}
                      disabled={deletingId === tpl.id}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="bg-muted/40 p-2.5 rounded-md space-y-1">
                    <span className="font-semibold text-muted-foreground block text-[11px]">
                      Columnas Mapeadas ({Object.keys(tpl.mapping || {}).length}):
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(tpl.mapping || {}).map(([canon, src]) => (
                        <Badge key={canon} variant="outline" className="bg-background text-[10px]">
                          {canon}: <span className="font-mono text-muted-foreground ml-1">{String(src)}</span>
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                    <span>Creada por: {tpl.createdByName || "Admin"}</span>
                    <span>{new Date(tpl.createdAt).toLocaleDateString("es-MX")}</span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
