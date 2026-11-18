# COGS — Next, Chromium y sesión real

Continuación sobre HEAD `1e8a2f394f6c382243c84651d8efb757c1aa9fbf` más árbol local compartido. Alcance: un archivo nuevo de prueba, `tests/integration/cogs-next-browser.test.ts`. No cambia código del producto ni aplica migraciones. **Sin nueva aceptación del hijo ni de sus dependencias.**

## Recorrido y aislamiento

El arnés inicia el CLI real de Next en desarrollo, en loopback y puerto efímero. Comprueba previamente que el host Neon de `TEST_DATABASE_URL` difiere de la conexión operativa de `.env`, normalizando `-pooler`. Se niega a arrancar si ya existe un servidor Next de desarrollo; al terminar cierra Chromium y únicamente el árbol de procesos creado por esta prueba.

Crea dos empresas, dos sucursales, una receta, una venta legada, un usuario ADMIN y su cuenta de contraseña aleatoria. Los fixtures se confirman en la base aislada para que el proceso independiente de Next pueda leerlos; **no están en rollback**. `afterAll` elimina exclusivamente las claves sintéticas y comprueba que no quedan empresas ni sesiones. La venta legada no crea revisiones append-only. No ejecuta DDL ni modifica permisos. Redis y entrega de correo/WhatsApp quedan sin credenciales en el proceso hijo.

Chromium recibe la cookie firmada del POST real de Better Auth usando su contexto HTTP compartido con el navegador. No se reemplazan auth, headers/cookies de Next, DB, proxy, API ni componentes. El reporte usa la conexión dueña de la base aislada; la evidencia con rol `pulso_app` continúa en [runtime.md](runtime.md), por separado.

Casos:

- Anónimo: GET COGS devuelve 401.
- Credenciales sintéticas: inicio de sesión 200; COGS devuelve subtotal 1200, total y porcentaje null, cobertura PARTIAL.
- Sucursal de otra empresa y header de tenant ajeno: 403.
- Dashboard completo: pestaña COGS, fechas civiles, aviso de subtotal $12.00 y tarjetas de ventas/porcentaje con “—”.
- Periodo vacío: aviso “Sin ventas registradas en el periodo”.
- Sin excepciones JavaScript capturadas por `pageerror`.
- Cierre de sesión real y posterior GET sin acceso.

## Ejecución

```powershell
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
$env:RUN_COGS_NEXT_BROWSER='1'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/cogs-next-browser.test.ts --maxWorkers=1 --pool=threads
```

La variable de opt-in evita iniciar Next o confirmar fixtures al ejecutar la suite de integración habitual. La captura parcial se escribe en `.tmp/cogs-next-partial.png`.

El primer intento agotó la espera de arranque porque el arnés esperaba 200 en la ruta de sesión anónima; el producto devuelve 401. El segundo alcanzó todas las aserciones API/pantalla y falló al cerrar sesión: la petición de prueba omitía el JSON requerido y recibió 415. Se corrigieron ambos defectos del arnés. No se cuentan como fallos funcionales del producto ni como corridas exitosas.

Resultado final: **1/1, exit 0**, 97.51 s. Un único caso automatizado integra las fronteras HTTP, los dos estados de pantalla y el cierre de sesión; no equivale a varios casos independientes. El hook de limpieza también pasó.

Verificación complementaria en este árbol:

- Focal COGS/fronteras/trazabilidad: **32/32**, tres archivos, exit 0 (12.51 s). No sumar a las corridas anteriores como casos nuevos.
- `NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' pnpm.cmd exec tsc --noEmit`: **exit 0**. El tsconfig global excluye pruebas; Vitest ejecuta el archivo nuevo y ESLint lo revisa.
- `pnpm.cmd exec eslint tests/integration/cogs-next-browser.test.ts`: **exit 0**, sin advertencias.
- Integridad final: `node --experimental-strip-types scripts/validate-faltantes.ts`, **exit 0**, 239 filas, 86 tareas base, 99 hijos y 24 aceptaciones, cero errores. `git diff --check`: **exit 0**, con avisos LF/CRLF del árbol compartido. Sin lock de Next dev al terminar.
- Captura de la ejecución final: [Next completo, cobertura parcial](next-partial-desktop.png). Revisada visualmente: subtotal $12.00, ventas/porcentaje ausentes, sin semáforo verde. La receta del fixture no tiene ingredientes; el costo $0.00 de esta captura no es un oráculo de costos (el oráculo está en la suite runtime).

No se repite ni acredita build de producción en este incremento de pruebas/documentación. El build global anterior continúa pendiente de resultado reproducible.

## Límites

Es Next en desarrollo con conexión dueña de pruebas, no build de producción ni conexión runtime autenticada independiente. Este recorrido cubre parcial y vacío; completo positivo y cero explícito conservan la evidencia de las suites anteriores, sin atribuirles navegador integrado. No certifica valoración histórica, volumen operativo, móvil ni ausencia de advertencias de consola. Pendientes: dependencia b4b, migración 0154 persistente, build global y aceptación integrada. Se mantienen 24 aceptaciones.
