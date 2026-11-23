# Checklist — implementación de faltantes, revisión 2

Plan: [implementación revisada](../plans/2026-11-11-plan-implementacion-faltantes.md). Base: [investigación](../docs/2026-11-11-investigacion-plan-faltantes.md).

Checkpoint Fase 1 completa (`INV-01.d` + `INV-02`) 2026-11-22: **`INV-01.d`, los 6 hijos de `INV-02` y el padre `INV-02` aceptados en entorno aislado; 71 registros aceptados (Puerta 1 cerrada)**. **13/13** recorridos reales Next producción + Chromium + Better Auth + Neon + R2 (`INV-01.d`), **99/99** unitarias/PGlite `INV-02` (6 archivos) y **8/8** PostgreSQL nativo con LOGIN independiente, `0159`/`0160` y 2 carreras reales (`recipe-policy-runtime-db.test.ts`, 126.15 s). Destraba **`PROD-00`**; sin despliegue operativo ni cierre de fila `11.11` (pendiente `VAL-01.M01-M17.M11`). [INV-01.d](evidencia/2026-11-22/INV-01.d/accepted.md); [INV-02](evidencia/2026-11-22/INV-02/accepted.md).

Checkpoint `INV-01.c` cierre completo 2026-11-22: **`INV-01.c.recovery.ui-routes`, `INV-01.c.recovery` y padre `INV-01.c` aceptados en entorno aislado; 63 registros aceptados**. Recorrido integrado real [sale-recovery-next-browser.test.ts](../../tests/integration/sale-recovery-next-browser.test.ts) **1/1** (`exit 0`, 66.22 s) sobre Next producción (`BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`), Chromium, Better Auth (dos `ADMIN` independientes), Neon desechable baseline `0158` y R2 privado real: 3 cargas/atestaciones SHA-256, alta en diálogo UI, segregación de funciones, aprobación, aplicación auditada `AUD-02` con oráculos SQL (`20→17`, revisión `1`, movimiento `-3`, `inventory_audit_log`), reintento idempotente, `sign-out` `401` y limpieza verificada. Siguen abiertos `INV-01.d` y la fila `11.11`. [Aceptación y límites](evidencia/2026-11-22/INV-01.c.recovery.ui-routes/accepted.md).

Checkpoint `INV-01.c` servicios y concurrencia 2026-11-22: **`races` y 13 hijos de servicios de recuperación (`contract` → `apply`, incluido R2 real en `objects`) aceptados en entorno aislado; 60 registros aceptados**. **97/97** unitarias (14 archivos), **13/13** suites SQL Neon (`pulso_app` NOBYPASSRLS, 65 casos: concurrencia 5/5 + recuperación 60/60), **1/1** R2 privado real (`sale-recovery-objects-r2-db.test.ts`), **4/4** Playwright controlado y ESLint limpio. Siguen abiertos `INV-01.c.recovery.ui-routes`, `INV-01.c.recovery`, `INV-01.c`, `INV-01.d` y la fila `11.11`. [Aceptación y límites](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).

Checkpoint Cobertura / `INV-01.b` 2026-11-22: **COGS, menú, ejecutivo, sus 3 RLS, `INV-01.b4.coverage`, `INV-01.b4` y padre `INV-01.b` aceptados en entorno aislado; 46 registros aceptados**. **50/50** unitarias, ESLint limpio, **16/16** SQL runtime (`0154`/`0156`/`0157`/`0158` bajo `pulso_app` en rollback) + HTTP Better Auth y **4/4** navegador Next producción (`BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`) con limpieza verificada. Sin despliegue operativo; `INV-01.c`, `INV-01.d` y la fila `11.11` siguen abiertos. [Aceptación y límites](evidencia/2026-11-22/INV-01.b4.coverage/accepted.md).

Checkpoint POS/Storage 2026-11-22: **storage, smartlink.next y smartlink.ui aceptados V1/V2/V3; 37 registros aceptados**. Build final (`BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`), **47/47** unitarias de selección/frontera, **6/6** SQL con selección runtime y **4/4** Next/Chromium/Better Auth/Neon/R2 reales sobre copia con `POS_FILES_RUNTIME_DATABASE_URL` y writer en LOGIN mínimo (stepper, executor alternativo, catálogo/Ctrl+S y rechazo 503 de URI dueña sin fallback ni efectos), lint limpio y limpieza DB/rol/R2/servidores verificada. Sin migración operativa, backfill legacy, aceptación de `INV-01.b4`/`INV-01.b`/`INV-01.d` ni fila `11.11`. [Aceptación y límites](evidencia/2026-11-22/INV-01.b4.storage/accepted.md).

Checkpoint POS 2026-11-22: **smartlink aceptado V1/V2; 34 registros**. 3/3 Next/Chromium/Better Auth/Neon/R2 actuales sobre copia y 56 unitarias POS; dos executors/instalación y limpieza verificados. 4/4 servicios de archivo SQL con LOGIN independiente sin SET ROLE, candidata 0155 en base nueva y commit/aislamiento/limpieza; storage conserva pendiente seleccionar ese runtime en las rutas y repetir Next. Sin cambios de aplicación, migración operativa ni despliegue. [Evidencia](evidencia/2026-11-22/INV-01.b4.pos-current/README.md).

Aceptación Next sobre copia 2026-11-22: **manual.next y ui.next aceptados V2/V3**, 4/4 seleccionados, exit 0, 217.51 s. Copia del origen aislado con RLS/triggers conservados, writer LOGIN mínimo, oráculos después de commit y base/rol/servidores retirados. Sin cambios de aplicación desde el build aprobado; sin intervenir origen ni desplegar. **33 registros aceptados**; POS/storage/cobertura/recovery y padres/fila 11.11 siguen pendientes. [Evidencia](evidencia/2026-11-22/INV-01.b4.next-copy/README.md).

Checkpoint manual/CSV 2026-11-22: **4/4 Next seleccionados, exit 0**, limpieza de base/rol/servidores verificada; tres POS/R2 fuera de alcance. Build 29721 final exit 0 (tipos/455 páginas), **28/28 focales, 17/17 controladas y lint limpio**. Guardia SSR comprobada y renders revisados. **Aceptados runtime.config/manual/bulk/ui/manual.ui: 31 registros**, tras revisar criterios y dependencias en dos tandas. manual.next/ui.next conservan pendiente la copia de base existente; padres/fila 11.11 siguen abiertos. [Criterios y límites](evidencia/2026-11-22/INV-01.b4.manual-csv-next/accepted.md).

Checkpoint nativo 2026-11-22: **12/12 PostgreSQL/LOGIN/commits reales** (ocho políticas, cuatro ingestiones), cero omitidas; **109/109** regresiones de ingestión y lint sin avisos. Build final de aplicación con TypeScript/455 páginas **exit 0**, sesión 10116 terminada. **INV-01.b4b aceptado V1/V2 del servicio aislado**, con sus cuatro dependencias aceptadas: **26 registros aceptados**. [Aceptación](evidencia/2026-11-22/INV-01.b4b/accepted.md), [V2 de políticas y límites](evidencia/2026-11-22/INV-02/runtime.md). Base/rol retirados por archivo; sin intervención del origen, migración operativa, aceptación de padres/filas ni activación de elaborado.

Aplicación INV-02 2026-11-22: writer canónico conectado al lector publicado mediante activación del servidor; correcciones/anulaciones conservan snapshot/asignaciones anteriores y elaborado sigue bloqueado hasta PROD-01. Se corrigió retroactividad de subrecetas vendidas como parte de un padre y se bloqueó degradación mutable al retirar la activación. **183/183** regresiones locales, ocho nativas de políticas y lint sin advertencias; [evidencia y límites](evidencia/2026-11-22/INV-02/apply.md). Build final del escritor con tipos/455 páginas **exit 0**. Sin aceptación dependiente de INV-02 ni activación externa; el checkpoint superior registra 26 aceptaciones tras cerrar b4b.

Snapshot INV-02 2026-11-22: lector transaccional de versión publicada, política/vigencia y demanda congeladas; subreceta elaborada terminal, sin consultar ficha mutable ni duplicar ingredientes. **106/106** regresiones en siete archivos, incluidas SQL/RLS/JSONB PGlite; [evidencia](evidencia/2026-11-22/INV-02/snapshot.md). Código implementado sin aceptación dependiente/V2 independiente. Tipos globales/lint sin errores y trazabilidad 239 filas/25 aceptaciones comprobados; regresión posterior con nómina 46/46. Build del incremento con tipos/455 páginas **exit 0**, sesión 46907 terminada. Writer preparado después bajo activación; su build final se registra arriba. Stock terminado y aceptación integrados pendientes.

Publicación INV-02 2026-11-22: publicador serializable con savepoint, motivo/actor, auditoría común de configuración, reintento sin duplicación y rechazo de vigencias que afecten ventas legacy/canónicas existentes. **51/51** entre SQL de servicio/acceso, frontera y regresión AUD-02. Preparación **0160** generada; sin aplicar fuera de PGlite. [Evidencia](evidencia/2026-11-22/INV-02/publication.md). Código implementado, sin aceptación dependiente/V2/V3; snapshot/apply y coordinación con stock terminado pendientes. Tipos globales posteriores **exit 0** con heap 4 GB; build posterior en ejecución. El build previo pasó con tipos y 455 páginas.

