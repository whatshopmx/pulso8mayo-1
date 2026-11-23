# Vacaciones — recorrido Next, sesión real y navegador

Base de implementación: `b0a0039` más árbol local compartido. Código final: `74e959e0fa717386bd146718dd2dd52562a49694` (`266828f` UI, `a331031` fechas, `d366857` navegador, `74e959e` puente SQL→nómina). Se aceptan **NOM-02.c1.http y NOM-02.c1.civil-days en V1/V2/V3 aisladas**. No acredita despliegue ni cierre de NOM-02.c1.

## Defectos reproducidos y cambio

- El listado de la pantalla imponía el ID del actor aun cuando podía gestionar al equipo. Con Better Auth real, gerente de la sucursal, solicitud confirmada de un empleado y HTTP 200, Chromium mostró **cero filas del empleado**. Reproducción: `.tmp/vacation-next-browser-red-ca.log`, exit 1. El filtro personal ahora corresponde a quien no puede aprobar; el servidor conserva el alcance autorizado.
- La ruta de pantalla y el proxy excluían OWNER y EMPLEADO. La prueba de permisos añadió ambos roles y falló antes de corregir el catálogo. OWNER obtiene acceso explícito a inicio y vacaciones; no se cambia el catálogo completo para equipararlo implícitamente a ADMIN. EMPLEADO conserva denegados nómina y aprobaciones.
- Las respuestas no exitosas de listado se ignoraban, dejando filas antiguas o un falso vacío. El componente ahora muestra el mensaje de API y permite reintentar. Los errores de las acciones se muestran dentro del diálogo o junto al listado. Cancelar tiene nombre accesible y aparece para solicitudes pendientes/aprobadas según identidad y capacidad.

La prueba usa Next de producción, Chromium, Better Auth, PostgreSQL y el selector dedicado reales, sin interceptar HTTP ni simular auth, SQL o dispatcher. Usuarios/cuentas y preferencias son sintéticos; email/WhatsApp están desactivados para todos ellos y los proveedores del proceso Next conservan las guardas del arnés. La base y el rol se generan y eliminan en el endpoint aislado ya comprobado por el helper.

## Verificación ejecutada

- Primera ejecución: falló antes del login con un ErrorEvent del driver. No cuenta como reproducción funcional; base y rol retirados.
- Segunda ejecución propagó `NODE_OPTIONS=--use-system-ca` al hijo Next: login real y API 200; falló por la ausencia de la fila esperada. Base, rol y servidor retirados.
- Permisos: RED de tres casos, incluido el dashboard de OWNER inaccesible. GREEN con regresión de rutas: **54/54**, dos archivos, exit 0, 11.22 s.
- Lint focal: exit 0, cero errores; cinco avisos previos del componente (cuatro símbolos no usados y dependencia del efecto).
- Build de UI: **exit 0**, TypeScript y 455/455 páginas, `BUILD_ID: a_ZLo5SyKYi9SJU3Xu36k`, `.tmp/vacation-ui-build.log`.
- El primer recorrido ampliado aprobó el estado y actor en SQL, pero el oráculo de notificación buscaba el título del payload en lugar del título generado por la plantilla. Se corrigió a `Solicitud Aprobada`, mensaje y enlace concretos; no se cambió el dispatcher.
- El segundo recorrido ampliado pasó solicitud móvil/400 recuperable, aprobación, notificación interna, cancelación/repetición, OWNER y rechazo entre sucursales. Se detuvo por ambigüedad del locator `alert`, que también encontraba el anunciador de Next; el selector se restringió al mensaje de admisión. Ninguno de esos intentos se cuenta como aceptación integral.
- La captura `.tmp/vacation-next-browser-worker-date-red.png` muestra **19–21** después de solicitar **20–22** desde el navegador de Ciudad de México contra el servidor UTC. Se conservó antes de repetir.
- Nómina: **2/6 RED** en `.tmp/vacation-civil-red.log`: objetos Date leídos de DB pierden el primer día en México/Honolulu; strings civiles no. La corrección comparte el contrato de días civiles entre API y resolver, sin reinterpretar como instantes los campos timestamp legacy. API devuelve `YYYY-MM-DD`, calcula días y límites de consulta en UTC neutro; no cambia fechas de auditoría ni reescribe historia existente.
- GREEN ampliado: **109/109**, ocho archivos, exit 0, 50.57 s; `.tmp/vacation-civil-unit.log`. Lint del incremento de fechas: exit 0, cero errores, 23 avisos previos de rutas/payroll. El test final de navegador pasó lint sin avisos.
- Build final de fechas: **exit 0**, compilación 2.3 min, tipos y 455/455 páginas; `BUILD_ID: 2mSrUCPDpyH8r3Z2yYFfn`; `.tmp/vacation-civil-build.log` y exit.txt. Sin cambios de aplicación posteriores a este build.
- V2 repetida tras la corrección: **2/2** casos del archivo `vacation-runtime-db.test.ts` pasaron en la corrida conjunta de dos archivos. El comando conjunto terminó exit 1 porque el último paso del navegador envió sign-out sin JSON y Better Auth devolvió 415. Se conserva ese resultado en `.tmp/vacation-next-final.log`; no se declara verde la corrida conjunta ni se repiten los casos nativos sin cambios.
- V3 final: `node --use-system-ca node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts --maxWorkers=1 --pool=threads tests/integration/vacation-next-browser.test.ts`, con `NODE_OPTIONS` incluyendo `--use-system-ca` para el proceso hijo: **1/1, exit 0**, 92.60 s (89.40 s de test), `.tmp/vacation-next-browser-green.log` y exit.txt. La petición real de sign-out incluye JSON vacío; el GET siguiente devuelve 401. Cero errores `pageerror` en las tres sesiones.
- V2 final ampliada: `node --use-system-ca node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts --maxWorkers=1 --pool=threads tests/integration/vacation-runtime-db.test.ts`: **2/2, exit 0**, 45.96 s, `.tmp/vacation-civil-native-payroll.log` y exit.txt. Después del commit de aprobación, el resolver de nómina hace su consulta real de solicitudes en PostgreSQL y conserva **10–12 = tres días, prima 7,500 centavos** con salario diario de 10,000 y saldo explícito de 12 días. No precarga las solicitudes; el saldo es dato controlado de prueba y no acredita reconstrucción histórica. Lint del test ampliado: exit 0, sin avisos.
- Trazabilidad final: `pnpm.cmd exec tsx scripts/validate-faltantes.ts`, exit 0 fuera del sandbox, **239 filas, 86 base, 119 adicionales, 80 aceptados, cero errores**. `tests/unit/faltantes-traceability.test.ts`: **11/11**, exit 0. El conteo incluye componentes técnicos y no representa avance porcentual funcional.

