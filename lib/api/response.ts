import { NextResponse } from "next/server";
import { ApiError } from "./error";
import { ZodError } from "zod";

type ApiResponse<T> = {
    success: boolean;
    data?: T;
    error?: {
        message: string;
        details?: unknown;
        code?: string;
    };
};

export class ApiHandler {
    static success<T>(data: T, statusCode: number = 200) {
        return NextResponse.json(
            { success: true, data } as ApiResponse<T>,
            { status: statusCode }
        );
    }

  static error(error: unknown, statusCodeOrOptions?: number | { status: number }) {
    console.error("API Error:", error);

    // Extract status code from second argument
    let overrideStatus: number | undefined;
    if (typeof statusCodeOrOptions === 'number') {
      overrideStatus = statusCodeOrOptions;
    } else if (statusCodeOrOptions && typeof statusCodeOrOptions === 'object') {
      overrideStatus = statusCodeOrOptions.status;
    }

    if (error instanceof ApiError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: error.message,
            details: error.details,
          },
        } as ApiResponse<null>,
        { status: overrideStatus || error.statusCode }
      );
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: "Validation Error",
            details: error.flatten(),
          },
        } as ApiResponse<null>,
        { status: overrideStatus || 400 }
      );
    }

    // Drizzle envuelve el error real de Postgres como "Failed query: <SQL> params: …"
    // y deja el motivo en `cause`. Mostrar ese texto al usuario filtra el SQL (y
    // los ids de los params) y esconde lo único útil: el motivo. Devolvemos el
    // motivo y el código de Postgres; el SQL completo queda en el log de arriba.
    const dbCause = getDbCause(error);
    if (dbCause) {
      console.error("API DB cause:", dbCause.code ?? "", dbCause.message);
      return NextResponse.json(
        {
          success: false,
          error: {
            message: `Error de base de datos: ${dbCause.message}`,
            code: dbCause.code,
          },
        } as ApiResponse<null>,
        { status: overrideStatus || 500 }
      );
    }

    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      {
        success: false,
        error: {
          message: message,
        },
      } as ApiResponse<null>,
      { status: overrideStatus || 500 }
    );
  }
}

function getDbCause(error: unknown): { message: string; code?: string } | null {
  if (!(error instanceof Error) || !error.message.startsWith("Failed query:")) return null;
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    return { message: cause.message, code: (cause as Error & { code?: string }).code };
  }
  return { message: "la consulta falló sin detalle del servidor" };
}

/**
 * Helper function for success responses
 */
export function apiResponse<T>(data: T, statusCode: number = 200) {
    return ApiHandler.success(data, statusCode);
}

/**
 * Helper function for error responses
 */
export function apiError(message: string, statusCode: number = 500, details?: unknown) {
    return NextResponse.json(
        {
            success: false,
            error: {
                message,
                details,
            },
        } as ApiResponse<null>,
        { status: statusCode }
    );
}
