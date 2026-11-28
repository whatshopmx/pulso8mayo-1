# Investigación del estado de implementación de faltantes

## Actualización de implementación — 2026-11-27

Revisión sobre HEAD `35515c6` más el árbol local al 2026-11-27. El validador documental (`scripts/validate-faltantes.ts`) reporta **239 filas, 86 tareas base, 127 hijos y 122 registros aceptados**, con cero errores.

- **Puerta 1 cerrada en entorno aislado (2026-11-22, commiteado):** `INV-01.b` (manual, bulk, UI, smart-link, storage POS con runtime `NOBYPASSRLS` y cobertura COGS/menú/ejecutivo), `INV-01.c` (carreras `SERIALIZABLE` y recuperación histórica con Next/R2/Better Auth reales), `INV-01.d` (13/13 recorridos reales) e `INV-02` (políticas de consumo).
- **Producción y corrección histórica hasta `Checkpoint 5.2` aceptadas en entorno aislado (2026-11-22/27):** `PROD-00`, `PROD-01.a` (`0161`), `PROD-01.b` (`0162`), `Checkpoint 5.1`, `PROD-02`, `REC-03A` (dry-run `READ ONLY` por lote + copia aislada Neon, corrección neutral al ledger `quantity_change = 0`), `REC-03B` (protocolo con conteo, unidad, aprobador separado `>= ADMIN`, motivo, respaldo `backupReference`, retención de ambiguos, HTTP `/api/inventory/batches/historical-correction` y carrera 2 conexiones) y `Checkpoint 5.2`.
- **Puerta 2 (Nómina) cerrada en entorno aislado (2026-11-23/25, commiteado en `45a4cad`):** `NOM-01`..`NOM-06`, `NOM-02.c1.history` (`0163`/`0164`), `NOM-02.c2..e`, `NOM-03` (`0165`/`0166`), `NOM-04.a`, `NOM-04.b` (llamada HTTP remota al sandbox de FiscalAPI pendiente explícita) y `NOM-05` (`0168`, obligaciones netas por empleado/período aprobado, pagos parciales idempotentes, conciliación `BAN-04` e independencia CFDI↔pago).
- **Puerta 3 (Banca, comisiones y flujo) cerrada en entorno aislado (2026-11-25, commiteado en `45a4cad` y `8d8b3f7`):** `SEC-05.tesoreria` (`0167`), `BAN-01`, `BAN-04` (`Checkpoint 3.1`), `BAN-05` (`0169`), `BAN-06.a`, `BAN-06.b` (`Checkpoint 3.2`), `FIN-06.a`, `FIN-06.b` y `FIN-01` (`Checkpoint 3.3`, `tsc --noEmit` exit 0).
- **Frente 4 casi cerrado en entorno aislado (2026-11-26/27, commiteado en `6861923`, `6c46701` y `35515c6`):** `AUD-02`, `EVI-02.a/b` (`Checkpoint 4.1`), `EXC-01`/`EXC-01.rls`, `EXC-02`, `EXC-03.a` (`Checkpoint 4.2`), `EXC-03.b`, `EXC-05`, `EXC-04.presupuesto`, `EXC-04.ausencia`, `EXC-04.banco` (`Checkpoint 4.4`) y `APR-01` + sus 5 hijos (`APR-01.compra`, `APR-01.factura`, `APR-01.gasto`, `APR-01.pago`, `APR-01.nomina`; `0170`). Solo falta `EXC-04.merma` (que depende de `INV-04` en Frente 5) para cerrar `Puerta 4`.
- **Pendientes estructurales:** Frente 5 restante (`INV-03`, `INV-04` → destraba `EXC-04.merma`/`Puerta 4`, `INV-05` → Puerta 5), Frentes 6–8 y aplicación operativa de migraciones (`OPS-03`).

## Actualización de implementación — 2026-11-18

Revisión sobre HEAD `9bf4089` más el árbol local compartido. Los apartados del 17 de noviembre que siguen se conservan como fotografía histórica; esta actualización prevalece para los puntos siguientes.

