# Cobertura ejecutiva: recuperar una consulta fallida

Base: `ea764e83ce5484eeefd31caaa3e9ba36bc75bf0d`, árbol limpio al iniciar.
Continuación de `INV-01.b4.coverage.executive` y de su
[recorrido de navegador](../../2026-11-18/INV-01.b4.coverage.executive/next-browser.md).

La verificación inicial del archivo completo `cogs-next-browser.test.ts`
pasó **3/3, exit 0, 160.15 s**: ejecutivo, menú y regresión COGS. Incluye
los pasos de teclado que la evidencia anterior había dejado en curso,
con Tab entre fechas y actualización y Enter/Escape en los menús móviles.

Se amplía el caso ejecutivo: después de un rango inverso (400), el selector
de sucursal debe seguir disponible para corregir la consulta. El contrato
conserva el ocultamiento del selector ante pérdida de sesión/permisos
(401/403), sin mostrar un reporte anterior como vigente.

El arnés usa Next dev, Chromium, Better Auth y Postgres reales, sin mocks de
API, sesión o SQL. Comprueba host distinto al operativo antes de crear
fixtures sintéticos confirmados; los elimina y verifica su ausencia al
terminar. La conexión es dueña: RLS runtime y migraciones candidatas se
acreditan por separado; esta prueba no los despliega ni acepta los padres.

RED: ejecución focal `-t 'executive partial/empty'`, **exit 1, un caso fallido
y dos fuera del filtro**, 82.04 s. La consulta recibió 400 real y el click
del selector agotó 30 s porque el componente lo retiraba al existir cualquier
`loadError`. No falló la autenticación ni se simuló la respuesta.

La corrección separa la denegación 401/403 del error recuperable de consulta.
El selector usa esa denegación, conserva el catálogo ya autorizado y se
restaura tras una respuesta autorizada. Se comprueba el estado HTTP antes de
parsear el cuerpo. La prueba también exige selector ausente tras logout y
visible tras un nuevo login, incluso al mantener una sucursal filtrada.

Regresión unitaria (cuatro archivos de rutas ejecutivo/menú y cobertura
ejecutivo/COGS): **41/41, exit 0, 13.45 s**. ESLint de componente y arnés:
exit 0, una advertencia previa de `react-hooks/exhaustive-deps`.

La primera regresión completa con la corrección pasó sus **3 casos**, pero
la suite terminó **exit 1** por timeout de `afterAll` (180 s; duración total
458.80 s), mientras corría también el build. No se cuenta como GREEN.
Next terminó, pero no se alcanzó la limpieza de DB. Un probe acotado confirmó
que seguían las empresas/usuario de ese fixture. Se recuperó el scope por
UUID conocido y timestamp transaccional, se verificaron sus tres sucursales
sintéticas y se eliminaron exclusivamente esas dos empresas y sus fixtures
dependientes en una transacción. Verificación posterior: **0 empresas**.

Se acota `taskkill` a 15 s y se mueve la limpieza a un `finally` independiente
del cierre del servidor, conservando el fallo si no puede detenerse. Se
registran las etapas de cierre y los UUID del fixture en un manifiesto local
sin contraseñas/cookies para poder verificar la recuperación de una corrida
interrumpida. Reintento de suite completa en curso.

`NODE_OPTIONS='--max-old-space-size=4096' pnpm.cmd exec tsc --noEmit`: exit 0.
Validador documental: 239 filas, 86 tareas base, 102 hijos, 24 aceptaciones,
0 errores, exit 0. `pnpm.cmd run build`: **exit 0**, compilación en 5.8 min,
TypeScript y **455/455 páginas**. Conserva los avisos previos de
`fetchConnectionCache` deprecado y `DYNAMIC_SERVER_USAGE` de documentos
laborales por `headers`; esa ruta se publica dinámica.

El segundo reintento pasó los **3 casos** y registró limpieza y ausencia de
fixtures, pero terminó **exit 1, 214.59 s** por la nueva comprobación del
cierre de proceso. `exitCode=null` no basta para afirmar que un proceso
sigue vivo si terminó por señal. Se comprueban también `signalCode`, el
evento de salida con espera acotada y que el endpoint de la instancia ya
no acepte conexiones. El cierre de fixtures sigue en `finally`. Tercer
reintento completo sin build concurrente en curso.

Ese reintento terminó **exit 1, 148.19 s**: nuevamente 3/3 casos y limpieza
verificada; el helper devolvió código 1 y el servidor no se pudo detener
desde la prueba. Un probe mínimo creó un proceso Node propio y ejecutó
`taskkill /pid <pid> /T /F`: **status 1, stderr «Error: Acceso denegado»**.
La causa contrastada es la restricción del sandbox, no una aserción de UI
ni el indicador `exitCode` por sí solo. Se solicitó y autorizó repetir el
comando completo fuera del sandbox; conserva la base aislada y todos los
controles y aserciones. Resultado final pendiente de registrar.

GREEN final, que prevalece sobre los estados en curso anteriores:
ejecución autorizada del archivo completo fuera del sandbox, **exit 0,
3/3 casos, 151.36 s** (146.56 s en pruebas). No se saltó ningún caso.
Ejecutivo, menú y COGS usan Next, Better Auth, navegador y DB reales;
el cierre verifica servidor detenido y ausencia de ambas empresas y sesiones
del fixture. El error 400 permite cambiar de sucursal; logout oculta el
selector y el reporte; login restaura el selector conservando el filtro.
Se reutilizan las verificaciones de fechas, cobertura parcial/vacía,
consolidación, aislamiento, móvil y teclado del archivo.

Gates finales: 41/41 unitarias, 3/3 navegador, tipos, lint focal (una
advertencia previa), build 455/455 y trazabilidad documental, todos exit 0.
`git diff --check`: exit 0. Se conserva el estado «código implementado»:
no se acepta `INV-01.b4.coverage.executive`, menú, sus padres ni la fila
11.11. Siguen pendientes conexión autenticada independiente NOBYPASSRLS,
candidatas de migración y dependencias de ingestión/checkpoint. No hubo
DDL persistente, cambios de datos operativos ni despliegue.

Comandos reproducibles (PowerShell, desde la raíz):

```powershell
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
$env:RUN_COGS_NEXT_BROWSER='1'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/cogs-next-browser.test.ts --maxWorkers=1 --pool=threads
pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/inventory/executive-report-route.test.ts tests/unit/inventory/menu-engineering-coverage.test.ts lib/services/__tests__/executive-report-coverage.test.ts lib/services/__tests__/cogs-revenue-coverage.test.ts
pnpm.cmd exec tsc --noEmit
pnpm.cmd exec eslint components/inventory/executive-dashboard.tsx tests/integration/cogs-next-browser.test.ts
pnpm.cmd run build
pnpm.cmd exec tsx scripts/validate-faltantes.ts
git diff --check
```

Capturas locales inspeccionadas: `.tmp/executive-next-query-error.png`
(error 400 con selector disponible), `.tmp/executive-next-mobile.png`
(390 px, controles y tabla sin desbordamiento global). No se publica
captura con datos operativos; las etiquetas son sintéticas. La corrida
inicial usó fallback de Geist por descarga fallida en dev: no acredita
fidelidad tipográfica. Revisión del diff: sin cambios de API, fórmulas,
permisos de servidor, schema ni migraciones.
