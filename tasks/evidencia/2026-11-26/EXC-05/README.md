# Evidencia de aceptación — `EXC-05` (Conectar acciones canónicas en la UI)

- **Fecha:** 2026-11-26
- **Base Git (`HEAD`):** `8d8b3f7979aae74af766cd62cfd0a21ad8f5f233` (+ cambios locales de `EXC-03.a`, `EXC-03.b` y `EXC-05`)
- **Ticket:** `EXC-05` — *Conectar acciones canónicas en la UI* (`I / M`, depende de `EXC-02, EXC-03.a`, verificación `V3`).
- **Estado:** `aceptado` en entorno aislado (`V3`).

## Cambios implementados

1. **Capacidades y contrato UI puros (`lib/services/exception-ui-capabilities.ts`):**
   - `canMutateExceptionsRole(role)` alinea el cliente con RBAC del servidor (`SUPER_ADMIN`, `OWNER`, `ADMIN`, `GERENTE`, `SUPERVISOR` pueden mutar; `EMPLEADO`/`READONLY` solo lectura).
   - `resolveCanonicalTarget(item)` resuelve tanto filas nativas `source: "canonical"` como filas del feed legacy que exponen proyección `canonical` (`EXC-02`).
   - `computeExceptionUiCapabilities(...)` refleja acciones habilitadas según `allowedEvents`, rol de sesión y segregación de funciones (`resolvedBy === currentUserId` bloquea `"Verificar"` con motivo explícito `"Requiere otro verificador"`).
   - `resolveLegacyFeedLinkLabel(item)` garantiza que filas legacy sin registro canónico nunca se etiqueten como `"Resolver"` ni acrediten mutación inexistente (muestra `"Ver en módulo"`).
2. **Propagación de `expectedStatus` en las 8 rutas canónicas y proyección `resolvedBy`:**
   - `lib/api/exception-route.ts` exporta `expectedStatusSchema`.
   - `app/api/exceptions/[id]/{assign,start-action,resolve,verify,close,reopen,escalate,cancel}/route.ts` validan sesión/permisos (`requireExceptionAction`), aceptan `expectedStatus` opcional y lo pasan a `ExceptionService.*` para detectar carreras con `409 Conflict`.
   - `lib/services/group-exceptions-service.ts` expone `resolvedBy` en `canonical` y `lifecycle` cuando existe para que la UI aplique la segregación antes del envío.
3. **UI conectada (`components/exceptions/exception-lifecycle-actions.tsx` y `app/dashboard/exceptions/page.tsx`):**
   - `submitExceptionLifecycleAction` envía `expectedStatus: lifecycle.status` contra `/api/exceptions/{id}/{assign|start-action|resolve|verify|close|reopen}` y devuelve `{ ok: false, isConflict: true, error }` ante `409`.
   - `ExceptionLifecycleActions` oculta controles mutables a usuarios sin permiso (`"Solo lectura"`), deshabilita `"Verificar"` si el usuario actual fue quien resolvió y renderiza alerta inline (`role="alert"`) ante `409 Conflict` refrescando la lista (`onDone()`).
   - `app/dashboard/exceptions/page.tsx` lee la sesión (`useSession()`), muestra `<ExceptionLifecycleActions />` para toda fila con destino canónico (nativa o proyectada desde legacy) y marca explícitamente `"Solo enlace (sin acción canónica)"` + `"Ver en módulo"` cuando no existe registro canónico.

## Verificación ejecutada

| Tipo | Comando | Resultado |
|---|---|---|
| V3 HTTP/UI + regresiones de excepciones | `node node_modules/vitest/vitest.mjs run tests/unit/exceptions/exc05-canonical-ui-actions-v3.test.ts lib/services/__tests__/group-exceptions-canonical.test.ts lib/services/__tests__/exception-service.test.ts` | **PASS (22/22)** — 6 rutas canónicas autorizadas (`assign`, `start-action`, `resolve`, `verify`, `close`, `reopen`), propagación de `expectedStatus`, `403` sin permiso, `409` en conflicto concurrente, capacidades por rol y segregación `resolvedBy`, y feed legacy sin acción inexistente (`"Ver en módulo"`). |
| ESLint | `node node_modules/eslint/bin/eslint.js lib/services/exception-ui-capabilities.ts lib/api/exception-route.ts lib/services/group-exceptions-service.ts app/api/exceptions/[id]/assign/route.ts app/api/exceptions/[id]/start-action/route.ts app/api/exceptions/[id]/resolve/route.ts app/api/exceptions/[id]/verify/route.ts app/api/exceptions/[id]/close/route.ts app/api/exceptions/[id]/reopen/route.ts app/api/exceptions/[id]/escalate/route.ts app/api/exceptions/[id]/cancel/route.ts app/dashboard/exceptions/page.tsx components/exceptions/exception-lifecycle-actions.tsx tests/unit/exceptions/exc05-canonical-ui-actions-v3.test.ts` | **PASS (0 errors, 3 warnings preexistentes en `group-exceptions-service.ts`)** |

## Límites explícitos

- La verificación V3 ejercita los handlers HTTP reales de las 6 acciones canónicas, el cliente `submitExceptionLifecycleAction` con `fetch` instrumentado y las funciones puras de capacidades/etiquetas de UI; no abre navegador Playwright contra un servidor Next operativo ni aplica migraciones en producción (`OPS-03`).
- El cierre funcional de filas `05.*` de la matriz permanece reservado a `VAL-01` / `VAL-03`.