| Punto del informe original | Estado contrastado el 18 de noviembre |
|---|---|
| P1: referencias POS de otra empresa/sucursal | Corregido en `9ca357c` y `37d26ef`: validación canónica de empresa/sucursal/día al vincular y antes de firmar; URLs y paths legacy no verificables se rechazan. |
| Lectura POS desde pantalla | Implementada en `eae5f46`. Evidencia posterior con Next de producción, Better Auth, Neon aislado y R2 reales en `d3a2d64`; no se repitió esa integración externa en esta revisión. |
| Runtime POS sin bypass | Candidata `0155` en `e05449f`, servicio transaccional acotado en `9bf4089` y ocho pruebas SQL/rutas históricas con `pulso_app`; no aplicada persistentemente. Next con login runtime sin bypass sigue pendiente. |
| Listado de cortes por sucursal | Corrección local y pruebas presentes; [límites y evidencia](../tasks/evidencia/2026-11-17/INV-01.b4.storage/sales-list-scope.md). El productor directo con namespace legacy `sales-cuts` quedó adaptado el 18 de noviembre: escribe la key canónica con el día efectivo, valida alcance/roles/tamaño/MIME y reutiliza el build para ingestar. 80/80 unitarias focales, 4/4 integración con R2 real, Neon aislado y sesión Better Auth, y build completo (455/455) exit 0; [detalle y límites](../tasks/evidencia/2026-11-17/INV-01.b4.storage/legacy-producer.md). Su V3 de navegador sobre la pantalla real (`/dashboard/sales/upload`) está cerrada: 3/3 casos con Next de producción, Better Auth, Neon aislado y R2 real, más 39/39 unitarias de regresión; corrigió una navegación a `/dashboard/sales/cuts`, ruta inexistente, y registró que ningún layout monta `<Toaster />`. [Evidencia V3 navegador](../tasks/evidencia/2026-11-17/INV-01.b4.storage/next-browser-v3.md). Sigue pendiente el runtime NOBYPASSRLS y la concurrencia. |
| Creación visible de recovery | Implementada en esta continuación: desde captura de ventas se puede crear un expediente con venta, tres atestaciones verificadas y motivo, y abrir su revisión independiente. Antes solo se consultaba por ID. |
| Nómina incompleta / NOM-06 | Sigue pendiente. El servicio conserva deducciones cero y carga patronal fija del 35%; el comentario sobre NOM-06 no demuestra una guardia efectiva. Existe el test V2 dedicado a saldos, pero no se ejecutó en esta revisión. |
| Build global | La evidencia posterior de POS registra build Webpack exit 0; el bloqueo del apartado histórico no describe ya la última evidencia. No se ejecutó un nuevo build global de este árbol en esta continuación. |

La creación conserva la clave de idempotencia al reintentar los mismos datos en el formulario abierto; un cambio de datos crea otra clave. Bloquea envíos repetidos y el cierre durante la solicitud, acota la espera a 30 segundos y mantiene los errores accionables. Al cambiar de sucursal se reinicia el diálogo. No crea atestaciones, verifica documentos desde el cliente, aprueba al solicitante ni aplica inventario automáticamente.

Ver [evidencia de la continuación y pendientes](../tasks/evidencia/2026-11-18/INV-01.c.recovery.create/README.md). La prueba de navegador usa componentes reales y API simulada: no acredita sesión/R2/DB integrados ni concurrencia de commits de recovery. Se mantienen los 24 registros aceptados; no se cierra `INV-01.b`, recovery, nómina ni la fila 11.11 por este incremento.

Orden actualizado: acreditar la adopción de runtime/migraciones identificadas (0155 y candidatas de cobertura) y completar las dependencias de ingestión/cobertura financiera; completar el recorrido integrado de recuperación (obtención de evidencias y atestaciones, sesión/R2, decisión/aplicación y carreras reales); después cerrar saldos históricos y NOM-06. El productor POS legacy ya está adaptado en código y con V1/V2/V3 HTTP y V3 navegador reales; falta su runtime NOBYPASSRLS y la concurrencia, que no se sustituyen por las pruebas unitarias. No aplicar migraciones a un entorno operativo por inferencia de estas pruebas.

## Investigación original — 2026-11-17

Fecha: 2026-11-17. Referencia: `tasks/todo-implementacion-faltantes.md`, plan revisado, mapa y matriz asociados.

Base observada: HEAD `81ec4ddb97e6327b8c557c5ff9769d99a4b048af` más cambios locales preexistentes, incluidos archivos nuevos de recovery, nómina y pruebas. El árbol es compartido y no constituye una revisión congelada. Esta investigación no acepta tareas, aplica migraciones ni modifica implementación.

## Resultado

Hay implementación sustancial, pero el plan no está cerrado. El cuello de botella inmediato combina aceptación integrada, migraciones por entorno y algunas brechas funcionales reales. Una casilla vacía no demuestra ausencia de código.

