export class ApiError extends Error {
    public statusCode: number;
    public details?: unknown;

    constructor(message: string, statusCode: number = 500, details?: unknown) {
        super(message);
        this.name = "ApiError";
        this.statusCode = statusCode;
        this.details = details;
    }

    static badRequest(message: string, details?: unknown) {
        return new ApiError(message, 400, details);
    }

    static unauthorized(message: string = "Unauthorized") {
        return new ApiError(message, 401);
    }

    static forbidden(message: string = "Forbidden", details?: unknown) {
        return new ApiError(message, 403, details);
    }

    static notFound(message: string = "Not Found", details?: unknown) {
        return new ApiError(message, 404, details);
    }

    static conflict(message: string = "Conflict", details?: unknown) {
        return new ApiError(message, 409, details);
    }

    static internal(message: string = "Internal Server Error") {
        return new ApiError(message, 500);
    }
}

/**
 * Saca el mensaje legible de un cuerpo de respuesta de la API.
 *
 * `ApiHandler.error` responde `{ success: false, error: { message, details } }`,
 * pero varias rutas antiguas mandan `error` como string. Guardar el objeto tal
 * cual en el estado y pintarlo en JSX tronaba con "Objects are not valid as a
 * React child (found: object with keys {message})" (visto en la portada de
 * finanzas, 2026-11-17); pasarlo como `description` a un toast falla igual.
 */
export function apiErrorMessage(cuerpo: unknown, fallback: string): string {
  const textos: unknown[] = [];

  if (typeof cuerpo === "object" && cuerpo !== null) {
    const { error, message } = cuerpo as { error?: unknown; message?: unknown };
    textos.push(error);
    textos.push(message);
    if (typeof error === "object" && error !== null) {
      textos.push((error as { message?: unknown }).message);
    }
  }

  for (const texto of textos) {
    if (typeof texto === "string" && texto.trim()) return texto;
  }

  return fallback;
}

/**
 * Detecta un `ApiError` sin depender de `instanceof` cruzado entre módulos.
 *
 * Turbopack/Next duplica un módulo si se importa por rutas distintas (alias
 * `@/lib/api/error` desde un route chunk vs `./error` relativo desde un chunk
 * raíz): el `instanceof` contra el `ApiError` importado localmente falla y el
 * error cae al 500 genérico (visto en T5 de plan-inventory-waste, 2026-08-11).
 * La marca estable es `statusCode` + `name`.
 *
 * El duck-typing se acota a `name === "ApiError"` y a un status HTTP de error
 * (400–599) a propósito: otras librerías (better-auth, clientes HTTP) también
 * exponen `statusCode`, y sin el filtro su mensaje interno se reflejaría al
 * cliente con su propio status en vez de caer al 500 genérico.
 */
export function isApiError(error: unknown): error is ApiError {
  if (error instanceof ApiError) return true;
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; statusCode?: unknown };
  return (
    candidate.name === "ApiError" &&
    typeof candidate.statusCode === "number" &&
    candidate.statusCode >= 400 &&
    candidate.statusCode < 600
  );
}
