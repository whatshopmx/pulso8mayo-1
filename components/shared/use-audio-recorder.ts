"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AudioRecorderState = "idle" | "recording" | "denied" | "unsupported";

interface UseAudioRecorderReturn {
  state: AudioRecorderState;
  /** Segundos transcurridos de la grabación en curso. */
  elapsed: number;
  start: () => Promise<void>;
  /** Detiene y devuelve el archivo grabado, o null si no había grabación. */
  stop: () => Promise<File | null>;
  cancel: () => void;
}

/** Elige un contenedor que el navegador sepa grabar; Safari no soporta webm. */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm", "audio/mp4", "audio/ogg"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Grabación de notas de voz con MediaRecorder.
 *
 * Un supervisor en cocina no puede producir una URL de audio: necesita grabar
 * desde la tablet. El hook se encarga del permiso, del contenedor soportado y
 * de soltar el micrófono al terminar.
 */
export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state, setState] = useState<AudioRecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Si el paso se desmonta a medio grabar, el micrófono debe quedar libre.
  useEffect(() => releaseStream, [releaseStream]);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof MediaRecorder === "undefined") {
      setState("unsupported");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start();

      setElapsed(0);
      setState("recording");
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      // getUserMedia rechaza tanto por permiso negado como por falta de micrófono.
      setState("denied");
    }
  }, []);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      releaseStream();
      setState("idle");
      return null;
    }

    const file = await new Promise<File | null>((resolve) => {
      recorder.onstop = () => {
        const chunks = chunksRef.current;
        if (chunks.length === 0) {
          resolve(null);
          return;
        }
        const type = recorder.mimeType || chunks[0]?.type || "audio/webm";
        const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        resolve(
          new File([new Blob(chunks, { type })], `nota-de-voz-${Date.now()}.${extension}`, { type })
        );
      };
      recorder.stop();
    });

    recorderRef.current = null;
    chunksRef.current = [];
    releaseStream();
    setState("idle");
    return file;
  }, [releaseStream]);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    releaseStream();
    setElapsed(0);
    setState("idle");
  }, [releaseStream]);

  return { state, elapsed, start, stop, cancel };
}