El validador actual informa **239 filas, 86 tareas base, 99 entradas adicionales y 24 registros aceptados**, con cero errores documentales. Los 24 incluyen preparación y un padre; no son 24 funcionalidades completas ni permiten calcular un porcentaje funcional.

Distribución de los 54 registros explícitos de ejecución: 24 aceptados, 25 en «código implementado», cuatro «en curso» y uno «V3». Las demás tareas del catálogo no tienen registro de ejecución explícito.

La matriz distribuye las 239 filas así:

| Estado documental | Filas |
|---|---:|
| Implementado en código | 98 |
| Implementado en código; aceptación pendiente | 3 |
| Parcial | 98 |
| Base localizada; por verificar | 39 |
| Sin implementación localizada | 1 |

La única fila marcada sin implementación localizada es **06.10, delivery online/offline**, ligada a OPE-04. Ninguna fila está marcada «aceptado»; esto es compatible con aceptar hijos sin cerrar aún sus recorridos.

## Hallazgo prioritario: aislamiento de objetos POS

**P1 — Una referencia suministrada por el cliente puede convertirse en una URL firmada para un objeto ajeno.**

Cadena comprobada mediante lectura del código:

1. `app/api/workflows/smart-links/upload-pos/route.ts:177` admite JSON con `fileUrl: z.string().min(1)`. Verifica empresa/sucursal del corte que se actualiza, pero no procedencia ni ámbito de la referencia. La escribe en `rawFileUrl` en la línea 185.
2. `app/api/sales/cuts/[id]/pos-file/route.ts` comprueba correctamente empresa y sucursal de la fila, pero entrega su referencia a `resolvePosUploadUrl` sin contrastar la empresa/sucursal del objeto.
3. `lib/storage/pos-upload.ts:118` clasifica cadenas sin esquema como claves R2 y llama a `generatePresignedUrl(value, expiresIn)`, sin recibir contexto de empresa/sucursal.
4. `lib/storage/r2-client.ts:87` firma esa clave dentro del bucket configurado con las credenciales del servidor.

Consecuencia: con R2 configurado, un usuario con permiso para vincular archivos POS y leer su corte puede guardar una clave conocida de otra empresa/sucursal en un corte propio y solicitar su URL firmada. No necesita acceder a la fila del corte ajeno. El impacto exige conocer una clave existente y que las credenciales permitan leerla; esta investigación no accedió a objetos reales de otra empresa.

Corrección propuesta: aceptar referencias privadas mediante un identificador emitido por el servidor y verificar su pertenencia; como mínimo, validar la jerarquía canónica de empresa/sucursal/fecha al vincular y antes de firmar, con política explícita para referencias legacy. Añadir regresiones para clave de otra empresa, otra sucursal y clave fuera del espacio POS. Las siete pruebas actuales de lectura simulan el resolvedor y no cubren esta cadena completa.

## Estado por frente

| Frente | Implementación/evidencia localizada | Cierre pendiente |
|---|---|---|
| Ventas y consumo | Identidad, revisiones, snapshot, diferencial y writer transaccional; `sale-consumption-service.ts:113` exige SERIALIZABLE y toma bloqueo por sucursal/día. Hijos hasta b3 y normalización b4a aceptados. | Ingestión y fronteras manual/bulk/smart-link, storage y cobertura financiera requieren cierre de dependencias y aceptación integrada. INV-01.b y la fila 11.11 permanecen abiertos. |
| Recovery histórico | Contrato, documentos atestiguados, propuesta, decisión independiente y aplicación auditada; rutas y diálogo presentes. | El diálogo consulta un expediente por ID y permite decidir/aplicar; no crea el expediente desde el recorrido visible. Sesión/R2/navegador integrados y carreras de recovery con conexiones independientes pendientes. |
| Cobertura financiera | COGS, ejecutivo y menú tienen cambios y pruebas. COGS documenta además recorridos con sesión/DB/navegador reales. | COGS conserva migración 0154 candidata, dependencia b4b y build pendientes. Ejecutivo/menú siguen sin V2/V3 aceptadas. |
| Nómina | NOM-01, NOM-02.a y NOM-02.b aceptados; vacaciones/permisos y estados AVAILABLE/MISSING/QUERY_ERROR implementados. | Saldos históricos, bloqueo de resultados incompletos, impuestos/deducciones, snapshot, recibos/timbrado y tesorería pendientes según sus tickets. |
| Auditoría, evidencia y excepciones | AUD-02, EVI-02.a/b, EXC-01 y EXC-02 aceptados en sus alcances; migración 0152 documentada para V2 aislada. | HTTP/UI/job y fases siguientes del lifecycle, más aplicación operativa OPS-03, no se derivan de esas aceptaciones. |
| Otros dominios | El checklist mantiene banca, producción, operación, finanzas históricas, perfiles y aceptación por módulo abiertos. | Se necesita revisión focal por ticket: varios son aceptación de base existente. Esta investigación no hizo auditoría exhaustiva de esos dominios. |