Persistencia INV-02 2026-11-22: SQL/snapshot/journal **0159** generados y verificados en PGlite; contrato **20/20** y SQL **14/14**, regresión conjunta **101/101**. Tipos focales/lint/Drizzle check correctos. [Evidencia de schema](evidencia/2026-11-22/INV-02/schema.md). Padre subdividido en cinco hijos y mapa/matriz sincronizados: 239 filas, 113 hijos y 25 aceptaciones. Sin aplicar migración ni activar elaborado; publicación/snapshot/apply y V2 independiente pendientes. Tipos globales del checkpoint anterior pasaron con 4 GB; build Webpack compiló y continúa en TypeScript.

Continuación INV-02 2026-11-22: contrato puro de modo de consumo por versión/vigencia, **19/19 unitarias**, sin aceptar ni activar modo elaborado. [Contrato, límites y pendientes de persistencia/aplicación](evidencia/2026-11-22/INV-02/README.md).

Continuación de producción 2026-11-22: rastreo de modelos y consumidores, y preparación de cierre único de órdenes. PATCH de producción verifica capacidad/sucursal y no completa ni reabre hechos consumidos; edición de prep list tampoco permite eludir el cierre. **67/67 pruebas focales** (incluyen PGlite y handler con sesión simulada). [Evidencia PROD-00](evidencia/2026-11-22/PROD-00/README.md). PROD-00 sigue pendiente de INV-02; sin aceptación de stock terminado, carreras PostgreSQL, navegador ni despliegue.

86 entradas base del plan, incluyendo padres P que deben descomponerse. Los hijos ejecutables se añaden al abrirlos y se materializan en el mapa. Los criterios, archivos orientativos, dependencias y verificación por ID están en el plan; este archivo registra ejecución sin duplicar criterios.

Ninguna casilla se marca por código localizado o por las 157 unitarias de base. Para aceptar: evidencia por ID, entorno/HEAD, V1/V2/V3 aplicables y filas actualizadas. Los checkpoints se ejecutan después de 2–3 hijos terminados, en orden de dependencias aunque pertenezcan a frentes distintos.

Continuación 2026-11-11: [mapa ejecutable de 239 filas](mapa-implementacion-faltantes.json), [matriz actualizada](../docs/matriz-cumplimiento-sistema-2026-11-11.csv) y [proyecto Neon nuevo solicitado por el propietario](evidencia/2026-11-11/NEON-NEW/README.md). Los hijos heredan los criterios del padre; fijar archivos/casos antes de abrirlos y subdividir si exceden el límite. Validar con `pnpm.cmd exec tsx scripts/validate-faltantes.ts`.

## Estado vigente de consolidación (2026-11-16)

Continuación de ingesta 2026-11-22: cuatro pruebas nuevas con commits y login independiente preparadas; **109/109 unitarias y lint correctos**. Integración nueva sin ejecutar: clonación 55006, worker interno TimescaleDB capturado durante CREATE DATABASE; no se intervino el origen. Sin nueva V2 ni aceptaciones. [Diagnóstico y siguiente paso](evidencia/2026-11-22/INV-01.b4b/runtime-db.md).

Aceptación de prerrequisito 2026-11-22: **INV-01.b4b.rls aceptado V1/V2 en copia aislada**, 3/3 SQL con LOGIN nuevo sin bypass/membresías, 20/20 unitarias, lint y auditoría de journal/snapshot correctos. SELECT(name) sin SELECT general/DML; RLS entre dos empresas/tres sucursales y escrituras 42501 comprobadas; base/rol retirados. [Evidencia](evidencia/2026-11-22/INV-01.b4b.rls/README.md). **25 registros aceptados**, sin aceptar ingestión/padres ni aplicar 0141 a main.

Continuación 2026-11-22: **2/2 Next de producción/Chromium/Better Auth/Neon/R2 reales** sobre build final exit 0 (tipos y 455 páginas): executor alternativo con stock/revisiones/paso sin reingestión y clonación/edición Ctrl+S desde catálogo, con flag POS persistido tras recargar. Limpieza SQL/R2/procesos comprobada; móvil sin salir de la tarjeta (9/9 controladas a 358 px). Commits `7d5f2c7`/`d34759c`. `INV-01.b4.smartlink.ui` pasa a **código implementado**, con V1/V3 acreditadas; dependencias, copias históricas sin flag y runtime de enlace/storage siguen pendientes. [Evidencia](evidencia/2026-11-21/INV-01.b4.smartlink.ui/alternate-executor.md). Sin nuevas aceptaciones ni despliegue.

Correcciones de aceptación 2026-11-21: Next del executor alternativo pasó; instalación desde catálogo detectó Ctrl+S enviando el título anterior. Corregido el callback vigente de guardado; GREEN real pendiente. Ajuste móvil del executor tras RED a 358 px: **9/9 navegador controlado**, lint exit 0 y dos warnings de hooks eliminados. El build anterior exit 0 no cubre estas correcciones; build final solicitado con log/resultado persistentes. [Evidencia](evidencia/2026-11-21/INV-01.b4.smartlink.ui/alternate-executor.md). Se mantienen 24 aceptaciones.

Continuación segundo ejecutor 2026-11-21: `WorkflowExecutor` comparte captura POS, bloquea navegación pendiente, restaura JSONB y guarda key/resumen con error recuperable del PATCH. Plantilla de cierre declara `config.posUpload` para conservar la señal al instalarla. **36/36 navegador controlado, 61/61 regresiones unitarias y 2/2 contrato de plantilla**, exit 0; tipos con 4096 MB y lint sin errores. Repetición de ambos ejecutores **19/19**, exit 0. Build Webpack final con tipos/455 páginas **exit 0**; commits `5b78056`/`61ffe7a`. [Evidencia y gates en curso](evidencia/2026-11-21/INV-01.b4.smartlink.ui/alternate-executor.md). Next real alternativo e instalación desde catálogo en ejecución; sin nueva aceptación ni despliegue.

Continuación UI cierre 2026-11-21: **Stepper principal conectado al POS**, con archivo/día/mapping/SKU, feedback y bloqueo de pendientes. **27/27 navegador controlado, 61/61 unitarias, lint sin advertencias nuevas y build completo (tipos/455 páginas) exit 0**. Next real desde input: **1/1 POS focal final**, más cuatro regresiones verdes del mismo build; seis cargas con R2/stock/revisiones, guardado del paso sin reingestión y limpieza verificada. Revisión visual independiente **ship**. [Evidencia](evidencia/2026-11-21/INV-01.b4.smartlink.ui/README.md). Commits 0105111/6edbb31; el hijo sigue en curso por segundo executor/configuración instalada, sin nueva aceptación ni despliegue.

Continuación POS/runtime 2026-11-21: **5/5 Next HTTP/Chromium/Better Auth/Neon y R2 reales**, sin mocks. POS y bulk comparten SKU; corrección, repetición, ingreso, insuficiencia con evidencia/advertencia, JSON sin ventas y cero comprobados contra SQL. Lectura firmada y logout, seis objetos retirados, base/rol/proceso ausentes. Lint y 11/11 trazabilidad exit 0; build anterior reutilizado sin cambios de producto. [Evidencia](evidencia/2026-11-21/INV-01.b4.smartlink.next/README.md). Sin aceptación nueva: falta conectar/probar la UI del workflow, runtime del enlace/storage y dependencias.

Continuación CSV/runtime 2026-11-19: **4/4 Next de producción + Chromium + Better Auth + PostgreSQL reales**, writer independiente con grants mínimos. SKU estable aunque cambie el archivo, corrección 10→12→8, ingreso sin otro movimiento, sesión/reintento, grupos inválidos sin subtotal, insuficiencia y cancelación cero comprobados contra SQL; móvil/teclado y limpieza verificados. Lint y 11/11 trazabilidad exit 0; build anterior reutilizado sin cambios de producto. [Evidencia](evidencia/2026-11-19/INV-01.b4.ui.next/README.md). Se mantienen 24 aceptaciones; cierre POS/dependencias/despliegue pendientes.

Continuación Next/runtime 2026-11-19: **3/3 Next de producción + Chromium + Better Auth + Neon reales**, con writer autenticado independiente y grants mínimos, sin mocks. Captura/corrección/repetición/ingreso/anulación, insuficiencia sin efectos y recuperación, móvil/teclado y limpieza de servidor/base/rol comprobados. Se corrigieron caída por varianza NULL y overflow de tabla poblada; **17/17 navegador controlado**, lint y build final (tipos, 455 páginas) exit 0. [Evidencia y límites](evidencia/2026-11-19/INV-01.b4.manual.next/README.md). Se mantienen 24 aceptaciones; CSV/cierre, dependencias y despliegue pendientes.

Continuación runtime 2026-11-19: **4/4 integraciones con login PostgreSQL independiente y rol efímero de grants mínimos**, exit 0. Manual/POS: 10→12→8, repetición, ingreso y cero; aislamiento entre empresas/sucursales y DML prohibidos comprobados. Rol, grants y catálogos eliminados y verificados; hechos del writer solo en rollback. [Evidencia y límites](evidencia/2026-11-19/INV-01.b4.runtime.connection/README.md). Next conserva su conexión actual; recorrido integrado y dependencias pendientes, sin nueva aceptación.

Continuación HTTP bulk 2026-11-19: **7/7 integraciones manual/bulk y 63/63 regresiones**, exit 0; identidad POS estable, corrección/repetición, ingreso $80.25 → 8025 centavos sin otro movimiento y anulación cero comprobados. JSON inválido/vacío corregido de 500 a 400, con RED/GREEN. [Evidencia y límites](evidencia/2026-11-19/INV-01.b4.bulk/README.md). Navegador controlado manual/CSV **16/16**; corrida final **4/4 Next de producción/Chromium/sesión/DB reales**, con limpieza verificada. Lint y build completo con TypeScript/455 páginas exit 0. Commits `5c4a849` y `8be0ecd`; sin nueva aceptación ni despliegue.

