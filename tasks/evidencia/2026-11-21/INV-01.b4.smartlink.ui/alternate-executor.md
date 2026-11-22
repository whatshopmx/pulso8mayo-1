# Segundo ejecutor y configuración del cierre

Base: `7a2c5e6`, árbol limpio al iniciar. Continuación del hijo existente
`INV-01.b4.smartlink.ui`; sin aceptación ni despliegue.
Primera entrega de producto en commits `5b78056` (executor/harness/spec) y
`61ffe7a` (plantilla/contrato). El build inicial acreditado corresponde a
esos commits; las correcciones posteriores se detallan al final.
Correcciones finales: `7d5f2c7` (móvil) y `d34759c` (Ctrl+S, arnés y
regresiones reales). Estado del hijo: código implementado, V1/V3 comprobadas;
dependencias y aceptación global pendientes.

Última verificación, 2026-11-22: build final exit 0; 2/2 casos Next reales
aprobados, 9/9 navegador controlado a 358 px y 13/13 unitarias documentales/
plantilla. Base/rol/objetos R2 y procesos retirados. Matriz: 239 filas,
24 aceptaciones previas, cero errores de trazabilidad; 11.11 sigue Parcial.

`/dashboard/workflows/execute/[id]` usa `WorkflowExecutor`, que mostraba el
paso POS como texto genérico. Ahora comparte `PosUploadStep` con el stepper,
recibe la sucursal de la ejecución y persiste la key durable y el resumen
al completar el paso. La carga y el PATCH del paso siguen separados.
Archivo pendiente bloquea tabs, anterior, siguiente y omisión. Editar día,
archivo o mapping invalida la referencia anterior, incluso si venía de DB.
Los valores JSONB se restauran sin perder el día. Un fallo del PATCH aparece
en pantalla y permite reintentar sin volver a subir ni ingerir ventas.

RED de navegador: el campo Archivo del POS no existe, exit 1. GREEN inicial:
7/7, exit 0. Ampliada con guardado fallido/reintento y móvil: suite conjunta
36/36 (9 executor + 10 stepper + 17 manual/CSV), exit 0, 4.3 min.
Durante el arranque del harness se observaron mensajes transitorios de hooks
inválidos tras optimización tardía de la cámara. Se declaró esa dependencia
en optimizeDeps. Repetición focal de ambos ejecutores: **19/19, exit 0**, 4.9 min,
sin esos mensajes de consola. No se atribuye el mensaje inicial al
Next de producción ni se oculta como consola limpia de toda la primera corrida.

Capturas `.tmp/pos-executor-mobile.png` y `.tmp/pos-executor-desktop.png`.
Móvil 390×844: sin overflow, navegación Tab SKU→Ingreso, sin pageerror en
el caso; inspección visual del móvil confirma controles y feedback legibles
en el diseño existente. Respuestas HTTP de esta suite son sintéticas.

Unitarias focales previas: 61/61, cuatro archivos, exit 0. Lint del executor,
harness, configuración, spec y helpers de integración: exit 0; 12 warnings
en código previo del executor (any e img); archivos nuevos sin warnings.

La prueba de instalación reproduce otra brecha: normalización de la librería
convierte smart_link a TEXT y descarta smartLinkTarget. La plantilla ahora
declara `config.posUpload: true`, que se conserva al normalizar y serializar.
Se corrige el texto que prometía recepción automática por email/completado
automático y PDF. Dos unitarias RED (config vacío) → 2/2 GREEN, exit 0;
otros pasos del cierre/corte de caja no adquieren el flag POS.
Esto afecta nuevas copias de la librería; no modifica plantillas instaladas
históricas que ya perdieron la señal.

Gates: tsc predeterminado agotó heap de Node (~2 GB), exit 1.
Repetición explícita con 4096 MB: **exit 0**, sin diagnósticos. Build Turbopack con 4096 MB falló
por descarga de Geist/Geist Mono, exit 1. Repetición Webpack fuera del
sandbox autorizada mediante el mecanismo de aprobación, con CA del sistema.
**Build Webpack inicial exit 0**: compilación correcta en 12.2 minutos,
TypeScript completo, 455/455 páginas en 62 s y optimización/trazas finalizadas.
La sesión 58650 terminó; no se reinició el proceso durante la espera.
Avisos conocidos: `fetchConnectionCache` deprecado y la ruta de documentos
laborales dinámica por `headers`, conservada dinámica en la salida final.
El preview
adicional de DevTools agotó navegación; su servidor efímero terminó exit 0.
Las capturas móvil/escritorio de Playwright sí fueron inspeccionadas.

