# COGS — sesión real y respuestas HTTP

Continuación sobre `1e8a2f394f6c382243c84651d8efb757c1aa9fbf` más árbol local. **V3 HTTP acotada comprobada; sin aceptación del hijo ni de sus dependencias.** Cuatro archivos de código/pruebas: ruta COGS, pruebas focales existentes, `cogs-route-boundaries.test.ts` y `cogs-session-db.test.ts`. Se mantienen los cambios locales ajenos a este incremento.

## Comportamiento corregido

La ruta conserva 401/403 de `ApiError` mediante el detector compartido `isApiError`. Una asignación de sucursal ausente es 403; una persona con alcance de empresa que aún no selecciona sucursal recibe 400. La consulta valida UUID, fecha civil válida o instante ISO con zona y orden inicio≤fin antes del servicio. Los errores inesperados conservan el registro del servidor y responden un mensaje genérico, sin diagnóstico interno en el cuerpo.

El rojo unitario reprodujo **8 fallos y 1 caso correcto**: 500 para sesión/tenant rechazados; parámetros inválidos llegaban al servicio y obtenían 200; asignación ausente devolvía 400; diagnóstico interno expuesto. La primera integración reprodujo 500 en acceso anónimo; el segundo caso quedó bloqueado por resolución de `next/headers` en el plugin al invocar directamente el método API de Better Auth desde Node. El arnés final usa el handler HTTP de autenticación del producto, sin cambiar ni sustituir Better Auth.

## Qué ejecuta el arnés HTTP

Un servidor de pruebas escucha solo en loopback y puerto efímero; se cierra al terminar. `fetch` envía el POST de credenciales al handler real `auth.handler` y usa las cookies firmadas recibidas para solicitar GET COGS. El handler de reporte ejecuta los `requireTenant`/`requireAuth` reales, Better Auth, su adaptador Drizzle, servicio COGS y SQL PostgreSQL reales. Se crean dos empresas, tres sucursales, tres usuarios, cuentas de contraseña y sesiones sintéticas dentro de una transacción que termina en rollback. Se comprueba después la ausencia de usuarios, sesiones y empresas.

Solo se sustituyen el almacén de headers/cookies de Next y el acceso al objeto DB para enlazar el fixture transaccional. No se sustituyen sesiones, roles, permisos, respuestas del servicio ni resultados de consultas. Las pruebas corren en serie. La contraseña es aleatoria y se guarda usando `hashPassword` de Better Auth; cookies y credenciales no se imprimen ni persisten en archivos.

- Sin sesión: **401**, sin reporte.
- Inicio de sesión ADMIN: **200**, subtotal legado 1200, ingreso total/porcentaje null y cobertura PARTIAL.
- Sucursal de otra empresa: **403**.
- Header `x-pulso-tenant-id` con empresa ajena: **403**.
- Cookie de sesión adulterada: **401**.
- GERENTE solicita otra sucursal: **200** con la sucursal asignada y sus ventas.
- GERENTE sin sucursal asignada: **403**.

## Verificación

- `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads lib/services/__tests__/cogs-route-boundaries.test.ts lib/services/__tests__/cogs-revenue-coverage.test.ts`: **21/21, exit 0**, 11.56 s. Incluye nueve fronteras nuevas y doce casos previos.
- `NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/cogs-session-db.test.ts tests/integration/cogs-revenue-coverage-db.test.ts --maxWorkers=1 --pool=threads`: **5/5, exit 0**, 45.29 s. Dos recorridos HTTP/sesión y tres casos runtime SQL anteriores; no se suman corridas previas.
- TypeScript global: `NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' pnpm.cmd exec tsc --noEmit`, **exit 0**.
- ESLint de los cuatro archivos: **exit 0**, sin errores ni advertencias.
- `node --experimental-strip-types scripts/validate-faltantes.ts`: **exit 0**, 239 filas, 86 tareas base, 99 adicionales y 24 aceptaciones.
- `git diff --check`: **exit 0**; avisos de conversión LF/CRLF.
- El primer intento de build con heap 4096 y certificados del sistema quedó detenido en compilación y emitió fallos de conexión a Google Fonts (Geist y Geist Mono). Se interrumpió ese intento (exit 1) y se repitió `pnpm.cmd run build` fuera del sandbox con autorización; resultado final por registrar.

## Límites

La [continuación Next/Chromium](next-browser.md) añade un recorrido posterior con servidor y navegador reales. Los límites siguientes corresponden a esta suite HTTP anterior. V3 usa transporte HTTP real, con handlers del producto y sesión real, **sin servidor Next completo ni navegador**. En esta suite la conexión de base es la dueña de pruebas: el aislamiento bajo `pulso_app` se acredita por separado en los tres casos runtime, no por el POST de autenticación. No certifica pool runtime con credenciales independientes, migración 0154 aplicada de forma persistente, middleware/proxy de Next, render de pantalla con sesión real ni valoración histórica. No se ejecutó DDL nuevo ni se aplicaron migraciones. La dependencia b4b y los lectores ejecutivo/menú continúan pendientes. No cambia el total de 24 aceptaciones.