Continuación 2026-11-19, UI manual: se reproduce y corrige el envío de $80.25 como 8025 pesos a la API, además de la pérdida de cero. Nuevo hijo `INV-01.b4.manual.ui`: fecha civil, total corregible, respuesta visible y CSV duplicado consolidado mediante enlace al importador canónico. **13/13 navegador controlado y 51/51 unitarias**, exit 0; casos adicionales, Next real y gates finales en curso. [Evidencia y límites](evidencia/2026-11-19/INV-01.b4.manual.ui/README.md). La matriz conserva 239 filas y 24 aceptaciones, con un hijo adicional; sin migración/despliegue.

Continuación 2026-11-19, captura manual: **5/5 HTTP con Better Auth/DB reales y writer `pulso_app`**, grants mínimos reconstruidos en rollback; corrección/repetición/ingreso/anulación, rollback de lote inválido y rechazo histórico comprobados. Se corrige JSON inválido/vacío → 400 antes de consultar inventario. **51/51 unitarias, tipos, lint sin advertencias, build completo (455/455) y trazabilidad**, exit 0. [Evidencia y límites](evidencia/2026-11-19/INV-01.b4.manual/README.md). Sin nueva aceptación: auth/lookup de sucursal usan conexión dueña y sigue pendiente `b4b`/recorrido Next/UI.

Continuación 2026-11-19, cobertura ejecutiva/menú: se corrige la desaparición del selector ejecutivo tras una consulta inválida (400); ante 401/403 sigue ocultándose. **3/3 navegador, 41/41 unitarias, tipos/lint y build completo (455/455), exit 0**. Incluye teclado, recuperación de sesión y limpieza de fixtures verificada. La prueba final requirió ejecución autorizada fuera del sandbox porque este denegaba `taskkill` sobre el Next propio; los intentos fallidos se conservan en la [evidencia de este incremento](evidencia/2026-11-19/INV-01.b4.coverage.executive/README.md). Sin nuevas aceptaciones: se mantienen 24.

Continuación 2026-11-18, cobertura menú: contexto transaccional de empresa, alcance de sucursal y validación de entrada corregidos; 32/32 unitarias y 7/7 integraciones con rol NOBYPASSRLS (cuatro menú + tres COGS). Nueva candidata 0156 concede solo lectura de costo de receta; DDL/fixtures en rollback, sin aplicación persistente. [Evidencia y límites](evidencia/2026-11-18/INV-01.b4.coverage.menu/README.md). Sesión real/navegador, dependencias y build pendientes; se mantienen 24 aceptaciones.

Cobertura ejecutiva, frontera HTTP: alcance de sucursal, validación de fechas/UUID, pertenencia a empresa y códigos de sesión corregidos; 41/41 unitarias con regresión (incluye nueve de la ruta). [Evidencia](evidencia/2026-11-18/INV-01.b4.coverage.executive/README.md). La preparación posterior del servicio para runtime se acredita a continuación.

Continuación runtime: el servicio ejecutivo ya comparte transacción en todos sus KPIs; candidatas 0157 (catálogo mínimo) y 0158 (RLS SELECT de merma/conteos/plantillas), solo en rollback aislado. [V2: 10/10 con regresión menú/COGS](evidencia/2026-11-18/INV-01.b4.coverage.executive/runtime.md), 41/41 unitarias, tipos/lint correctos. [HTTP con Better Auth real: 6/6](evidencia/2026-11-18/INV-01.b4.coverage.executive/session-http.md), dos casos por lector. Navegador, runtime independiente, escritores de los dominios, dependencias y aceptación siguen pendientes; 24 aceptaciones.

Checkpoint de cobertura 2026-11-18: tipos/lint, snapshots, validador documental y build completo exit 0 (455/455 páginas). Reutilizable para el hito, sin aceptar padres ni declarar despliegue; [resultados y límites](evidencia/2026-11-18/INV-01.b4.coverage.executive/runtime.md).

Actualización 2026-11-18: [investigación contrastada](../docs/2026-11-17-investigacion-estado-faltantes.md) y [creación visible de expedientes recovery](evidencia/2026-11-18/INV-01.c.recovery.create/README.md). POS ya tiene aislamiento de referencias, lectura desde UI, evidencia Next/R2 y candidata RLS 0155; los detalles de runtime y migración constan en `INV-01.b4.storage/rls-candidate.md`. La nueva captura crea y abre el expediente para revisión independiente; no acepta dependencias ni cierra el recorrido integrado. Se mantienen 24 registros aceptados.

Continuación productor POS 2026-11-18: la carga directa de cortes (`/api/sales/cuts/upload`, pantalla y diálogo) dejó el namespace legacy `sales-cuts` y ya escribe la key canónica con el día efectivo del corte, con alcance de sucursal, roles, tamaño/MIME y reutilización del build. 80/80 unitarias focales, 4/4 integración con R2/Neon/sesión reales, `tsc`/lint y build completo (455/455) exit 0; [detalle y límites](evidencia/2026-11-17/INV-01.b4.storage/legacy-producer.md). Sin aceptación: V3 navegador y runtime NOBYPASSRLS siguen pendientes.

V3 navegador del productor POS 2026-11-18: `pos-next-browser.test.ts` recorre `/dashboard/sales/upload` con Next de producción, Better Auth, Neon aislado y R2 reales; sube el CSV por el `<input type="file">`, verifica las dos filas `SALON`/`DELIVERY`, la key canónica, los bytes en el bucket y la lectura autorizada del corte recién creado. 3/3 casos y 39/39 unitarias focales de regresión, exit 0. El recorrido corrigió una navegación a `/dashboard/sales/cuts` (ruta inexistente) y registró que ningún layout monta `<Toaster />`, por lo que los avisos `toast` no se pintan. [Detalle y límites](evidencia/2026-11-17/INV-01.b4.storage/next-browser-v3.md). Sigue pendiente el runtime NOBYPASSRLS; 24 aceptaciones.

Ver [evidencia y límites](evidencia/2026-11-16/CONSOLIDACION/README.md). Se mantienen **24 registros aceptados** (21 previos + `EXC-01.rls` + `EXC-01` + `EXC-02`); no equivalen a 24 funcionalidades completas. NOM-02.c1 y las rutas/UI de recovery quedan como código implementado, sin nueva aceptación. Pasan 110 unitarias iniciales, 33 regresiones de excepciones (con solapamiento), 17 integraciones de nómina/recovery y 3 pruebas de navegador de finiquitos. Se corrigieron la atomicidad del alta humana y el import de servidor en la calculadora. TypeScript pasó antes de regenerar validadores de producción; el build final compila módulos, pero los tipos quedaron bloqueados por 7 errores de base en 6 archivos; los arreglos locales de rutas/páginas ya presentes en el árbol devuelven `tsc --noEmit` a exit 0. EXC-01.rls aporta la migración `0152`, registrada en el journal (`idx 152`) y aplicada en la V2 canónica; con ello se aceptó EXC-01 en V2 (28/28 focales + 12/12 integración). EXC-02 se aceptó en V2/V3 (6/6 integración: sync idempotente, paridad legacy↔canónico y ruta que declara el estado canónico). Las notas S0 inferiores son históricas.

## 0. Base, trazabilidad y aislamiento

- [x] **P0-01** [R/S] Fijar la base de ejecución
- [x] **P0-02** [R/S] Actualizar la matriz de 239 filas
- [x] **P0-03** [R/M] Construir el mapa fila → tarea → evidencia
- [x] **Checkpoint 0.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable. [Evidencia](evidencia/2026-11-11/CHECKPOINT-0/README.md).
- [x] **P0-04** [R/M] Inventariar migraciones por entorno
- [x] **SEC-00** [A/M] Comprobar el arnés de aislamiento
- [x] **P0-05** [R/S] Coordinar los frentes bancario y contable
- [x] **Checkpoint 0.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable. [Evidencia](evidencia/2026-11-11/CHECKPOINT-0/README.md).
- [x] **Puerta 0** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada. [Cierre](evidencia/2026-11-11/CHECKPOINT-0/README.md). Preparación aceptada; ninguna fila funcional se acepta por este cierre.

## 1. Corrección y recuperación del consumo de ventas