Los avisos de configuración futura de Vite no son fallos de caso. Los intentos fallidos del arnés se conservan separados de las reproducciones de producto.

## Alcance de aceptación

El recorrido final comprobó solicitud desde móvil (390 px), error 400 visible y recuperación sin cerrar el diálogo, aprobación por gerente, rechazo corporativo de otra sucursal, cancelación de una aprobada y repetición 409, aislamiento entre dos empresas/sucursales/propiedad, notificación interna persistida y enlazada, fallo 503 real de admisión con retirada de filas/reintento, fechas civiles **20–22** visibles, logout y limpieza. Hay oráculos SQL para estado, actor, días, cancelación, rechazo y no modificación de la empresa ajena. No sustituye las carreras PostgreSQL independientes ya documentadas en la [V2 de runtime](../NOM-02.c1.http-runtime/README.md).

Se inspeccionaron las capturas de móvil antes y después de corregir las fechas: `.tmp/vacation-next-browser-worker-date-red.png` y `.tmp/vacation-next-browser-worker.png`; también se generó `.tmp/vacation-next-browser-manager.png`. No se afirma cobertura de teclado ni una auditoría visual completa del módulo.

La limpieza final verificó ausencia de la base `inv_sales_next_0b0729314d6c4f7f9ebfbbc0ce20b27e` y rol `inv_sales_role_87f0bd271fae4abd820339287e6fa99a`: `databaseCreated: false`, `roleCreated: false`, `closed: true`. El helper también verificó cierre del proceso Next y rechazo de conexiones al puerto propio. No se modificó `.env`, no se migró el entorno operativo y no se enviaron canales externos.

La V2 ampliada posterior retiró y verificó su propia base `inv_sales_next_0ab7fb27879b447083c90d473530ea96` y rol `inv_sales_role_f2bdcd5fa524496284020f3686c28692`; el manifiesto final conserva las mismas banderas de cierre.

El saldo histórico, aplicación por lotes, jobs, nómina integral y adopción operativa permanecen fuera de este cierre HTTP. Las filas 09.11 y 10.05 siguen parciales. Los cambios visuales preexistentes del archivo compartido se conservan y se excluyen del commit funcional.
