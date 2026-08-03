'use client';

import { useState, useTransition } from "react";
import { markAsReadAction } from "./actions";

interface ClientAnnouncementViewProps {
  announcement: {
    id: string;
    title: string;
    content: string;
    communicationType: string;
    sentAt: string | null;
  };
  user: {
    id: string;
    name: string;
  };
  initialReadReceipt: {
    id: string;
    readAt: string;
  } | null;
}

export default function ClientAnnouncementView({
  announcement,
  user,
  initialReadReceipt,
}: ClientAnnouncementViewProps) {
  const [readReceipt, setReadReceipt] = useState<{ readAt: string } | null>(
    initialReadReceipt
      ? { readAt: initialReadReceipt.readAt }
      : null
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleConfirmRead = () => {
    setError(null);
    startTransition(async () => {
      const result = await markAsReadAction(user.id, announcement.id);
      if (result.success) {
        setReadReceipt({ readAt: result.readAt ? result.readAt.toISOString() : new Date().toISOString() });
      } else {
        setError(result.error || "Ocurrió un error inesperado al confirmar la lectura.");
      }
    });
  };

  const paragraphs = announcement.content
    .split("\n\n")
    .map((p) => p.trim())
    .filter(Boolean);

  const formattedDate = announcement.sentAt
    ? new Date(announcement.sentAt).toLocaleDateString("es-MX", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "Hoy";

  const typeLabel = {
    MESSAGE: "Mensaje",
    ANNOUNCEMENT: "Anuncio Oficial",
    NOTIFICATION: "Notificación",
    POLICY: "Nueva Política",
  }[announcement.communicationType] || "Comunicación";

  return (
    <div className="w-full max-w-2xl bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 md:p-10 shadow-2xl relative overflow-hidden flex flex-col space-y-6">
      {/* Background ambient light */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Meta info */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
          {typeLabel}
        </span>
        <span className="text-xs text-slate-400">{formattedDate}</span>
      </div>

      {/* Title */}
      <h1 className="text-2xl md:text-3xl font-extrabold text-slate-100 tracking-tight leading-tight">
        {announcement.title}
      </h1>

      {/* Divider */}
      <div className="h-[1px] bg-slate-800/80 w-full" />

      {/* Content */}
      <div className="space-y-4 text-slate-300 leading-relaxed text-sm md:text-base">
        {paragraphs.map((para, idx) => (
          <p key={idx} className="whitespace-pre-line">
            {para}
          </p>
        ))}
      </div>

      {/* Divider */}
      <div className="h-[1px] bg-slate-800/80 w-full" />

      {/* Confirmation section */}
      <div className="pt-2">
        {readReceipt ? (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 flex items-start space-x-3 text-emerald-400">
            <span className="text-emerald-500 text-xl mt-0.5">✓</span>
            <div className="space-y-1">
              <p className="font-semibold text-slate-200">Lectura Confirmada</p>
              <p className="text-xs text-slate-400">
                Hola {user.name}, has confirmado la lectura de esta comunicación el{" "}
                {new Date(readReceipt.readAt).toLocaleString("es-MX", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-slate-400 text-center md:text-left">
              Hola <span className="font-semibold text-slate-200">{user.name}</span>, por favor lee
              detalladamente este anuncio y confirma tu lectura.
            </p>

            <button
              onClick={handleConfirmRead}
              disabled={isPending}
              className={`w-full py-4 px-6 rounded-2xl font-bold tracking-wide transition-all duration-300 flex items-center justify-center space-x-2 border shadow-lg ${
                isPending
                  ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-500 border-indigo-500/50 hover:border-indigo-400 text-white cursor-pointer active:scale-[0.98] hover:shadow-indigo-500/10"
              }`}
            >
              {isPending ? (
                <>
                  <span className="animate-spin rounded-full h-4 w-4 border-2 border-slate-500 border-t-slate-200" />
                  <span>Confirmando lectura...</span>
                </>
              ) : (
                <span>Confirmar Lectura Obligatoria</span>
              )}
            </button>

            {error && (
              <p className="text-xs font-semibold text-red-500 text-center">{error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