- [x] **INV-01.a** [I/P] Definir identidad y revisión de venta consumida — dos hijos aceptados V1/V2; [evidencia](evidencia/2026-11-11/INV-01.a/README.md).
- [x] **INV-01.a1** [I/M] Contrato y caracterización previa al backfill — V1.
- [x] **INV-01.a2** [I/M] Persistencia append-only, cadena y aislamiento — V1/V2 aisladas, 0137 pendiente en main.
- [x] **Checkpoint INV-01.a** — 51 unitarias, 11 de integración, tipos/lint y build exit 0; [resultados](evidencia/2026-11-11/INV-01.a/results.json). Lint conserva tres advertencias de imports previos del schema.
- [x] **INV-01.b** [I/P] Aplicar venta y diferencial de consumo atómicamente — aceptado en entorno aislado con todos sus 20 hijos acreditados. [Aceptación](evidencia/2026-11-22/INV-01.b4.coverage/accepted.md).
- [x] **INV-01.b1** [I/M] Planificador exacto del diferencial — V1; [evidencia](evidencia/2026-11-11/INV-01.b1/README.md).
- [x] **INV-01.b2a** [I/M] RLS de lectura y privilegios mínimos del catálogo para runtime — V1/V2 aisladas; 0138 pendiente en main. [Evidencia](evidencia/2026-11-11/INV-01.b2a/README.md).
- [x] **INV-01.b2** [I/M] Snapshot del servidor, demanda exacta y lector acotado — V1/V2 runtime aisladas. [Evidencia](evidencia/2026-11-11/INV-01.b2/README.md).
- [x] **Checkpoint INV-01.b preparación** — b1/b2a/b2: 85 unitarias, 17 SQL, tipos/lint/build exit 0. [Resultados](evidencia/2026-11-11/INV-01.b2a/results.json). No acepta el writer ni la fila funcional.
- [x] **INV-01.b3a** [I/M] Ingreso por revisión y RLS/privilegios mínimos de aplicación — 0139 y V1/V2 aisladas aceptadas; checkpoint INV-B3 y build corregido exit 0. [Evidencia](evidencia/2026-11-11/INV-01.b3a/README.md).
- [x] **INV-01.b3** [I/M] Aplicación transaccional de venta, stock y revisión — aceptado V1/V2: guardia de movimientos huérfanos, 34 SQL con regresión y build del checkpoint exit 0. [Evidencia](evidencia/2026-11-11/INV-01.b3/README.md).
- [x] **INV-01.b4a** [I/M] Normalización y agrupación exacta de importación — aceptado V1: 103 unitarias focales con trazabilidad, tipos/lint/build exit 0 y dependencia b3 aceptada. [Evidencia](evidencia/2026-11-11/INV-01.b4a/README.md).
- [x] **Checkpoint INV-B3** — b3a/b3/b4a: revisión y corrección de movimientos huérfanos, 34 SQL, 103 unitarias focales, tipos/lint/build exit 0. Aceptación aislada de esos hijos; padre b y recorrido operativo pendientes. [Evidencia](evidencia/2026-11-11/CHECKPOINT-INV-B3/README.md).
- [x] **INV-01.b4b.rls** [I/M] Lectura mínima del nombre de receta bajo runtime — aceptado V1/V2 en copia efímera con LOGIN independiente, sin SELECT general ni DML, RLS y denegaciones reales; 3/3 SQL, 20/20 unitarias, lint y snapshot/journal correctos. Sin aplicación a main ni aceptación del padre. [Evidencia](evidencia/2026-11-22/INV-01.b4b.rls/README.md).
- [x] **INV-01.b4b** [I/M] Conectar ingestión al writer, conservando ingreso no reportado — aceptado V1/V2 del servicio aislado: 109 unitarias, cuatro nativas con commits/login, lint y build final correctos; sin aceptar padres/API/UI/despliegue. [Aceptación](evidencia/2026-11-22/INV-01.b4b/accepted.md).
- [x] **INV-01.b4** [I/M] Conectar captura manual y fronteras bulk/smart-link al writer único — aceptado en entorno aislado con todas sus 14 dependencias acreditadas. [Aceptación](evidencia/2026-11-22/INV-01.b4.coverage/accepted.md).
- [ ] **INV-01.b4.runtime.config** [I/M] Activación explícita de conexión runtime del writer — guard de login/rol/RLS y sin fallback; V1/V2 y Next manual real comprobados, bulk conserva 503. Lint/build con tipos exit 0. [Configuración](evidencia/2026-11-19/INV-01.b4.runtime.config/README.md); [Next](evidencia/2026-11-19/INV-01.b4.manual.next/README.md). Otros orígenes Next, dependencias y despliegue pendientes.
- [ ] **INV-01.b4.manual.next** [A/M] Captura manual Next→login runtime→stock — **3/3 con producción Next, Chromium, Better Auth y DB reales**, sin mocks; dueño configurado → 503, corrección/repetición/ingreso/cero, insuficiencia 409 sin efectos y recuperación. Móvil/teclado y retiro de servidor/base/rol verificados. [Evidencia](evidencia/2026-11-19/INV-01.b4.manual.next/README.md). Dependencias y aceptación pendientes.
- [ ] **INV-01.b4.manual** [I/M] Captura manual atómica con writer — HTTP con sesión real y Next→writer de login independiente→stock comprobados, incluidos corrección, repetición, ingreso, cero y rollback por insuficiencia. JSON inválido/vacío → 400. [HTTP](evidencia/2026-11-19/INV-01.b4.manual/README.md); [Next](evidencia/2026-11-19/INV-01.b4.manual.next/README.md). Dependencia b4b y aceptación pendientes.
- [ ] **INV-01.b4.manual.ui** [I/M] Captura visible: pesos, cero/NULL, fecha, feedback y consolidación del CSV — **17/17 navegador controlado y 3/3 Next real**; varianza sin conteos ya no desmonta la pantalla ni afirma conformidad. Móvil y teclado con tabla poblada, lint/build con tipos y 455 páginas exit 0. [Evidencia](evidencia/2026-11-19/INV-01.b4.manual.next/README.md). Dependencias y aceptación pendientes.
- [ ] **INV-01.b4.bulk** [I/M] Frontera bulk: permiso, identidad y cobertura de ingreso — HTTP con sesión/DB reales y writer NOBYPASSRLS comprobado; corrección/repetición/ingreso/cero y alcance, JSON inválido/vacío → 400. [Evidencia](evidencia/2026-11-19/INV-01.b4.bulk/README.md). Dependencias, conexión runtime independiente y aceptación pendientes.
- [ ] **INV-01.b4.smartlink** [I/M] Frontera POS del cierre: alcance y vinculación por día — pruebas de ruta, aceptación real pendiente. [Evidencia](evidencia/2026-11-11/INV-01.b4/README.md).
- [ ] **INV-01.b4.ui** [I/M] UI de importación: corrección, repetición, cobertura y recuperación — 9 pruebas Chromium y build exit 0; aceptación integrada pendiente. [Evidencia](evidencia/2026-11-11/INV-01.b4.ui/README.md).
- [x] **INV-01.b4.smartlink.ui** [I/M] Aceptado V1/V3 en entorno aislado; ambos ejecutores y copia instalada/editada desde catálogo verificados con Next real (`BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`) y `POS_FILES_RUNTIME_DATABASE_URL` activo (4/4), además de 36/36 + 9/9 controladas. Copias históricas sin flag y despliegue quedan fuera de alcance. [Aceptación](evidencia/2026-11-22/INV-01.b4.storage/accepted.md).
- [x] **INV-01.b4.smartlink.next** [A/M] Aceptado V2 en entorno aislado; 4/4 Next/Chromium/Better Auth/Neon/R2 reales con writer y `POS_FILES_RUNTIME_DATABASE_URL` en LOGIN mínimo y limpieza verificada. [Aceptación](evidencia/2026-11-22/INV-01.b4.storage/accepted.md).
- [ ] **INV-01.b4.ui.next** [A/M] CSV Next→writer runtime→stock — código implementado, 4/4 reales y limpieza verificada: SKU/archivo/receta distintos, corrección y cobertura, grupos inválidos/stock, sesión y cero, con oráculos SQL y base desechable. [Evidencia](evidencia/2026-11-19/INV-01.b4.ui.next/README.md). Sin aceptación ni despliegue.
- [x] **INV-01.b4.storage** [I/M] Aceptado V1/V2/V3 en entorno aislado; almacenamiento POS privado durable, lectura autorizada, productor directo y selección explícita `POS_FILES_RUNTIME_DATABASE_URL` (47/47 unitarias, 6/6 SQL selección, 4/4 Next con rechazo 503 de URI dueña, 4/4 R2/sesión y 3/3 navegador del productor directo). Sin migración en operativo/main ni backfill legacy. [Aceptación](evidencia/2026-11-22/INV-01.b4.storage/accepted.md).
- [x] **INV-01.b4.coverage** [I/P] Propagar cobertura canónica de ingresos a consumidores financieros — aceptado en entorno aislado con COGS, menú y ejecutivo acreditados. [Aceptación](evidencia/2026-11-22/INV-01.b4.coverage/accepted.md).
- [x] **INV-01.b4.coverage.cogs** [I/M] Cobertura en COGS, API y pantalla — aceptado V1/V2/V3 en entorno aislado (unitarias, 0154 en rollback bajo `pulso_app`, HTTP Better Auth y Next producción `BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`). [Aceptación](evidencia/2026-11-22/INV-01.b4.coverage/accepted.md).
- [x] **INV-01.b4.coverage.executive** [I/M] Cobertura por sucursal y consolidado ejecutivo — aceptado V1/V2/V3 en entorno aislado (unitarias, 0157/0158 en rollback bajo `pulso_app`, HTTP Better Auth y Next producción `BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`). [Aceptación](evidencia/2026-11-22/INV-01.b4.coverage/accepted.md).
- [x] **INV-01.b4.coverage.menu** [I/M] Cobertura y rentabilidad en ingeniería de menú — aceptado V1/V2/V3 en entorno aislado (unitarias, 0156 en rollback bajo `pulso_app`, HTTP Better Auth y Next producción `BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ`). [Aceptación](evidencia/2026-11-22/INV-01.b4.coverage/accepted.md).
- [x] **INV-01.c** [I/P] Recuperar fallos y carreras — aceptado en entorno aislado con concurrencia (`races`) y toda la cadena de recuperación histórica (`contract` → `ui-routes`) acreditadas. [Aceptación](evidencia/2026-11-22/INV-01.c.recovery.ui-routes/accepted.md).
- [x] **INV-01.c.races** [A/M] Carreras con commits runtime y bloqueo histórico — aceptado V2 en entorno aislado (5/5 `sale-consumption-concurrency-db.test.ts` con dos conexiones `pulso_app` SERIALIZABLE). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery** [I/M] Implementar recuperación histórica con evidencia, aprobación e idempotencia — aceptado V2 en entorno aislado con todas sus 16 dependencias acreditadas. [Aceptación](evidencia/2026-11-22/INV-01.c.recovery.ui-routes/accepted.md).
- [x] **INV-01.c.recovery.contract** [I/M] Preparar expediente y verificar coherencia de revisión — aceptado V1 (14/14). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery.objects** [I/M] Verificar contenido de evidencias privadas con hash, tamaño y timeout — aceptado V1/V2 con objetos privados reales en R2 (`sale-recovery-objects-r2-db.test.ts`, 1/1 + 8/8 unitarias). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery.persistence** [I/M] Persistir expediente y decisión con aislamiento e inmutabilidad — aceptado V1/V2 (7/7 Neon `pulso_app`, 0143 en rollback). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery.subject.schema** [I/M] Añadir SALE_RECOVERY al catálogo canónico — aceptado V1/V2 (2/2 Neon `pulso_app`, 0144). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery.subject.access** [I/M] Cargar, leer y retirar evidencia de recuperación con sesión/alcance — aceptado V1/V2 (9 unitarias + SQL Neon `pulso_app`). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery.attestation.schema** [I/M] Persistir atestaciones inmutables de documentos verificados — aceptado V1/V2 (SQL Neon `pulso_app`, 0145 en rollback). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery.attestation.service** [I/M] Verificar contenido y atestiguar desde sesión administrativa — aceptado V1/V2 (8 unitarias + SQL Neon `pulso_app`). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery.historical** [I/M] Reconstruir receta histórica desde documento atestiguado — aceptado V1/V2 (7 unitarias + SQL Neon `pulso_app`). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery.provenance** [I/M] Vincular expediente con atestación exacta y precisión nativa — aceptado V1/V2 (3/3 Neon JSONB/microsegundos). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery.sources** [I/M] Leer fuentes SALE/NO_PRIOR_CONSUMPTION desde documentos atestiguados — aceptado V1/V2 (9 unitarias + SQL Neon `pulso_app`). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery.proposal.service** [I/M] Preparar y registrar expediente desde las tres fuentes del servidor — aceptado V1/V2 (3 unitarias + 8/8 Neon `pulso_app`). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery.decision.service** [I/M] Decisión administrativa independiente ligada a propuesta y estado verificado — aceptado V1/V2 (14 unitarias + 5/5 Neon `pulso_app`). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery.apply** [I/M] Aplicación auditada e idempotente de recuperación histórica bajo AUD-02 — aceptado V1/V2 (10 unitarias + 6/6 apply + 3/3 E2E Neon `pulso_app`). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery-services/accepted.md).
- [x] **INV-01.c.recovery.ui-routes** [I/M] Rutas de propuesta y diálogo de revisión/aplicación — aceptado V1/V2/V3 en entorno aislado (25 unitarias rutas, 4/4 Playwright controlado y 1/1 Next producción `BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ` + Chromium + Better Auth + Neon + R2 reales con segregación de funciones, `AUD-02`, reintento idempotente y limpieza verificada). [Aceptación](evidencia/2026-11-22/INV-01.c.recovery.ui-routes/accepted.md).
- [x] **Checkpoint 1.1** — revisados todos los hijos de `INV-01.a`/`b`/`c`/`d` e `INV-02`, evidencia, build `BUILD_ID: 3uHsQamaXwpx8-UdKZkBZ` y trazabilidad.
- [x] **INV-01.d** [A/M] Aceptar corrección y anulación por API/UI — aceptado V3 en entorno aislado (13/13 recorridos reales Next producción + Chromium + Better Auth + Neon + R2). [Aceptación](evidencia/2026-11-22/INV-01.d/accepted.md).
- [x] **INV-02** [I/P] Definir quién consume cada receta — aceptado V1/V2 en entorno aislado con todos sus 6 hijos acreditados. [Aceptación](evidencia/2026-11-22/INV-02/accepted.md).
- [x] **INV-02.contract** [I/S] Contrato por versión/vigencia — aceptado V1 (20/20). [Aceptación](evidencia/2026-11-22/INV-02/accepted.md).
- [x] **INV-02.schema** [I/M] Persistencia e aislamiento — aceptado V1/V2 (14 PGlite + 8/8 PostgreSQL nativo `0159`). [Aceptación](evidencia/2026-11-22/INV-02/accepted.md).
- [x] **INV-02.publish.rls** [I/M] Catálogo de versiones y bitácora mínima — aceptado V1/V2 (6 PGlite + 8/8 PostgreSQL nativo `0160`). [Aceptación](evidencia/2026-11-22/INV-02/accepted.md).
- [x] **INV-02.publish** [I/M] Publicación auditada y retroactividad — aceptado V1/V2 (47 unitarias/PGlite + 8/8 PostgreSQL nativo con 2 carreras reales y rollback AUD-02). [Aceptación](evidencia/2026-11-22/INV-02/accepted.md).
- [x] **INV-02.snapshot** [I/M] Lector de versión y demanda congelada — aceptado V1/V2 (53 unitarias/PGlite + 8/8 PostgreSQL nativo). [Aceptación](evidencia/2026-11-22/INV-02/accepted.md).
- [x] **INV-02.apply** [I/M] Writer y compensaciones históricas — aceptado V1/V2 (99 unitarias/PGlite + 8/8 PostgreSQL nativo; elaborado bloqueado hasta PROD-01.b). [Aceptación](evidencia/2026-11-22/INV-02/accepted.md).
- [x] **Puerta 1** — todos los hijos y padres del frente 1 (`INV-01.a`/`b`/`c`/`d` e `INV-02`) aceptados en entorno aislado; sin despliegue operativo ni cierre de fila `11.11` hasta `VAL-01.M01-M17.M11`.

