"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { BookOpen, Globe, Building2, Pencil, ChevronDown, ChevronRight } from "lucide-react";

interface Playbook {
  id: string;
  name: string | null;
  description: string | null;
  category: string | null;
  version: number;
  active: boolean;
  appliesToAllBranches: boolean;
  publishedBranchCount: number;
  totalBranchCount: number;
}

interface BranchState {
  branchId: string;
  branchName: string;
  published: boolean;
  version: number | null;
  publishedAt: string | null;
}

export function PlaybookList() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, BranchState[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/playbooks");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.error?.message ?? "No se pudieron cargar los playbooks.");
        return;
      }
      setPlaybooks(json.data.playbooks ?? []);
    } catch {
      setError("Error de conexión al cargar los playbooks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (detail[id]) return;

    const res = await fetch(`/api/playbooks/${id}`);
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) {
      setDetail((prev) => ({ ...prev, [id]: json.data.branches ?? [] }));
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 space-y-3">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (playbooks.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Aún no hay playbooks del grupo"
        description="Abre una plantilla en el Builder, entra a Configuración del Flujo y elige 'Aplicar a → Todas las sucursales' o 'Sucursales específicas'."
      />
    );
  }

  return (
    <div className="space-y-3">
      {playbooks.map((p) => {
        const isOpen = expanded === p.id;
        const branchStates = detail[p.id];
        return (
          <Card key={p.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    {p.name ?? "Sin nombre"}
                    <Badge variant="outline">v{p.version}</Badge>
                    {!p.active && <Badge variant="secondary">Inactivo</Badge>}
                  </CardTitle>
                  <CardDescription className="line-clamp-2">
                    {p.description || p.category || "Playbook corporativo"}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {p.appliesToAllBranches ? (
                    <Badge className="gap-1">
                      <Globe className="h-3 w-3" />
                      Todas ({p.totalBranchCount})
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1">
                      <Building2 className="h-3 w-3" />
                      {p.publishedBranchCount} de {p.totalBranchCount}
                    </Badge>
                  )}
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/dashboard/builder/editor/${p.id}`}>
                      <Pencil className="h-4 w-4 mr-1" />
                      Editar
                    </Link>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 -ml-2"
                onClick={() => toggle(p.id)}
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 mr-1" />
                ) : (
                  <ChevronRight className="h-4 w-4 mr-1" />
                )}
                Estado por sucursal
              </Button>

              {isOpen && (
                <div className="mt-3">
                  {!branchStates ? (
                    <Skeleton className="h-16 w-full" />
                  ) : branchStates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No hay sucursales activas.
                    </p>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {branchStates.map((b) => {
                        // Sin publicaciones el playbook aplica a todo el grupo,
                        // así que cada sucursal cuenta como vigente.
                        const on = p.appliesToAllBranches || b.published;
                        return (
                          <li
                            key={b.branchId}
                            className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                          >
                            <span className="truncate">{b.branchName}</span>
                            <Badge variant={on ? "default" : "outline"} className="shrink-0">
                              {on ? "Vigente" : "No publicado"}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
