# Menú y ejecutivo: aceptación visual con Next y sesión reales

Base de este incremento: `d89a497` más diff local. Prueba en curso, sin aceptación de tickets ni padres. Alcance: dos pantallas, `tests/integration/cogs-next-browser.test.ts`, configuración de salida aislada en `next.config.ts` y ajuste responsive de `BranchScopeControl` (cinco archivos).

El arnés inicia Next dev en loopback y Chromium, con Better Auth y Postgres reales de `.env.test`, sin mocks de sesión/API/SQL. Comprueba host distinto del operativo antes de escribir. Crea únicamente empresas/sucursales/venta/receta/cuenta sintéticas, confirma esos fixtures para que Next pueda verlos y los elimina al terminar; sin revisiones canónicas append-only ni migración persistente. La V2 con rol runtime sigue siendo evidencia separada.

Casos fijados: ingreso parcial sin total/margen firmes, período vacío, selector de vista accesible, dos sucursales propias y una ajena, filtro sucursal→consolidado, sesión expirada sin presentar respuesta vieja como actual, recuperación después de login, ausencia de errores JS y controles visibles en móvil. Se conserva el recorrido de COGS como regresión.

## Diagnóstico del arnés

Primer intento: 1/3 (COGS); menú reprodujo falta de nombre accesible en el calendario; ejecutivo quedó antes en timeout de login al compilar en frío. Se añade timeout de 90 s solo para ese POST, sin sustituir autenticación ni omitir aserciones.

El precheck de existencia de `.next/dev/lock` confundía archivo con liveness. Se retiró: Next 16.1.6 administra su bloqueo nativo (`node_modules/next/dist/build/lockfile.js`). Un intento posterior confirmó bloqueo real y salió con exit 1, sin borrar el archivo ni detener otra instancia. Para evitar competir con el directorio ajeno, `PULSO_REPORT_BROWSER_TEST=1` usa `.tmp/next-report-browser` y `.tmp/report-browser-tsconfig.json`, heredando el tsconfig raíz sin editarlo. Sin la bandera la configuración normal se conserva. El log de la instancia propia queda en `.tmp/cogs-next-server.log`; stdout registra solo PID/URL, sin credenciales.

## RED funcional y correcciones

El primer recorrido completo aislado dio 1/3: COGS pasó; ejecutivo perdió el selector al filtrar a una sola sucursal y menú continuó presentando «sin ventas» después de 401. Se conservan opciones del catálogo independiente del resultado filtrado, se vacían datos al iniciar lectura y se muestran errores con `role=alert` y recuperación mediante actualización. Inputs/selects se bloquean durante carga: evita perder cambios antes de hidratar. La prueba verifica fechas enviadas y período de respuesta; la tarjeta COGS ejecutiva muestra el período aplicado, no las entradas de borrador.

El siguiente recorrido pasó datos parciales/vacíos, sucursal→consolidado, rango inverso 400, logout 401 y recuperación con nuevo login; terminó 1/3 por desbordamiento móvil de ambas pantallas. Capturas mostraron ancho 544 con viewport 390 causado por el control global de sucursal/fecha. Se compactan sus rótulos en móvil, conservando aria-label completo y acceso a menús; las acciones locales permiten wrap. Nueva verificación en curso, sin rebajar la aserción de ancho.

## GREEN comprobada

`NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' RUN_COGS_NEXT_BROWSER=1 pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/cogs-next-browser.test.ts --maxWorkers=1 --pool=threads`: **3/3, exit 0**, 158.25 s. Dos recorridos nuevos y regresión COGS, sin saltos; cubren API 401/400/403, Next/Better Auth/DB reales, parcial/vacío, selector sucursal→grupo, errores y recuperación 400/401, ausencia de pageerror hasta recuperación y ancho real 390 sin desbordamiento global. Capturas de escritorio 1440 y móvil 390 revisadas. El log de dev advierte fallback al descargar Geist; no se acredita fidelidad tipográfica con esa captura.

`NODE_OPTIONS='--max-old-space-size=4096' pnpm.cmd exec tsc --noEmit`: exit 0. ESLint focal de cinco archivos: exit 0, seis advertencias previas (hooks manuales, imports y any del tooltip).

Después de ese 3/3 se añade verificación de teclado (Tab entre calendarios/botón, Enter/Escape en menús móviles; sucursal ajena ausente). Su reintento focal `-t partial/empty` está en curso; el primer intento de filtro con pipe fue rechazado por cmd antes de iniciar Vitest y no cuenta como ejecución. Build final también en curso. No se declara aprobación por saltarse un caso ni por éxito parcial del archivo.

Actualización 2026-11-19: la corrida completa sobre `ea764e8` pasó **3/3,
exit 0, 160.15 s**, incluidos los pasos de teclado anteriores. El estado
«en curso» del párrafo anterior es histórico. La
[continuación y corrección del selector](../../2026-11-19/INV-01.b4.coverage.executive/README.md)
registra los gates nuevos sin aceptar padres ni desplegar migraciones.