## 2. Nómina calculada y explicable

- [x] **NOM-01** [I/M] Fijar unidad salarial y vigencias — aceptado V1/V2 (`B1+B2`, `eba576d`); [evidencia](evidencia/2026-11-11/NOM-01/README.md).
- [x] **NOM-02.a** [I/M] Calcular base desde asistencia aprobada — aceptado V1/V2 (`B2`, `eba576d`); [evidencia](evidencia/2026-11-11/NOM-01/README.md).
- [x] **NOM-02.b** [I/M] Incorporar horas extra aprobadas — aceptado V1/V2 (`B3`, `2f4a0e7`); [evidencia](evidencia/2026-11-11/NOM-02.b/README.md).
- [ ] **Checkpoint 2.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **NOM-02.c1** [I/M] Incorporar vacaciones y permisos — código local; V1 actual: distingue saldo/dato ausente/fallo de consulta (`AVAILABLE`/`MISSING`/`QUERY_ERROR` + justificación explícita) con 7 unitarias nuevas y 15 de regresión; V2 regresión de nómina 14/14 en Neon aislado `pulso_app`. Saldos históricos por período y test V2 dedicado a `MISSING`/`QUERY_ERROR` pendientes. [Balance-status](evidencia/2026-11-17/NOM-02.c1-balance-status/README.md); [consolidación](evidencia/2026-11-16/CONSOLIDACION/README.md).
- [ ] **NOM-02.c2** [I/M] Incorporar bonos e incidencias
- [ ] **NOM-02.d1** [I/M] Calcular ISR ordinario
- [ ] **Checkpoint 2.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **NOM-02.d2** [I/M] Calcular deducción obrera de seguridad social
- [ ] **NOM-02.d3** [I/M] Aplicar préstamos y descuentos autorizados
- [ ] **NOM-02.e** [I/M] Sustituir la carga patronal fija del 35%
- [ ] **Checkpoint 2.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **NOM-06** [I/M] Bloquear resultados incompletos
- [ ] **NOM-03** [I/M] Aprobar un snapshot inmutable
- [ ] **NOM-04.a** [I/M] Unificar recibos y exportación
- [ ] **Checkpoint 2.4** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **NOM-04.b** [A/M] Aceptar timbrado con FiscalAPI existente
- [ ] **NOM-05** [I/M] Enlazar obligación neta con tesorería
- [ ] **Puerta 2** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## 3. Banca, comisiones y coordinación con FC-12

- [ ] **SEC-05.tesoreria** [A/M] Aceptar RLS y privilegios de tesorería
- [ ] **BAN-01** [A/M] Aceptar cuentas e importación bancaria
- [ ] **BAN-04** [A/M] Aceptar matching de egresos
- [ ] **Checkpoint 3.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **BAN-05** [I/M] Completar identidad de ingresos esperados
- [ ] **BAN-06.a** [A/M] Aceptar conciliación de depósitos existente
- [ ] **BAN-06.b** [I/M] Resolver corrección auditada de un depósito contabilizado
- [ ] **Checkpoint 3.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **FIN-06.a** [I/M] Separar importe reportado y conciliado
- [ ] **FIN-06.b** [A/M] Aceptar comisiones e ingresos por canal
- [ ] **FIN-01** [I/M] Distinguir saldo conciliado de caja proyectada
- [ ] **Checkpoint 3.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **Puerta 3** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## 4. Evidencia, excepciones y aprobaciones