La integración existente añade un caso alternativo que usa la ruta real,
los mismos seis uploads por input, oráculos de SQL/R2, login independiente
y retiro comprobado. Sus resultados se detallan más abajo; no se presenta
la mera existencia del test como V2/V3 acreditadas.

Se añadió otro caso real opt-in: clonar Cierre de Sucursal desde Catálogo
Pulso, comprobar empresa/pasos/config POS por SQL, editar el título y guardar
con Ctrl+S, recargar y comprobar que el flag persiste. Usa el mismo arnés de
base/rol/servidor desechables y un tenant distinto; no inicia workflows,
notificaciones ni extractores. Archivos: `pos-template-runtime-scenario.ts`
y suite Next/runtime existente. Lint exit 0. La corrida conjunta y su repetición
focal sobre el build inicial se detallan a continuación.

## Resultado real y correcciones posteriores

La corrida conjunta terminó **1 aprobada / 1 fallida / 5 omitidas**, exit 1,
265.85 s. El ejecutor alternativo pasó: seis cargas desde input, identidad
compartida con bulk, corrección/repetición/ingreso/insuficiencia/cero,
R2/lectura firmada, PATCH sin reingestión, logout y retiro del servidor/objetos.
Móvil 390×844 sin overflow del documento; capturas Next reales inspeccionadas.
La inspección encontró que Siguiente sobresalía de la tarjeta, aunque no del
viewport; se abrió una comprobación más estricta en lugar de darlo por cerrado.
La base y el rol de esa corrida quedaron eliminados y verificados (`closed:true`).

El caso de instalación clonó y persistió todos los pasos con el flag POS,
pero falló esperando el guardado del nombre nuevo. Repetición focal con
hidratación comprobada (abrir/cerrar preview) y diagnóstico: **1 fallida / 6
omitidas, exit 1**, 140.61 s. El input tenía el título nuevo y el PATCH enviado
llevaba el nombre anterior de la copia; cero pageerror. Confirma captura de
estado obsoleto en Ctrl+S, no fallo del POST ni pérdida inicial del flag.
También se verificó retiro de su base/rol/servidor.

`EditorHeader` comparte ahora un `handleSave` con useCallback dependiente de
id/título/pasos. Autosave y teclado dependen de esa función vigente; se elimina
la captura del render anterior cuando isDirty ya era true. No cambia la ruta,
permisos ni el contrato del payload. Prueba real GREEN acreditada en la continuación.

Móvil: RED a 358 px, overflow de documento, exit 1. El grupo de botones del
executor ahora permite envolver y alinea al final. GREEN: **9/9 navegador
controlado, exit 0**, 1.4 min, incluyendo límite de la tarjeta y teclado.
Lint final: exit 0; 12 warnings previos del executor y dos any previos del
editor, sin warnings nuevos; se eliminan dos avisos de dependencias de hooks.

Histórico del build de estas correcciones: la primera solicitud perdió la respuesta
del runtime de herramientas; se comprobó que no había proceso nuevo de build
antes de repetir. La nueva solicitud conserva salida en `.tmp/pos-final-build.log`
y exit/fecha en `.tmp/pos-final-build-result.json`; no atribuirle éxito hasta
obtener resultado terminal. El resultado anterior exit 0 no cubre estas correcciones.
Durante la ejecución se consultó la sesión 44660 sin arrancar otro build.
Su resultado terminal y la repetición con el filtro
`POS alternate executor|POS library installation` se acreditan a continuación.

Tras las actualizaciones documentales y de código: validador exit 0 (239/86/108,
24 aceptaciones, cero errores), unitarias de trazabilidad/plantilla **13/13**, exit 0.

## Continuación 2026-11-22

El build de las correcciones terminó **exit 0**, compilación en 8.5 minutos,
TypeScript completo y 455/455 páginas en 34.3 s. Resultado persistido en
`.tmp/pos-final-build-result.json` (finalizó 2026-11-21T21:02:53-06:00) y log
en `.tmp/pos-final-build.log`. Móvil y su regresión en commit `7d5f2c7`.

La repetición real encontró contención al copiar la base origen: dos intentos
de preparación terminaron sin ejecutar casos, sin cerrar clientes ajenos ni
dejar base/rol. Se descartó el pooler: la URL aislada ya era directa. Copia
mínima externa, arnés completo mediante tsx y control mínimo dentro de Vitest
crearon y retiraron sus recursos correctamente. Un diagnóstico secuencial de
imports también pasó, con cinco copias retiradas (119.79 s de caso).

