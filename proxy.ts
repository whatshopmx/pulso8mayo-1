import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, createRateLimitHeaders } from "./lib/rate-limiter";
import { getSessionCookie } from "better-auth/cookies";
import { hasAccess, getDefaultDashboard } from './lib/rbac/permissions';
import { createChildLogger } from './lib/logger';

const logger = createChildLogger('proxy');
const isDev = process.env.NODE_ENV === 'development';

/**
 * RBAC-01: una ruta negada responde 403, no un redirect.
 *
 * Redirigir al panel por defecto hacía que el rechazo pareciera un enlace roto:
 * el usuario pulsaba "Iniciar" y aterrizaba en otra pantalla sin explicación.
 * Este HTML mínimo conserva el status real y ofrece la salida al panel propio.
 */
function forbiddenResponse(defaultPath: string): NextResponse {
    const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>403 · Acceso denegado</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fafafa;color:#111827;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
<main style="max-width:26rem;padding:2rem;text-align:center">
<p style="margin:0 0 .5rem;font-size:.75rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">403 · Acceso denegado</p>
<h1 style="margin:0 0 .5rem;font-size:1.25rem">Tu rol no puede abrir esta página</h1>
<p style="margin:0 0 1.5rem;font-size:.875rem;line-height:1.5;color:#4b5563">La ruta existe, pero está reservada a otros roles. No se te redirige para no ocultar el rechazo.</p>
<a href="${defaultPath}" style="display:inline-block;padding:.5rem 1rem;border-radius:.5rem;background:#111827;color:#fff;font-size:.875rem;text-decoration:none">Volver a mi panel</a>
</main>
</body>
</html>`;

    return new NextResponse(html, {
        status: 403,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

async function verifySession(request: NextRequest) {
  const cookie = request.headers.get("cookie") || "";

  try {
    if (isDev) {
      logger.debug("Verifying session via /api/auth/get-session...");
    }

    const response = await fetch(`${request.nextUrl.origin}/api/auth/get-session`, {
      headers: {
        cookie,
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
      },
      cache: "no-store",
    });

    if (!response.ok) {
      if (isDev) {
        logger.debug({ status: response.status }, "Session verification failed");
      }
      return null;
    }

    const data = await response.json();
    if (isDev) {
      logger.debug({
        hasSession: !!data,
        userId: data?.user?.id,
        companyId: data?.user?.companyId,
        branchId: data?.user?.branchId
      }, "Session verification result");
    }

    return data;
  } catch (error) {
    logger.error({ error }, "Session verification failed");
    return null;
  }
}

export async function proxy(request: NextRequest) {
    const isApiRoute = request.nextUrl.pathname.startsWith("/api");
    const isDashboardRoute = request.nextUrl.pathname.startsWith("/dashboard");
    const isOnboardingRoute = request.nextUrl.pathname.startsWith("/onboarding");
    const isAuthRoute = request.nextUrl.pathname.startsWith("/sign-in") || 
                        request.nextUrl.pathname.startsWith("/sign-up");

    if (isApiRoute && !request.nextUrl.pathname.startsWith("/api/auth")) {
        const authData = await verifySession(request);

        const identifier = authData?.user?.id ||
            request.headers.get("x-forwarded-for")?.split(",")[0] ||
            "anonymous";

        const rateLimitResult = await checkRateLimit(identifier, request.nextUrl.pathname);
        const { headers: rateLimitHeaders, shouldBlock, retryAfter } = createRateLimitHeaders(rateLimitResult);

        if (shouldBlock) {
          logger.warn({
            identifier,
            path: request.nextUrl.pathname,
            retryAfter
          }, "Rate limit exceeded");

            return new NextResponse(
                JSON.stringify({
                    error: "Too Many Requests",
                    message: "Rate limit exceeded. Please try again later.",
                    retryAfter: retryAfter,
                }),
                {
                    status: 429,
                    headers: {
                        ...rateLimitHeaders,
                        "Content-Type": "application/json",
                    },
                }
            );
        }

        const responseHeaders = new Headers(request.headers);
        Object.entries(rateLimitHeaders).forEach(([key, value]) => {
            responseHeaders.set(key, value);
        });

        return NextResponse.next({
            request: {
                headers: responseHeaders,
            },
        });
    }

    if (isDashboardRoute || isOnboardingRoute) {
        const sessionCookie = getSessionCookie(request);

        let authData = null;
        
    if (!sessionCookie) {
      authData = await verifySession(request);
    } else {
      try {
        authData = await verifySession(request);
      } catch (error) {
        if (isDev) {
          logger.debug({ error }, "Session verification error, allowing with cookie");
        }
      }
    }

        if (!authData && !sessionCookie) {
            const redirectUrl = new URL("/sign-in", request.url);
            redirectUrl.searchParams.set("callbackUrl", request.nextUrl.pathname);
            return NextResponse.redirect(redirectUrl);
        }

    if (authData) {
      const user = authData.user;
      const isOnboarding = request.nextUrl.pathname.startsWith("/onboarding");

      if (isDev) {
        logger.debug({
          path: request.nextUrl.pathname,
          userEmail: user.email,
          companyId: user.companyId
        }, "Request authorized");
      }

      if (!user.companyId && !isOnboarding) {
        logger.info({ userId: user.id }, "Redirecting unassigned user to onboarding");
        return NextResponse.redirect(new URL("/onboarding", request.url));
      }

      if (user.companyId && isOnboarding) {
        logger.info({ userId: user.id }, "Redirecting assigned user from onboarding to dashboard");
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }

      const userRole = (user.role || 'EMPLEADO') as 'SUPER_ADMIN' | 'ADMIN' | 'GERENTE' | 'SUPERVISOR' | 'EMPLEADO' | 'READONLY';
      const requestedPath = request.nextUrl.pathname;

      if (!requestedPath.startsWith('/api') && !requestedPath.startsWith('/join')) {
        if (!hasAccess(userRole, requestedPath)) {
          logger.warn({ userRole, path: requestedPath }, "Access denied by RBAC");
                    const defaultPath = getDefaultDashboard(userRole);
                    return forbiddenResponse(defaultPath);
                }
            }

            const headers = new Headers(request.headers);
            headers.set("x-user-id", user.id);

            if (user.companyId) {
                headers.set("x-pulso-tenant-id", user.companyId);
            }

            return NextResponse.next({
                request: {
                    headers
                }
            });
        }

        return NextResponse.next();
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/dashboard/:path*", "/api/:path*", "/onboarding"],
};