- [x] **AUD-02** [I/M] Hacer obligatoria la auditoría crítica — aceptado V1/V2 (`C1+C2`, `eba576d`); [evidencia](evidencia/2026-11-11/AUD-02/README.md) y [cierre V2](evidencia/2026-11-11/EVI-02.a/README.md).
- [x] **EVI-02.a** [I/M] Añadir sujetos de evidencia — aceptado V1/V2 (`C2`, `eba576d`); [evidencia](evidencia/2026-11-11/EVI-02.a/README.md).
- [x] **EVI-02.b** [I/M] Conectar evidencia al recorrido visible — aceptado V2/V3 (`C3`, `2f4a0e7`); [evidencia](evidencia/2026-11-11/EVI-02.b/README.md).
- [ ] **Checkpoint 4.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [x] **EXC-01** [A/M] Aceptar persistencia canónica de excepciones — aceptado V2: 28/28 regresiones focales, 12/12 integración sobre la migración `0152` registrada en el journal, tsc y lint exit 0. Sin HTTP/UI ni aplicación al operativo (OPS-03). [Evidencia](evidencia/2026-11-16/EXC-01/README.md).
- [x] **EXC-01.rls** [I/M] Aportar migración de aislamiento y verificar runtime sin DDL improvisado en beforeAll — aceptado V2: migración `0152`, 12/12 integración en Neon aislado, tipos y lint exit 0. [Evidencia](evidencia/2026-11-16/EXC-01.rls/README.md).
- [x] **EXC-02** [A/M] Aceptar sync legacy → canónico - aceptado V2/V3: repetir el sync no duplica (mismas identidades e ids), paridad de conteos/identidades legacy↔canónico, bandera `EXCEPTIONS_CANONICAL_READ` reversible sin mutar la tabla y feed legacy declara `canonical` cuando existe. 33/33 regresiones focales y 6/6 integración (5 V2 + 1 V3), tsc y lint exit 0. [Evidencia](evidencia/2026-11-16/EXC-02/README.md).
- [ ] **EXC-03.a** [A/M] Probar lifecycle concurrente
- [ ] **Checkpoint 4.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **EXC-03.b** [A/M] Probar job recuperable de SLA
- [ ] **EXC-05** [I/M] Conectar acciones canónicas en la UI
- [ ] **EXC-04.merma** [I/M] Completar excepción de merma
- [ ] **Checkpoint 4.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **EXC-04.presupuesto** [I/M] Completar excepción de presupuesto
- [ ] **EXC-04.ausencia** [I/M] Completar excepción de ausencia
- [ ] **EXC-04.banco** [I/M] Completar excepción bancaria
- [ ] **Checkpoint 4.4** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **APR-01** [I/P] Alinear aprobación de documentos
- [ ] **Puerta 4** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## 5. Producción, conteos y costos de inventario

- [ ] **PROD-00** [R/S] Rastrear modelos y consumidores de producción
- [ ] **PROD-01.a** [I/M] Crear lote de producto terminado
- [ ] **PROD-01.b** [I/M] Consumir elaborado sin descontar dos veces
- [ ] **Checkpoint 5.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **PROD-02** [I/M] Unificar planificación y ejecución visible
- [ ] **REC-03A** [R/M] Revalidar lotes con anomalía histórica
- [ ] **REC-03B** [A/M] Aceptar protocolo de corrección histórica
- [ ] **Checkpoint 5.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **INV-03** [I/M] Completar conteo → revisión → ajuste
- [ ] **INV-04** [I/M] Congelar costo y varianza del período
- [ ] **INV-05** [A/M] Aceptar PAR/min-max y snapshots
- [ ] **Checkpoint 5.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **Puerta 5** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## 6. Operación, mantenimiento, delivery y cumplimiento

- [ ] **OPE-00** [R/S] Rastrear writers y recorridos operativos
- [ ] **OPE-01.a** [I/M] Completar configuración de recurrencias
- [ ] **OPE-01.b** [I/M] Generar órdenes de forma durable
- [ ] **Checkpoint 6.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **OPE-02** [I/M] Completar historial de mantenimiento
- [ ] **OPE-03.aceite** [I/M] Completar medición de aceite
- [ ] **OPE-03.cocina** [A/M] Aceptar rutina de cocina
- [ ] **Checkpoint 6.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **OPE-03.salon** [A/M] Aceptar rutina de salón/counter
- [ ] **OPE-03.gerente** [A/M] Aceptar checklist del gerente
- [ ] **OPE-03.handoff** [I/M] Completar entrega de turno
- [ ] **Checkpoint 6.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **OPE-04** [I/M] Capturar disponibilidad delivery
- [ ] **CMP-01** [I/M] Cerrar planes correctivos con historial
- [ ] **Puerta 6** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## 7. Finanzas históricas, centros de costo y canales

- [ ] **FIN-02.a** [I/M] Fijar contrato de cierre financiero
- [ ] **FIN-03.a** [I/M] Completar imputación a centro de costo
- [ ] **FIN-03.b** [I/M] Reportar P&L por centro de costo
- [ ] **Checkpoint 7.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **FIN-04** [I/M] Completar solicitud de pago trazable
- [ ] **FIN-05** [A/M] Aceptar presupuestos y períodos
- [ ] **FIN-02.b** [I/M] Leer P&L congelado
- [ ] **Checkpoint 7.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **FIN-07** [I/P] Definir indicadores económicos
- [ ] **INT-01** [I/M] Versionar mapeo de canal a receta/SKU
- [ ] **INT-02** [I/P] Completar importación por fuente disponible
- [ ] **Checkpoint 7.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **INT-03** [A/M] Aceptar corte → mix → settlement → depósito
- [ ] **Puerta 7** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## 8. Seguridad restante, aceptación y despliegue

- [ ] **SEC-05.nomina** [A/M] Aceptar aislamiento de nómina
- [ ] **SEC-05.inventario** [I/M] Completar aislamiento de inventario
- [ ] **SEC-05.resto** [I/P] Completar aislamiento por dominio
- [ ] **Checkpoint 8.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **PER-01** [A/P] Demostrar ocho perfiles
- [ ] **VAL-01.M01-M17** [A/P] Aceptar cada módulo y sus filas
- [ ] **VAL-01.transversal** [A/P] Aceptar recorridos transversales
- [ ] **Checkpoint 8.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **OPS-03** [A/P] Aplicar lotes revisados al entorno identificado
- [ ] **VAL-02** [A/P] Ejecutar piloto, carga y restauración
- [ ] **VAL-03** [A/S] Cerrar trazabilidad de las 239 filas
- [ ] **Checkpoint 8.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **Puerta 8** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## Registro de ejecución