El driver Next carga ahora los helpers de aplicación después de provisionar
la copia y fija DATABASE_URL del proceso host al clon; restaura el valor al
terminar. No modifica TEST_DATABASE_URL, políticas, permisos ni datos origen.
La preparación pudo completar y arrancar Next con este orden; no se atribuye
un culpable específico de los imports sin una traza adicional.

Se descartó una invocación auxiliar con todos los casos omitidos (exit del CLI
0, ninguna prueba acreditada). El wrapper local ahora pasa argumentos directos
al CLI instalado, conserva JSON y exige los nombres esperados con status passed,
sin contar omitted/pending como éxito. Archivos `.tmp/pos-next-verify*.json/log`;
el modo de control usa `.tmp/pos-provision-verify*` y declara su caso esperado.

Sobre el build final: **la instalación desde Catálogo Pulso, edición Ctrl+S y
persistencia tras recarga pasaron**, 36.04 s. El caso del executor falló en la
espera inicial de 5 s antes de encontrar el campo; no llegó a la carga POS.
La corrida conjunta fue 1 aprobada/1 fallida/5 omitidas, exit 1; limpieza de
base/rol verificada. La repetición actual comprueba explícitamente el GET de la
ejecución, id/sucursal y flag POS antes de interactuar con el formulario.
La sesión 84578 terminó **exit 0, 2/2 aprobadas y 5 omitidas por filtro**,
192.32 s totales: executor 111.229 s, instalación/editor 32.233 s.
El reporte JSON y el wrapper confirman los dos nombres esperados con status
passed (`expectedCasesPassed:true`); el resultado no se deduce solo del exit.
Solo cambiaron pruebas después del build final.

SQL confirma stock/revisiones y actor del paso, los seis objetos R2 se retiran
y el prefijo queda vacío; el arnés comprueba base/rol ausentes, con
`databaseCreated:false`, `roleCreated:false`, `closed:true`. Los procesos Next
18048 y 21068 están ausentes por comprobación adicional del sistema; los
puertos fueron comprobados cerrados por el helper. Sin pageerror. Capturas
Next móvil 390×844 y escritorio actualizadas e inspeccionadas; el móvil ya
conserva Siguiente dentro de la tarjeta. La comprobación controlada cubre 358 px.

El código instalado y guardado desde el catálogo conserva solo el flag POS
esperado; no crea ventas ni movimientos al clonar/editar. El paso POS conserva
key/resumen al completarse y no repite ingestión. El workflow sintético sigue
en IN_PROGRESS con un último paso sin completar, sin disparar sus efectos.

Control de preparación: `sales-runtime-provisioning.test.ts` conserva el caso
opt-in mínimo (base con >190 tablas y rol NOSUPERUSER/NOBYPASSRLS, retiro
comprobado); los imports secuenciales usados solo para diagnóstico se retiraron.
Lint de los cuatro archivos de pruebas finales: exit 0, sin advertencias.

Pendientes: plantillas históricas que ya perdieron el flag, runtime de
auth/enlace/storage, concurrencia y dependencias del hijo. Los 24 registros
aceptados y las 239 filas se conservan; no hay migración operativa.

Trazabilidad documental: `pnpm.cmd exec tsx scripts/validate-faltantes.ts`,
exit 0; 239 filas, 86 bases, 108 hijos, 24 aceptaciones y cero errores.

```powershell
pnpm.cmd exec playwright test --config tests/playwright-sales-entry.config.ts
pnpm.cmd exec playwright test --config tests/playwright-sales-entry.config.ts tests/e2e/pos-executor-feedback.spec.ts tests/e2e/pos-workflow-feedback.spec.ts
pnpm.cmd exec vitest run --configLoader bundle tests/unit/workflows/pos-template.test.ts --maxWorkers=1 --pool=threads
pnpm.cmd exec vitest run --configLoader bundle tests/unit/faltantes-traceability.test.ts tests/unit/workflows/step-contract.test.ts tests/unit/workflows/step-access.test.ts tests/unit/workflows/stock-count-step.test.ts --maxWorkers=1 --pool=threads
node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit --incremental false
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
pnpm.cmd run build --webpack
$env:RUN_SALES_RUNTIME_NEXT_BROWSER='1'
$env:RUN_SALES_RUNTIME_POS='1'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sales-runtime-next-browser.test.ts --maxWorkers=1 --pool=threads -t 'POS alternate executor|POS library installation'
```
