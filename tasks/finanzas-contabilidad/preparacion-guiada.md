# Preparación contable guiada

Fecha: 2026-11-03. Solicitud: hacer comprensible `/dashboard/finance/settings/accounting` sin repetir gastos, centros de costo ni corridas de tesorería.

## Contrato

- El responsable de empresa revisa las partidas y bancos ya registrados y vincula sus cuentas contables. No se crean operaciones duplicadas.
- La partida del gasto determina la cuenta de cargo; una partida presente sin vínculo queda pendiente. Gastos heredados sin partida conservan la cuenta general configurada explícitamente.
- Tesorería usa la cuenta contable vinculada al banco de origen de la corrida, sin exigir que todos los bancos compartan la cuenta general de pagos manuales.
- Las cuentas deben estar activas, ser de movimiento y estar vigentes en la fecha del hecho. Partidas de gasto admiten gasto o activo; bancos admiten activo.
- La guía permite crear cuentas explícitas si el catálogo está vacío. No siembra ni aprueba tratamientos fiscales automáticamente.
- Configuración de operaciones con nombres comprensibles; códigos, roles y referencias de versiones se administran internamente. Se conserva historial y vigencia de reglas.
- La apertura conserva documentos, balance, permisos e inmutabilidad; su captura se descubre después de explicar qué información necesita el responsable contable.
- Un ejemplo de gasto existente muestra cuentas e importes sin publicar ni modificar el gasto. La preparación muestra bloqueos reales y el estado de habilitación; no activa el piloto.
- Una consulta fallida nunca equivale a configuración vacía ni a preparación completada. Acceso solo de empresa con permisos existentes; sin números bancarios sensibles.

## Incrementos y verificación

1. Reproducciones de clasificación y bancos; corregir resolución y conservar idempotencia/historial.
2. Consulta privada de preparación y vista previa; vínculos/cuentas mediante servicios existentes, con validación en servidor.
3. Guía de partidas, bancos, configuración, apertura y ejemplo; estados de carga/error/vacío, teclado y móvil.
4. Integración de gastos/pagos, pruebas de API y navegador, tipos/lint/build y documentación de límites.

No sustituye FC-12–21 ni acredita cierre contable completo o revisión fiscal del piloto.

## Resultado implementado

- La entrada muestra tareas pendientes reales y navegación a partidas/bancos, cuentas por operación, apertura y ejemplo. La configuración también se encuentra desde el menú de Finanzas.
- Se consultan los catálogos existentes por empresa; solo se exponen etiqueta y últimos cuatro dígitos de banco. El listado está acotado y declara si queda incompleto.
- El responsable vincula partidas con cuentas de gasto/activo y bancos con cuentas de activo. La validez de las cuentas se comprueba otra vez en la fecha del hecho.
- Los códigos y roles de reglas y el ID de su versión anterior dejan de ser campos de captura. Se conservan versiones, cambios programados, suspensión y cuentas adicionales existentes.
- Un gasto con partida utiliza su vínculo explícito; si falta, queda pendiente. Sin partida, se conserva exclusivamente la cuenta general configurada. Un pago de tesorería usa el vínculo del banco seleccionado; la cuenta general de salida queda para pagos manuales. El pasivo del pago debe seguir coincidiendo con la obligación original.
- La resolución y publicación de gastos/pagos comparten el cerrojo de configuración y congelan la regla utilizada. Los renglones publicados conservan sus cuentas aunque cambien vínculos posteriores.
- La vista previa reutiliza la resolución del gasto y no crea eventos ni pólizas. Para un gasto ya publicado muestra sus cuentas guardadas. La apertura mantiene documentos, balance e inmutabilidad, y su publicación exige la capacidad correspondiente.
- Se corrige la consulta de reglas: `view` selecciona la vista y no se envía a los esquemas estrictos de sus parámetros. Vistas desconocidas se rechazan.

## Evidencia de verificación

- Suite unitaria: **197 archivos, 2424 aprobadas**, una omitida y una pendiente preexistentes. La frontera HTTP nueva tiene **6/6**, repetidas después de restringir los selectores de vista.
- Navegador Chromium: **5/5** con componentes/CSS reales y HTTP sintético. Cubre vínculos sin doble captura, configuración sin códigos/IDs, consulta sin escrituras, apertura con explicación, catálogo vacío y acceso denegado. Escritorio 1440, intermedio 768 y móvil 390 sin desbordamiento. Revisión adicional del editor **1/1**, con capturas de escritorio/móvil en `.tmp/accounting-preparation-editor-*.png`.
- Integración PostgreSQL aislada: **45/45**, incluidas cinco regresiones nuevas de partidas EXPENSE/ASSET, preservación histórica/idempotencia, partida sin vínculo, banco distinto de la cuenta general, vista previa sin escrituras, aislamiento y privilegios runtime de preparación. Comando: `$env:NODE_OPTIONS='--use-system-ca'; pnpm.cmd run test:integration tests/integration/accounting/expense-payment.test.ts --reporter=verbose`. La CA del sistema se hereda por los workers; TLS permanece verificado.
- Contrato mínimo de la guía: **1/1 adicional**, ejecutado de forma focal después de los 45 anteriores (`-t 'posts the guided minimum rules' --reporter=verbose`). Ambas reglas contienen únicamente la obligación por pagar, sin cuenta genérica de gasto ni de salida. El reconocimiento toma la cuenta de la partida y el pago la del banco vinculado; se comprueban cuatro renglones, centro, balance y saldo cero. El fixture usa fechas/corrida/aplicación de 2036; su primer intento tenía una fecha fija de 2026 y se corrigió sin cambiar producción. No se presenta esta pasada focal como una repetición completa del archivo de 46 casos.
- La reproducción RED quedó bloqueada por certificados antes del cambio; no se cuenta como resultado funcional. GREEN completo sí quedó acreditado después de resolver la confianza del proceso de pruebas. Una pasada silenciosa fue interrumpida para repetir con reporte detallado; solo la pasada final completa se cuenta como aprobada.
- TypeScript `pnpm exec tsc --noEmit --pretty false`: aprobado. Lint focal: cero errores; dos advertencias previas en Control interno. Lint global: **exit 0, cero errores y 2437 advertencias previas**.
- Build definitivo **exit 0**, con red autorizada y `NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'`, sin omitir controles ni cambiar bundler/configuración del proyecto. Evidencia: `.tmp/accounting-preparation-build-memory.log`. La pasada restringida no pudo descargar Geist/Geist Mono; el primer reintento con red compiló el código y terminó con **exit 134** al agotar el heap de 2 GB en TypeScript. Esos intentos no se cuentan como aprobados.

## Entrega y límites

La migración **0135_fc_preparation_permissions** únicamente concede al rol runtime lectura de las etiquetas necesarias del catálogo operativo. Queda registrada en el historial del repositorio, **sin aplicar a la base operativa**. No añade catálogos ni datos.

No se modificaron archivos de entorno ni se activaron banderas; la API conserva `ACCOUNTING_REVIEW_ENABLED` y la contabilización conserva `ACCOUNTING_POSTING_ENABLED`. No hay despliegue, publicación de apertura real ni reproceso de datos históricos en esta entrega. La validación fiscal y del primer piloto sigue pendiente.