| ID/hijo | Estado | HEAD/diff | Entorno | Comando / exit | Evidencia | Filas | Pendiente |
|---|---|---|---|---|---|---|---|
| P0-01 | aceptado D | ba88018 + diff inicial | local | git HEAD/status/diff, exit 0 | [Base](evidencia/2026-11-11/P0-01/README.md) | todas, sin aceptación funcional | Captura inmutable; entorno nuevo registrado aparte |
| P0-02 | aceptado D | ba88018 + CSV nuevo | local | validador, exit 0 | [Matriz](evidencia/2026-11-11/P0-02/README.md) | 239; delta 17.12–17.14 | Aceptación funcional de cada fila pendiente |
| P0-03 | aceptado D | ba88018 + mapa/validador/pruebas | local | 11 unitarias de trazabilidad y validador, exit 0 | [Mapa](evidencia/2026-11-11/P0-03/README.md) | 239 | Ejecutar los hijos y conservar evidencia por recorrido |
| P0-04 | aceptado D,V2 en entorno nuevo | ba88018 + diagnóstico/baseline | Neon nuevo main + rama aislada | dos manifiestos de solo lectura, exit 0; 9 unitarias | [Inventario](evidencia/2026-11-11/P0-04/README.md) | transversal | Cuenta anterior no verificada; 136 fuentes BASELINED, no replay histórico |
| SEC-00 | aceptado V2 | ba88018 + arnés focal | rama br-round-voice-belheola | 4/4, exit 0 | [Aislamiento](evidencia/2026-11-11/SEC-00/README.md) | transversal | SEC-05 por dominio y V3 no sustituidos por este arnés |
| P0-05 | aceptado D | ba88018 + coordinación documental | local | revisión de contratos + validador, exit 0 | [Coordinación](evidencia/2026-11-11/P0-05/README.md) | 17.12–17.16; 18.R5–R8 | Conservar propiedad de FC-12; no marcarlo terminado |
| NEON-NEW | instalación verificada | baseline de esquema local hasta 0136 | soft-cloud-50478212 | transacción aditiva + catálogos, correctos | [Instalación](evidencia/2026-11-11/NEON-NEW/README.md) | ninguna aceptada por instalar | Base vacía; sin datos de otra cuenta ni aplicación desplegada |
| INV-01.a1 | aceptado V1 | ba88018 + contrato/pruebas | local + caracterización Neon | 27 unitarias nuevas, tipos/lint, exit 0 | [Contrato](evidencia/2026-11-11/INV-01.a1/README.md) | 11.11 parcial | No convierte head desconocido en cero; sin backfill |
| INV-01.a2 | aceptado V1,V2 | ba88018 + schema/0137/journal/snapshot/prueba | br-round-voice-belheola | 7 SQL nuevas + 4 del arnés, exit 0 | [Persistencia](evidencia/2026-11-11/INV-01.a2/README.md) | 11.11 parcial | 0137 pendiente en main; sin aplicación real de stock |
| INV-01.a | aceptado V1,V2 | dos hijos + incremento documental | local/aislado | 51 unitarias, 11 SQL, tipos/lint/build exit 0 | [Checkpoint](evidencia/2026-11-11/INV-01.a/results.json) | 11.11 sigue parcial | INV-01.b/c/d e INV-02 pendientes |
| INV-01.b | en curso, b1/b2a/b2 aceptados | ba88018 + incrementos separados | local + rama aislada | checkpoint 85 unitarias/17 SQL, tipos/lint/build exit 0 | [Preparación](evidencia/2026-11-11/INV-01.b/README.md) | 11.11 sigue parcial | b3 aceptado; b4: almacenamiento POS, cobertura financiera y aceptación integrada pendientes |
| INV-01.b1 | aceptado V1 | ba88018 + delta/prueba | local | 20 nuevas, 150 secuencias, tipos/lint/build exit 0 | [Planificador](evidencia/2026-11-11/INV-01.b1/README.md) | 11.11 sigue parcial | No acredita aplicación física |
| INV-01.b2a | aceptado V1,V2 | ba88018 + schema/0138/journal/snapshot/prueba | br-round-voice-belheola | 5 SQL nuevas, catálogo y grants; checkpoint 85 unitarias/17 SQL, tipos/lint/build exit 0 | [Catálogo](evidencia/2026-11-11/INV-01.b2a/README.md) | 11.11 sigue parcial | 0138 pendiente main; owner/writers en SEC-05 |
| INV-01.b2 | aceptado V1,V2 | ba88018 + snapshot/reader/pruebas | local + rama aislada | snapshot runtime y JSONB, dentro de 17 SQL; checkpoint 85 unitarias y build exit 0 | [Snapshot](evidencia/2026-11-11/INV-01.b2/README.md) | 11.11 sigue parcial | b3/b4 y recuperación/aceptación pendientes |
| INV-01.b3a | aceptado V1,V2 (CHECKPOINT-INV-B3) | ba88018 + schema/0139/journal/snapshot/prueba; revisado en 5a05fb9 + diff | br-round-voice-belheola | 34 SQL conjuntas, 83+20 unitarias, tsc/lint/build exit 0 | [Ingreso/permisos](evidencia/2026-11-11/INV-01.b3a/README.md) | 11.11 sigue parcial | 0139 pendiente en main; padre b y recorrido operativo pendientes |
| INV-01.b3 | aceptado V1,V2 (CHECKPOINT-INV-B3) | ba88018 + servicio/prueba real; fix huérfanos en 5a05fb9 + diff | br-round-voice-belheola | 34 SQL conjuntas, 83+20 unitarias, tsc/lint/build exit 0 | [Aplicación](evidencia/2026-11-11/CHECKPOINT-INV-B3/README.md) | 11.11 sigue parcial | Conectar b4 y aceptar c/d; sin activación operativa |
| INV-01.b4a | aceptado V1 (CHECKPOINT-INV-B3) | ba88018 + parser/plan/pruebas; validado en 5a05fb9 + diff | local, fase pura | 103 unitarias/6 archivos, tsc/lint/validador/build exit 0 | [Normalización/agrupación](evidencia/2026-11-11/INV-01.b4a/README.md) | 11.11 sigue parcial | Conectar writer en b4b/b4; sin aceptación operativa |
| INV-01.b4b.rls | código implementado; V2 comprobada | 2be55da + 0141/journal/snapshot/prueba SQL | rama aislada, GRANT dentro de rollback | 15 SQL conjuntas exit 0; DML/aislamiento comprobados | [Permiso mínimo](evidencia/2026-11-11/INV-01.b4b/README.md) | 11.11 sigue parcial | 0141 pendiente de aplicación; dependencias y checkpoint global sin aceptar |
| INV-01.b4b | código implementado; V1/V2 focales y build comprobados | 2be55da + adaptador/writer/pruebas | local + rama aislada | 109 unitarias, 15 SQL, tsc global/lint/validador y build exit 0; heap 4 GB para build | [Ingestión atómica](evidencia/2026-11-11/INV-01.b4b/README.md) | 11.11 sigue parcial | Dependencias/checkpoint; cobertura en lectores y fronteras API/UI en b4/d; sin despliegue |
| INV-01.b4.manual | aceptado en alcance aislado 2026-11-22 | d05eae09 + árbol compartido | Next producción/Chromium/Better Auth/PostgreSQL, writer LOGIN mínimo | 4/4 seleccionadas, 28 focales/17 controladas, lint/build exit 0; ver criterios por hijo | [Aceptación](evidencia/2026-11-22/INV-01.b4.manual-csv-next/accepted.md) | 11.11 sigue parcial | Copia existente, POS/storage/cobertura/recovery y aceptación integrada pendientes |
| INV-01.b4.bulk | aceptado en alcance aislado 2026-11-22 | d05eae09 + árbol compartido | Next producción/Chromium/Better Auth/PostgreSQL, writer LOGIN mínimo | 4/4 seleccionadas, 28 focales/17 controladas, lint/build exit 0; ver criterios por hijo | [Aceptación](evidencia/2026-11-22/INV-01.b4.manual-csv-next/accepted.md) | 11.11 sigue parcial | Copia existente, POS/storage/cobertura/recovery y aceptación integrada pendientes |
| INV-01.b4.smartlink | código implementado; pruebas de frontera comprobadas | mismo diff | local; persistencia común V2 en b4b | 4 pruebas nuevas incluidas en 124, tsc/lint exit 0 | [Archivo POS del cierre](evidencia/2026-11-11/INV-01.b4/README.md) | 11.11 sigue parcial | HTTP/SQL real de vinculación, storage durable y workflow completo pendientes |
| INV-01.b4.ui | aceptado en alcance aislado 2026-11-22 | d05eae09 + árbol compartido | Next producción/Chromium/Better Auth/PostgreSQL, writer LOGIN mínimo | 4/4 seleccionadas, 28 focales/17 controladas, lint/build exit 0; ver criterios por hijo | [Aceptación](evidencia/2026-11-22/INV-01.b4.manual-csv-next/accepted.md) | 11.11 sigue parcial | Copia existente, POS/storage/cobertura/recovery y aceptación integrada pendientes |
| INV-01.c.races | V2 comprobada; aceptación dependiente pendiente | fddc05d inicial → a816208 concurrente + test nuevo | br-round-voice-belheola, conexiones reales pulso_app | 5 carreras nuevas + 16 regresiones SQL: 21/21 exit 0; tipado focal ES2017/lint exit 0 | [Concurrencia y manifiestos](evidencia/2026-11-11/INV-01.c.races/README.md) | 11.11 sigue parcial | INV-01.b sin aceptar; reparación auditada en c.recovery pendiente; fixtures sintéticas append-only retenidas |
| INV-01.c.recovery.contract | Código implementado; V1 comprobada, dependencias sin aceptar | 3a5d60c + diff compartido | Windows local; contrato puro, sin DB | 54/54 unitarias; tipos globales, lint y build exit 0 | [Contrato y resultados](evidencia/2026-11-11/INV-01.c.recovery.contract/README.md) | 11.11 sigue parcial | Persistencia, lectura de pruebas verificadas y aplicación auditada pendientes |
| INV-01.c.recovery.* (10 hijos: objects, persistence, subject.schema/access, attestation.schema/service, historical, provenance, sources, proposal.service) | código implementado (en mapa; ver filas 49–58) | árbol local + 0143–0145 | local + br-round-voice-belheola | unitarias/SQL focales en evidencias propias; build en proposal.service exit 0 (suite global con timeout seed) | [Propuestas](evidencia/2026-11-11/INV-01.c.recovery.proposal.service/README.md) | 11.11 sigue parcial | Decisión y aplicación implementadas en hijos A2/A3; aceptación de dependencias, rutas/UI y sesión/R2 reales pendiente |
| NOM-01 | aceptado V1,V2 | eba576d + diff B2 | local + br-round-voice-belheola (pulso_app) | 17/17 + 7/7 unitarias y 6/6 SQL Neon (con NOM-02.a), tsc/lint exit 0 | [NOM-01](evidencia/2026-11-11/NOM-01/README.md) | 12.x parcial | NOM-02.b..e y NOM-03..06 pendientes |
| NOM-02.a | aceptado V1,V2 | eba576d + diff B2 | local + br-round-voice-belheola (pulso_app) | 14/14 NOM-02.a (38/38 nómina) y 6/6 SQL Neon, tsc/lint exit 0 | [NOM-01](evidencia/2026-11-11/NOM-01/README.md) | 12.x parcial | Siguiente: NOM-02.b (horas extra) |
| AUD-02 | aceptado V1,V2 | eba576d + diff C1/S/C2 | PGlite + br-round-voice-belheola (pulso_app) | 19/19 PGlite + 10/10 SQL Neon atomicidad, tsc/lint exit 0 | [AUD-02](evidencia/2026-11-11/AUD-02/README.md) | 01.06 parcial | Enum `SALE_RECOVERY_APPLY`/`SALE_VOID` diferido a migración A3/INV-01.d |
| EVI-02.a | aceptado V1,V2 | eba576d + diff C2 | local + br-round-voice-belheola (pulso_app) | 18/18 unitarias + 7/7 SQL Neon, tsc/lint exit 0 | [EVI-02.a](evidencia/2026-11-11/EVI-02.a/README.md) | 01.07 parcial | Siguiente: EVI-02.b (recorrido visible/UI) |
| INV-01.c.recovery.decision.service | código implementado; V1/V2 comprobadas | eba576d + diff A2 | local + br-round-voice-belheola (pulso_app) | 14/14 + 17 regresión y 5/5 SQL Neon, tsc/lint exit 0 | [Decisión recovery](evidencia/2026-11-11/INV-01.c.recovery.decision.service/README.md) | 11.11 sigue parcial | Dependencia INV-01.b y aceptación integrada pendientes; A3 implementado |
| NOM-02.b | aceptado V1,V2 | 2f4a0e7 + diff B3 | local + ep-cold-morning-bewqoz3o (pulso_app) | 15/15 NOM-02.b (46/46 nómina) y 10/10 SQL Neon, tsc/lint exit 0 | [NOM-02.b](evidencia/2026-11-11/NOM-02.b/README.md) | 12.x parcial | Siguiente: NOM-02.c1 (vacaciones/permisos) y NOM-02.c2 |
| EVI-02.b | aceptado V2,V3 | 2f4a0e7 + diff C3 | local + ep-cold-morning-bewqoz3o (pulso_app) | 18/18 unitarias + 9/9 integración DB/HTTP Neon, tsc/lint exit 0 | [EVI-02.b](evidencia/2026-11-11/EVI-02.b/README.md) | 01.07 parcial | Siguiente: EXC-01..05 (ciclo canónico de excepciones) |
| INV-01.c.recovery.apply | código implementado; V1/V2 comprobadas | 2f4a0e7 + diff A3 | local + ep-cold-morning-bewqoz3o (pulso_app) | 10/10 unitarias + 6/6 SQL Neon, tsc/lint exit 0 | [Apply recovery](evidencia/2026-11-11/INV-01.c.recovery.apply/README.md) | 11.11 sigue parcial | Dependencia INV-01.b pendiente |
| NOM-02.c1 | código implementado; V1 actual | 189376a + cambios locales | Windows local | 110 unitarias conjuntas y 14/14 SQL nómina; tipos globales finales bloqueados por validadores de base | [Consolidación](evidencia/2026-11-16/CONSOLIDACION/README.md) | 12.x parcial | Revisión de fuentes/saldos y aceptación integrada |
| EXC-01 | aceptado V2 | `5f6a227` (migración `0152` + journal) | Neon aislado `ep-cold-morning-bewqoz3o` (pulso_app NOBYPASSRLS) | 28/28 focales + 12/12 integración, tsc y lint exit 0 | [EXC-01](evidencia/2026-11-16/EXC-01/README.md) | transversal | V3 (HTTP/sesión/UI), VAL-01 y 02.03–02.04/05.*; `0152` sin aplicar a operativo (OPS-03) |
| EXC-02 | aceptado V2,V3 | `754c7ea` | Neon aislado `ep-cold-morning-bewqoz3o` (PostgreSQL real; sesión mockeada solo en la ruta V3) | 33/33 focales + 6/6 integración (5 V2 + 1 V3), tsc y lint exit 0 | [EXC-02](evidencia/2026-11-16/EXC-02/README.md) | 01.07 y ciclo de excepciones | EXC-03.a/EXC-05, navegador y disparo Inngest quedan pendientes |
| INV-01.c.recovery.ui-routes | código implementado; V1 actual | 189376a + cambios locales | Windows local | unitarias pasan; 3/3 SQL de servicios recovery con TLS del sistema | [Consolidación](evidencia/2026-11-16/CONSOLIDACION/README.md) | 11.11 parcial | INV-01.b, HTTP/sesión/R2/navegador y carreras reales |
| EXC-01.rls | aceptado V2 | `5f6a227` (journal) sobre `fb5ded2` | Neon aislado `ep-cold-morning-bewqoz3o` (pulso_app) | 12/12 integración, tsc y lint exit 0 | [Migración](evidencia/2026-11-16/EXC-01.rls/README.md) | 02.03–02.04, 05.* y 05.C1 siguen parciales | `0152` sin aplicar a main/operativo (OPS-03); VAL-01 pendiente |
| INV-01.b4.storage | código implementado; V1/V2/V3 HTTP comprobadas | `81ec4dd` + `lib/storage/pos-upload.ts`, ruta `pos-file`, pruebas unitarias e `tests/integration/pos-storage-r2-db.test.ts` | Neon aislado (rollback) + R2 real + sesión Better Auth por HTTP loopback; rol dueño, no `pulso_app` | 3/3 integración (subida durable, bytes idénticos, presignado y descarga, aislamiento empresa/sucursal/rol), lint exit 0 | [Storage](evidencia/2026-11-17/INV-01.b4.storage/README.md) | 11.11 parcial | V3 navegador y runtime NOBYPASSRLS pendientes; sin despliegue |
| INV-01.b4.coverage.executive | código implementado; V1/V2 y navegador comprobados por separado | `ea764e8` + corrección del selector | Windows + Neon aislado; SQL runtime y Next/Better Auth con conexión dueña | 41/41 unitarias y 3/3 navegador con menú/COGS; teclado incluido | [Continuación ejecutiva](evidencia/2026-11-19/INV-01.b4.coverage.executive/README.md) | 11.11 parcial | Runtime autenticado independiente, candidatas 0157/0158 y dependencias; sin aceptación/despliegue |
| INV-01.b4.coverage.menu | código implementado; V1/V2 y navegador comprobados por separado | `ea764e8` (verificación 2026-11-19) | Windows + Neon aislado; SQL runtime y Next/Better Auth con conexión dueña | 41/41 unitarias y 3/3 navegador con ejecutivo/COGS; teclado incluido | [Runtime menú](evidencia/2026-11-18/INV-01.b4.coverage.menu/README.md), [navegador](evidencia/2026-11-18/INV-01.b4.coverage.executive/next-browser.md) | 11.11 parcial | Runtime autenticado independiente, candidata 0156 y dependencias; sin aceptación/despliegue |
| NEXT-COMPAT | compatibilidad certificada; build completo pendiente | `0dfd139` + seis archivos base corregidos | Windows local; Next 16.1.6 | `next typegen` exit 0 + `tsc --noEmit` (incluye `.next/types` frescos) exit 0 | [Compatibilidad Next](evidencia/2026-11-17/NEXT-COMPAT/README.md) | transversal (build gate) | `next build` completo limitado por fuentes/ENOMEM del entorno; no es fallo de código |
| NOM-02.c1 (balance-status) | código implementado; V1 comprobada + V2 regresión | `368264c` + `payroll-service.ts` y prueba nueva | Windows local (dbInstance simulado) + Neon aislado `pulso_app` (regresión nómina) | 22/22 focales + 14/14 integración nómina (incluye 4 NOM-02.c1 V2), tsc y lint exit 0 | [Balance-status](evidencia/2026-11-17/NOM-02.c1-balance-status/README.md) | 12.x parcial | Saldos históricos por período, test V2 dedicado a `MISSING`/`QUERY_ERROR` y bloqueo NOM-06 pendientes |
| INV-01.b4.storage (productor directo) | código implementado; V1 y V2/V3 HTTP comprobadas | `1c44f8d` + ruta `cuts/upload`, `precomputed` en ingesta y pruebas | Windows local + Neon aislado (rollback) + R2 real + sesión Better Auth por HTTP loopback; rol dueño | 10/10 ruta + 2/2 servicio, 80/80 focales con regresión, 4/4 integración (44,7 s), tsc/lint/build (455/455) exit 0 | [Productor](evidencia/2026-11-17/INV-01.b4.storage/legacy-producer.md) | 11.11 parcial | V3 navegador y runtime NOBYPASSRLS; concurrencia y dependencias `b4b`/cobertura/checkpoint sin aceptar |

