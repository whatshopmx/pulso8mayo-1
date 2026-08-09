"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";

interface ShareWorkflowProps {
    /** Ejecución existente. Si es null se crea al compartir. */
    executionId: string | null;
    templateId: string;
    branchId: string;
    /** Nombre del flujo, para redactar el mensaje. */
    title: string;
    branchName?: string;
    assignee?: { name: string | null; whatsappPhone: string | null } | null;
}

/** Deja sólo dígitos; wa.me no acepta espacios, guiones ni paréntesis. */
function toWaNumber(phone: string | null | undefined): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return null;
    // 10 dígitos = número nacional sin lada de país: anteponemos México.
    return digits.length === 10 ? `52${digits}` : digits;
}

/**
 * Compartir un flujo por WhatsApp mediante smart link.
 *
 * Panel desplegable, no diálogo: antes esto era un modal dentro de otro modal.
 * El enlace se genera al abrir, sin pedir un clic extra de "generar".
 *
 * Si la fila ya tiene ejecución (el cron la creó al llegar su hora) no se
 * escribe nada nuevo. Sólo se crea una ejecución cuando aún no existe, y
 * únicamente al momento de compartir — nunca por abrir el panel.
 */
export function ShareWorkflow({
    executionId,
    templateId,
    branchId,
    title,
    branchName,
    assignee,
}: ShareWorkflowProps) {
    const [open, setOpen] = useState(false);
    const [link, setLink] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [copied, setCopied] = useState(false);

    const waNumber = toWaNumber(assignee?.whatsappPhone);

    const buildLink = async () => {
        setLoading(true);
        setFailed(false);
        try {
            let instanceId = executionId;

            // Sólo aquí, y sólo si hace falta: compartir es el compromiso.
            if (!instanceId) {
                const res = await fetch("/api/workflows/execute", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ templateId, branchId }),
                });
                if (!res.ok) throw new Error();
                instanceId = (await res.json()).id;
            }

            const res = await fetch("/api/smart-links/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ instanceId, templateId, expiresInMinutes: 1440 }),
            });
            if (!res.ok) throw new Error();
            setLink((await res.json()).url);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next && !link && !loading) buildLink();
    };

    const copy = async () => {
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error("No pudimos copiar el enlace. Selecciónalo y cópialo a mano.");
        }
    };

    const sendWhatsApp = () => {
        if (!link) return;
        const where = branchName ? ` en ${branchName}` : "";
        const message = `Hola${assignee?.name ? ` ${assignee.name}` : ""}: te toca «${title}»${where}. Ábrelo aquí y complétalo desde tu teléfono: ${link}\n\nEl enlace vence en 24 horas.`;
        const base = waNumber ? `https://wa.me/${waNumber}` : "https://wa.me/";
        window.open(`${base}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    };

    // `contents` disuelve este envoltorio: el disparador queda como un elemento
    // más de la fila flex, y el panel puede tomar su propio renglón completo sin
    // que el botón salte de sitio al abrirse.
    return (
        <div className="contents">
            <Button
                variant="ghost"
                onClick={toggle}
                aria-expanded={open}
                className="gap-2 h-11 shrink-0"
            >
                <Send className="h-4 w-4" aria-hidden="true" />
                Compartir
            </Button>

            {open && (
                <div className="w-full order-last rounded-lg border border-border p-3 space-y-3">
                    {loading ? (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            Generando enlace…
                        </p>
                    ) : failed ? (
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="text-sm text-muted-foreground">
                                No pudimos generar el enlace.
                            </span>
                            <Button variant="outline" onClick={buildLink}>Reintentar</Button>
                        </div>
                    ) : link ? (
                        <>
                            <div className="flex items-center gap-2">
                                <Input value={link} readOnly aria-label="Enlace del flujo" className="h-11 font-mono text-xs" />
                                <Button
                                    variant="secondary"
                                    size="icon"
                                    onClick={copy}
                                    aria-label={copied ? "Enlace copiado" : "Copiar enlace"}
                                    className="h-11 w-11 shrink-0"
                                >
                                    {copied
                                        ? <Check className="h-4 w-4" aria-hidden="true" />
                                        : <Copy className="h-4 w-4" aria-hidden="true" />}
                                </Button>
                            </div>

                            <Button onClick={sendWhatsApp} className="w-full h-11 gap-2">
                                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                                {waNumber && assignee?.name
                                    ? `Enviar a ${assignee.name}`
                                    : "Enviar por WhatsApp"}
                            </Button>

                            <p className="text-xs text-muted-foreground">
                                {waNumber
                                    ? "Vence en 24 horas."
                                    : "Vence en 24 horas. Elegirás el contacto en WhatsApp."}
                            </p>
                        </>
                    ) : null}
                </div>
            )}
        </div>
    );
}
