/**
 * A21 — El mensaje de error de una respuesta `{ success, error }`, en texto.
 *
 * El patrón que había repetido por el módulo era
 * `data.error?.message || data.error`. Funciona cuando `error` es una cadena y
 * cuando es un objeto con `message`, pero un error **estructurado** —los de Zod,
 * por ejemplo, que traen los campos y no un `message`— cae al segundo operando,
 * entra en una plantilla de string y el usuario lee **"[object Object]"**: el
 * servidor explicó exactamente qué campo estaba mal y la pantalla lo tradujo a
 * nada.
 *
 * Sin dependencias a propósito: lo importan componentes cliente.
 */
export function mensajeDeError(data: unknown, fallback: string): string {
  const error = (data as { error?: unknown } | null | undefined)?.error;

  if (typeof error === "string" && error.trim()) return error;

  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;

    // Errores de validación: `{ campo: ["mensaje"] }` o `{ campo: "mensaje" }`.
    // Se juntan los que sean texto; si no queda ninguno, el fallback dice más
    // que un objeto serializado a medias.
    const detalles = Object.values(error as Record<string, unknown>)
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);

    if (detalles.length) return detalles.join(" · ");
  }

  return fallback;
}