## Reglas para los padres

- [ ] SEC-05.resto subdividido por dominio y tablas (14 hijos ya materializados en mapa; pendiente verificar delimitación y ejecutar).
- [x] PER-01 subdividido por perfil/capacidad y alcance (ocho hijos en el mapa; todos pendientes).
- [x] APR-01 subdividido por documento (compra/factura/gasto/pago/nómina; todos pendientes).
- [ ] INT-02 subdividido por fuente/formato disponible (5 hijos por fuente ya materializados en mapa: pos/uber/rappi/didi/otros; pendiente verificar delimitación y ejecutar).
- [x] FIN-07 subdividido por indicador (ticket, prime cost, contribución y unit economics; todos pendientes).
- [x] VAL-01.M01-M17 subdividido por módulo y filas; dependencias tomadas del mapa P0-03.
- [x] VAL-01.transversal subdividido por recorrido/caso (siete casos y canales; perfiles en PER-01; todos pendientes).
- [ ] OPS-03 instanciado por lote aceptado y entorno identificado.
- [ ] VAL-02 separado en carga, restauración y piloto operativo.

## Puerta final

- [ ] VAL-03 acredita las 239 filas o enumera pendientes explícitos; sin declaración de cierre total indebida.
- [ ] Sin dependencias huérfanas ni ciclos después de añadir hijos.
- [ ] Sin mezcla de cambios de otros frentes; sin migración/despliegue supuesto.

## Registro histórico S0 / Integración S (2026-11-15)

- **Baseline y reparto activo:** ver [investigación y reparto](2026-11-15-investigacion-y-sesiones-faltantes.md) y [baseline S0, manifiesto de entornos y turnos A1/B1/C1](2026-11-15-s0-baseline-y-reparto.md).
- **Fotografía histórica anterior a B2/C2/B3/C3 (no usar como estado vigente):** `INV-01.b4*` ([evidencia A1](evidencia/2026-11-11/INV-01.b4/A1-INTEGRACION-EVIDENCIA.md)), `NOM-01` ([evidencia B1](evidencia/2026-11-11/NOM-01/README.md)) y `AUD-02` ([evidencia C1](evidencia/2026-11-11/AUD-02/README.md)) consolidados en estado `código implementado` (no aceptados aún: faltan V2 real de Postgres para `NOM-01`/`AUD-02`, y R2/sesión real/cobertura financiera para `INV-01.b4*`). `audit-service.ts` alineado en S al enum `inventory_audit_entity` de `schema.ts`.
- **Contabilidad FC-15–21:** FC-15–20 completadas técnicamente en local ([checklist contable](finanzas-contabilidad/todo.md)); migraciones `0146`–`0150` locales sin aplicar y FC-21 pendiente de revisión presencial del responsable contable. Reutilizar para `NOM-05` y `FIN-01/02` sin recrear libro mayor ni cierre.