## Brechas funcionales y documentales confirmadas

- **Nómina incompleta:** `lib/services/payroll-service.ts:2029` devuelve `totalDeduccionesCents: 0`; en la línea 2015 conserva carga patronal fija de 35%. `lib/services/compliance/payroll-calculator.ts:272` también conserva deducciones cero como placeholder. Coinciden con NOM-02.d/e pendientes; no deben presentarse como nómina completa. No se evaluó aquí la corrección legal de fórmulas o tasas.
- **NOM-06 aún es una dependencia:** el comentario de `payroll-service.ts:314` afirma que NOM-06 bloquea MISSING/QUERY_ERROR, pero el checklist y la evidencia de balance-status lo mantienen pendiente. El cálculo inspeccionado incorpora `vacationPrimeCents` sin rechazar por esos estados. El comentario no acredita una guardia de aprobación/timbrado.
- **Evidencia de saldo desfasada respecto del árbol:** checklist y README dicen que falta un test V2 dedicado a MISSING/QUERY_ERROR; ya existe el archivo nuevo `tests/integration/payroll-nom02c1-balance-db.test.ts`, con esos casos y revocación de SELECT. Su existencia no acredita ejecución exitosa ni aceptación; debe verificarse y documentarse antes de cambiar estados.
- **Build y tipos son gates distintos:** la evidencia NEXT-COMPAT registra typegen y tsc exitosos posteriores a los siete errores históricos. El build completo permanece sin acreditación actual. No corresponde trasladar automáticamente errores históricos ni inferir build verde del typecheck.
- **Checkpoints abiertos:** 2.1 y 4.1 siguen vacíos aunque hay hijos aceptados; falta consolidar sus gates explícitos. No se marcaron por localizar pruebas aisladas.

## Verificación realizada en esta investigación

- `pnpm.cmd exec tsx scripts/validate-faltantes.ts`: exit 0; 239 filas, 86 base, 99 adicionales, 24 aceptados, cero errores. Solo acredita integridad documental.
- Vitest con `--configLoader bundle --maxWorkers=1 --pool=threads`: **117/117 pruebas, 13 archivos**, en tres ejecuciones sin sumar dos veces el mismo archivo: 87 de vacaciones/balance, recovery, atomicidad de excepciones, COGS y storage/lectura POS; 11 de trazabilidad; 19 de cobertura ejecutiva/menú y frontera smart-link.
- En dos invocaciones se incluyeron filtros con nombres de archivo inexistentes; Vitest ejecutó los archivos coincidentes. Los totales anteriores corresponden exclusivamente a archivos realmente ejecutados; trazabilidad y ejecutivo/menú se ejecutaron después con sus rutas correctas.
- `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit --incremental false`: **exit 0**, sin diagnósticos. Verifica el árbol y los tipos generados presentes; no sustituye un nuevo typegen ni build completo.
- No se repitieron integraciones Neon/R2, navegador, lint global ni build completo. Las menciones V2/V3 anteriores proceden de evidencia histórica identificada, no de una nueva certificación.

## Orden recomendado

1. Corregir el aislamiento de referencias POS antes de aceptar b4.storage.
2. Cerrar b4b.rls/b4b, storage y cobertura financiera con sus dependencias, migraciones por entorno y checkpoint; después aceptar el recorrido de ventas con sesión real.
3. Completar creación visible de recovery y probar decisión/aplicación con sesión, storage y concurrencia real; conservar la dependencia de INV-01.b.
4. Verificar los casos V2 nuevos de vacaciones, resolver saldos históricos y hacer efectivo NOM-06 antes de aceptar resultados completos o timbrado.
5. Retomar dominios restantes por dependencias; aplicar migraciones solo mediante lotes y entorno identificados en OPS-03. Cerrar filas mediante VAL-01/VAL-03, sin convertir pruebas de hijos en aceptación del sistema.
