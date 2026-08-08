"use client";

import { BuilderProvider, useBuilder } from "@/components/builder/builder-context";
import { Toolbox } from "@/components/builder/toolbox";
import { Canvas } from "@/components/builder/canvas";
import { PropertyEditor } from "@/components/builder/property-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Save, Eye, Settings, Loader2, Undo2, Redo2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { WorkflowStep } from "@/components/builder/builder-context";
import { useRouter } from "next/navigation";
import { WorkflowSettingsModal } from "@/components/builder/workflow-settings-modal";
import { WorkflowPreviewModal } from "@/components/builder/workflow-preview-modal";
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

// Wrapper component to access context
function EditorHeader({ id, initialTitle, initialSettings, canEditPrivileged }: { id: string, initialTitle?: string, initialSettings?: any, canEditPrivileged: boolean }) {
    const { steps, undo, redo, canUndo, canRedo } = useBuilder();
    const [title, setTitle] = useState(initialTitle || "Flujo sin título");
    const [isSaving, setIsSaving] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [showExitDialog, setShowExitDialog] = useState(false);
    const lastSavedRef = useRef({ title: initialTitle || "Flujo sin título", steps: "" });
    const router = useRouter();

    const checkDirty = useCallback(() => {
        const stepsJson = JSON.stringify(steps);
        const saved = lastSavedRef.current;
        return title !== saved.title || stepsJson !== saved.steps;
    }, [steps, title]);

    useEffect(() => {
        setIsDirty(checkDirty());
    }, [checkDirty]);

    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (checkDirty()) {
                e.preventDefault();
                e.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [checkDirty]);

    // Idle-based autosave: saves after 3 seconds of inactivity when dirty
    const autosaveRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        if (autosaveRef.current) clearTimeout(autosaveRef.current);
        if (!isDirty) return;
        autosaveRef.current = setTimeout(() => {
            handleSave(true);
        }, 3000);
        return () => { if (autosaveRef.current) clearTimeout(autosaveRef.current); };
    }, [steps, title, isDirty]);

    // Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Shift+Z / Ctrl+Y (redo), Ctrl+S (save)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const isCtrl = e.ctrlKey || e.metaKey;
            if (!isCtrl) return;

            if (e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
                e.preventDefault();
                redo();
            } else if (e.key === 's') {
                e.preventDefault();
                if (isDirty && !isSaving) handleSave(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [undo, redo, isDirty, isSaving]);

    const handleSave = async (isAutosave = false) => {
        setIsSaving(true);
        try {
            const response = await fetch(`/api/templates/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: title,
                    steps: steps
                })
            });

            if (!response.ok) throw new Error('Failed to save');

            lastSavedRef.current = { title, steps: JSON.stringify(steps) };
            setIsDirty(false);
            if (!isAutosave) toast.success("Plantilla guardada");
        } catch (error) {
            toast.error("Error al guardar la plantilla");
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleBackClick = (e: React.MouseEvent) => {
        if (isDirty) {
            e.preventDefault();
            setShowExitDialog(true);
        }
    };

    return (
        <>
            <div className="border-b bg-background px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1">
                    <Button variant="ghost" size="icon" onClick={handleBackClick} asChild={!isDirty}>
                        {isDirty ? (
                            <span><ArrowLeft className="h-4 w-4" /></span>
                        ) : (
                            <Link href="/dashboard/builder">
                                <ArrowLeft className="h-4 w-4" />
                            </Link>
                        )}
                    </Button>
                    <div className="flex-1 max-w-md">
                        <Input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="text-lg font-semibold border-none shadow-none focus-visible:ring-0 px-2"
                            placeholder="Nombre de la Plantilla"
                        />
                        <p className="text-xs text-muted-foreground px-2">
                            {steps.length} pasos{isDirty ? ' • Sin guardar' : ' • Guardado'}
                        </p>
                    </div>
                </div>
                <div className="flex gap-1 items-center">
                    {/* Undo/Redo */}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={undo}
                        disabled={!canUndo}
                        title="Deshacer (Ctrl+Z)"
                    >
                        <Undo2 className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={redo}
                        disabled={!canRedo}
                        title="Rehacer (Ctrl+Shift+Z)"
                    >
                        <Redo2 className="h-4 w-4" />
                    </Button>

                    <div className="w-px h-6 bg-border mx-1" />

                    <Button
                        variant="outline"
                        onClick={() => setShowSettings(true)}
                    >
                        <Settings className="h-4 w-4 mr-2" />
                        Configuración
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => setShowPreview(true)}
                        disabled={steps.length === 0}
                    >
                        <Eye className="h-4 w-4 mr-2" />
                        Vista Previa
                    </Button>
                    <Button onClick={() => handleSave(false)} disabled={isSaving || !isDirty}>
                        {isSaving ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Guardando...
                            </>
                        ) : (
                            <>
                                <Save className={cn("h-4 w-4 mr-2", isDirty && "text-primary")} />
                                Guardar
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {/* Exit confirmation dialog */}
            <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Cambios sin guardar</AlertDialogTitle>
                        <AlertDialogDescription>
                            Tienes cambios sin guardar en esta plantilla. ¿Qué deseas hacer?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Seguir editando</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => router.push("/dashboard/builder")}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Salir sin guardar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <WorkflowSettingsModal
                open={showSettings}
                onClose={() => setShowSettings(false)}
                templateId={id}
                initialSettings={initialSettings}
                canEditPrivileged={canEditPrivileged}
            />

            <WorkflowPreviewModal
                open={showPreview}
                onClose={() => setShowPreview(false)}
                steps={steps}
                title={title}
            />
        </>
    );
}

interface EditorClientProps {
    id: string;
    initialSteps: WorkflowStep[];
    title?: string;
    initialSettings?: any;
    /** ADMIN+ (AD-3). Debajo de eso el servidor rechaza los campos privilegiados. */
    canEditPrivileged: boolean;
}

export default function EditorClient({ id, initialSteps, title, initialSettings, canEditPrivileged }: EditorClientProps) {
    return (
        <BuilderProvider initialSteps={initialSteps}>
            <div className="flex h-[calc(100vh-4rem)] flex-col">
                <EditorHeader id={id} initialTitle={title} initialSettings={initialSettings} canEditPrivileged={canEditPrivileged} />
                <div className="flex flex-1 overflow-hidden">
                    <Toolbox />
                    <Canvas />
                    <PropertyEditor />
                </div>
            </div>
        </BuilderProvider>
    );
}
