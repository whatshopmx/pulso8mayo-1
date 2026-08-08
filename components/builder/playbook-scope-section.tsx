"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, Loader2, Store, Building2 } from "lucide-react";

type Mode = "local" | "all" | "some";

interface BranchState {
  branchId: string;
  branchName: string;
  published: boolean;
}

/**
 * Bloque "Aplicar a" del Builder — convierte una plantilla en playbook
 * corporativo y define su alcance.
 *
 * Habla con `/api/playbooks/[id]` y NO con el POST de
 * `/api/templates/[id]/settings` que usa el resto del modal: ese endpoint
 * escribe `workflow_schedules` de UNA sucursal (la del usuario) y su zod schema
 * rechaza campos desconocidos de alcance. Mezclar ambas cosas haría que guardar
 * la programación de una sucursal reescribiera el alcance del grupo.
 */
export function PlaybookScopeSection({ templateId }: { templateId: string }) {
  const [mode, setMode] = useState<Mode>("local");
  const [branches, setBranches] = useState<BranchState[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/playbooks/${templateId}`);
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        // 404 = la plantilla aún no es playbook corporativo: estado local.
        if (res.status === 404) {
          setMode("local");
          setBranches([]);
          return;
        }
        setError(json?.error?.message ?? "No se pudo cargar el alcance.");
        return;
      }

      const list: BranchState[] = json.data.branches ?? [];
      setBranches(list);

      const published = list.filter((b) => b.published);
      setSelected(new Set(published.map((b) => b.branchId)));
      // 'branch' es el default de toda plantilla; solo un scope 'company'
      // significa que alguien la publicó como playbook del grupo.
      if (json.data.scope !== "company") setMode("local");
      else setMode(published.length > 0 ? "some" : "all");
    } catch {
      setError("Error de conexión al cargar el alcance.");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleBranch = (branchId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  };

  const save = async () => {
    if (mode === "some" && selected.size === 0) {
      toast.error("Selecciona al menos una sucursal.");
      return;
    }

    setSaving(true);
    try {
      const res =
        mode === "local"
          ? await fetch(`/api/playbooks/${templateId}`, { method: "DELETE" })
          : await fetch(`/api/playbooks/${templateId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                branchIds: mode === "all" ? null : Array.from(selected),
              }),
            });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        toast.error(json?.error?.message ?? "No se pudo guardar el alcance.");
        return;
      }

      toast.success(
        mode === "local"
          ? "Plantilla local: ya no es un playbook del grupo."
          : mode === "all"
            ? "Publicado en todas las sucursales."
            : `Publicado en ${selected.size} sucursal(es).`,
      );
      await load();
    } catch {
      toast.error("Error de conexión al guardar el alcance.");
    } finally {
      setSaving(false);
    }
  };

  const options: { value: Mode; icon: typeof Globe; title: string; desc: string }[] = [
    {
      value: "local",
      icon: Store,
      title: "Plantilla local",
      desc: "No es un playbook del grupo.",
    },
    {
      value: "all",
      icon: Globe,
      title: "Todas las sucursales",
      desc: "Playbook corporativo vigente en todo el grupo.",
    },
    {
      value: "some",
      icon: Building2,
      title: "Sucursales específicas",
      desc: "Solo las sucursales que elijas lo verán.",
    },
  ];

  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex items-center gap-2">
        <Globe className="h-5 w-5 text-muted-foreground" />
        <h3 className="font-semibold">Aplicar a</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Define una vez en el grupo y publica a las sucursales que deben ejecutarlo.
      </p>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {error}
          <Button variant="ghost" size="sm" className="ml-2 h-6" onClick={load}>
            Reintentar
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-2">
            {options.map((opt) => {
              const Icon = opt.icon;
              const active = mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  aria-pressed={active}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    active ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{opt.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {opt.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {mode === "some" && (
            <div className="space-y-2">
              <Label className="text-xs">Sucursales</Label>
              {branches.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No hay sucursales activas en el grupo.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {branches.map((b) => (
                    <button
                      key={b.branchId}
                      type="button"
                      onClick={() => toggleBranch(b.branchId)}
                      aria-pressed={selected.has(b.branchId)}
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        selected.has(b.branchId)
                          ? "bg-primary text-primary-foreground"
                          : "bg-background"
                      }`}
                    >
                      {b.branchName}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {selected.size} de {branches.length} seleccionadas
              </p>
            </div>
          )}

          {mode === "all" && branches.length > 0 && (
            <Badge variant="secondary">
              Vigente en las {branches.length} sucursales del grupo
            </Badge>
          )}

          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Guardar alcance
          </Button>
        </>
      )}
    </div>
  );
}
