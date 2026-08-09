"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Play, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { ShareWorkflow } from "@/components/workflow/share-workflow";

interface Template {
    id: string;
    name?: string;
    title?: string;
    description?: string;
}

/**
 * Iniciar algo que no estaba programado.
 *
 * Vive sólo en la vista de una sucursal, donde ya se sabe contra qué sucursal
 * se ejecuta. Así desaparece el caso que antes fallaba: pulsar "Iniciar" sin
 * sucursal en contexto y enterarte por un toast después de haberte decidido.
 *
 * Es un panel que se despliega, no un diálogo: no interrumpe nada.
 */
export function OutOfScheduleLauncher({
    branchId,
    branchName,
}: {
    branchId: string;
    branchName?: string;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [templates, setTemplates] = useState<Template[] | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [search, setSearch] = useState("");
    const [startingId, setStartingId] = useState<string | null>(null);

    const loadTemplates = async () => {
        setLoadError(false);
        try {
            const res = await fetch("/api/workflow-templates");
            if (!res.ok) throw new Error();
            const data = await res.json();
            setTemplates(data.data || []);
        } catch {
            setLoadError(true);
        }
    };

    const toggle = () => {
        const next = !open;
        setOpen(next);
        // Las plantillas sólo se piden si alguien abre el panel.
        if (next && templates === null && !loadError) loadTemplates();
    };

    const start = async (templateId: string) => {
        setStartingId(templateId);
        try {
            const res = await fetch("/api/workflows/execute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ templateId, branchId }),
            });
            if (!res.ok) throw new Error();
            const execution = await res.json();
            router.push(`/dashboard/workflows/${execution.id}/execute`);
        } catch {
            toast.error("No pudimos iniciar el flujo. Vuelve a intentarlo.");
            setStartingId(null);
        }
    };

    const filtered = (templates ?? []).filter((t) =>
        (t.name || t.title || "").toLowerCase().includes(search.trim().toLowerCase())
    );

    return (
        <div className="rounded-lg border border-border">
            <Button
                variant="ghost"
                onClick={toggle}
                aria-expanded={open}
                className="w-full justify-start gap-2 h-12 px-4 font-medium"
            >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Iniciar un flujo fuera de programa
            </Button>

            {open && (
                <div className="border-t border-border p-4 space-y-3">
                    {loadError ? (
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                            <span className="text-muted-foreground">No pudimos cargar las plantillas.</span>
                            <Button variant="outline" onClick={loadTemplates}>Reintentar</Button>
                        </div>
                    ) : templates === null ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            Cargando plantillas…
                        </div>
                    ) : templates.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            Aún no hay plantillas. Créalas en el Constructor.
                        </p>
                    ) : (
                        <>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Buscar plantilla…"
                                    aria-label="Buscar plantilla"
                                    className="pl-9 h-11"
                                />
                            </div>

                            {filtered.length === 0 ? (
                                <div className="flex flex-wrap items-center gap-3 py-2 text-sm">
                                    <span className="text-muted-foreground">
                                        Ninguna plantilla coincide con «{search.trim()}».
                                    </span>
                                    <Button variant="outline" onClick={() => setSearch("")}>Limpiar búsqueda</Button>
                                </div>
                            ) : (
                                <ul className="divide-y divide-border max-h-80 overflow-y-auto">
                                    {filtered.map((t) => {
                                        const name = t.name || t.title || "Sin nombre";
                                        return (
                                            <li
                                                key={t.id}
                                                className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 min-h-[3rem]"
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => start(t.id)}
                                                    disabled={startingId !== null}
                                                    className="flex flex-1 min-w-0 items-center gap-2 py-1.5 px-1 text-left rounded hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                                                >
                                                    <span className="flex-1 min-w-0 truncate text-sm font-medium">{name}</span>
                                                    {startingId === t.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
                                                    ) : (
                                                        <Play className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                                    )}
                                                </button>
                                                {/* La ejecución se crea al compartir, no al listar. */}
                                                <ShareWorkflow
                                                    executionId={null}
                                                    templateId={t.id}
                                                    branchId={branchId}
                                                    title={name}
                                                    branchName={branchName}
                                                />
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
