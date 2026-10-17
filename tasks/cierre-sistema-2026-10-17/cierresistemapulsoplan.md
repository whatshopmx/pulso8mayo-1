# Plan de cierre del sistema Pulso

Fecha: 17 de octubre de 2026. Estado: plan guardado, implementación no iniciada por este documento.

## Objetivo y base

Cerrar las brechas de integridad, seguridad e integración identificadas en la [investigación del sistema](../../audits/2026-10-17-sistema/INFORME.md), y demostrar los requisitos del mapa original mediante código y recorridos ejecutados.

La [matriz de 205 requisitos y 12 filas transversales](../../audits/2026-10-17-sistema/requisitos.csv) es el inventario de aceptación. El [snapshot de requisitos](../../audits/2026-10-17-sistema/requisitos-fuente.txt) fija el alcance original. Estos archivos derivados se usan para trazabilidad; documentos anteriores del proyecto no prueban implementación.

La investigación encontró 173 tablas en la base configurada frente a 174 declaradas por el código; faltaba `exceptions`. TypeScript aprobó; la suite tuvo 1,627 pruebas aprobadas y una fallida en el seed de recepción; la compilación quedó inconclusa. Son resultados de esa ejecución, no garantías sobre cambios posteriores. La tarea BASE-01 vuelve a comprobarlos antes de modificar el sistema.

**Resultado esperado:** un grupo puede ejecutar operación, registrar evidencia, resolver excepciones, gestionar personal, producir/contar/recibir, aprobar obligaciones y conciliar sus pagos e ingresos; dirección consulta cifras con origen, cobertura y período explícitos.

## Reglas de implementación

1. Reutilizar los servicios y controles existentes. La existencia de tablas vacías no justifica crear otro modelo ni otro motor.
2. Entregar recorridos pequeños completos: persistencia, servicio, autorización, interfaz cuando corresponda y prueba del comportamiento.
3. Separar registrar, aprobar, ejecutar, liquidar y conciliar. Un layout descargado o una referencia capturada no prueban movimiento bancario.
4. Imponer empresa, sucursal, actor y permiso en el servidor. Los eventos y procesos programados también llevan contexto explícito.
5. Usar transacciones y claves de idempotencia en efectos económicos. Los reintentos no repiten movimientos, pagos, lotes ni eventos.
6. Guardar costo, versión de receta y política aplicable cuando sean necesarios para reproducir un resultado histórico.
7. Migraciones revisadas y probadas en base aislada. No usar `db:push` como mecanismo de cierre ni ejecutar seeds contra datos operativos para simular avance.
8. No inventar asistencia, cuentas, conteos, saldos ni aprobaciones. Datos de demostración se identifican como tales.
9. Investigar de nuevo cada hallazgo antes de corregirlo: puede haberse resuelto durante el trabajo concurrente del repositorio.
10. No incluir una reescritura general, un POS propio ni integraciones directas con plataformas sin un caso de uso y acceso técnico comprobados.

## Prioridades y dependencias

| Fase | Prioridad | Entregable | Puerta de salida |
|---|---|---|---|
| 0 | P0 | Línea base reproducible | Fallos conocidos identificados, entorno de prueba aislado |
| 1 | P0 | Accesos y recepción seguros | Sin acceso cruzado en rutas afectadas; recibir 10 deja 10 |
| 2 | P1 | Evidencia durable, auditoría y aislamiento DB | Evidencia recuperable tras reinicio y políticas verificadas |
| 3 | P1 | Excepción canónica operativa | Detectar→asignar→resolver→verificar→cerrar/reabrir funciona |
| 4 | P1 | Pre-nómina conectada | Un cálculo reproducible alimenta aprobación, exportación y nómina |
| 5 | P1 | Inventario, ventas y producción consistentes | Correcciones y reintentos conservan cantidades y costos |
| 6 | P1 | Banca y cierre financiero | Banco↔pago/depósito conciliado con diferencias trazables |
| 7 | P2 | Cobertura funcional y automatización | Rutinas, mantenimiento, compras, perfiles y control tower demostrados |
| 8 | P1 para liberar | Validación integral | Matriz resuelta y piloto con evidencias |

Dependencias principales:

```text
BASE-01
  ├─ SEC-01/02/03 ── EVI-01/AUD-01 ── SEC-04 ── SEC-05.<dominio>
  ├─ REC-01 ── REC-02 ── REC-03
  ├─ EXC-01 ── EXC-02 ── EXC-03 ── EXC-04.<dominio>
  ├─ NOM-01 ── NOM-02 ── NOM-03 ── NOM-04 ── NOM-05
  └─ INV-01 ── INV-02 ── PROD-01 ── PROD-02 ── INV-03 ── INV-04

SEC-04 + EVI-01 + AUD-01 ── BAN-01 ── BAN-02 ── BAN-03 ── BAN-04
                                                  └─ BAN-05 ── BAN-06
BAN-04/06 ── FIN-01
NOM-05 + INV-04 + BAN-06 ── FIN-02
EXC-04 + FIN-01/02 + AUT-01 ── CTL-01
Recorridos de los 17 módulos ── VAL-01 ── VAL-02
```

El orden no obliga a terminar tareas independientes antes de comenzar otra rama. Migraciones y cambios sobre las mismas tablas se ejecutan secuencialmente. Una dependencia indicada abajo prevalece sobre el diagrama resumido.

## Cómo ejecutar y cerrar una tarea

Cada tarea tiene hasta tres criterios de aceptación, verificación y dependencias. Tamaño **S**: 1–2 archivos; **M**: 3–5 archivos aproximadamente. Si supera cinco archivos o dos subsistemas independientes, se subdivide antes de implementarla, preservando el ID como padre.

Los archivos indicados son puntos de entrada, no una lista cerrada ni una afirmación de que nuevos archivos ya existen. Los nombres nuevos son propuestas que se ajustarán al patrón actual del repositorio.

Después de cada dos o tres tareas relacionadas: ejecutar pruebas del recorrido afectado y revisar errores de servidor/interfaz. Antes de cerrar cada fase: pruebas unitarias, TypeScript y compilación; un build inconcluso no cuenta como aprobado. Las comprobaciones de navegador deben usar un servidor identificado y cuentas de prueba de al menos dos empresas. Ningún test de aceptación necesita alterar datos de un cliente real.

La lista operativa se mantiene en [todo.md](todo.md). No marcar una casilla por tener código escrito: adjuntar comando, resultado, entorno, fecha y evidencia del criterio cumplido.

## Fase 0 — Línea base

### BASE-01 — Revalidar el punto de partida

**Entrega:** snapshot reproducible del código, esquema y entorno de prueba antes del primer cambio.

**Aceptación:** (1) registrar HEAD, cambios locales y versiones de archivos afectados; (2) reproducir o descartar el fallo de `clave_prod_serv` y obtener un resultado final de build; (3) identificar la base/despliegue que se verificará, separando fixture/seed de datos operativos.

**Verificación:** `pnpm run test:unit`, `pnpm exec tsc --noEmit --incremental false`, `pnpm run build`; corregir el seed sólo si el fallo sigue vigente y verificar repetición sin duplicados en base aislada.

**Dependencias:** ninguna. **Tamaño:** M. **Entradas:** `scripts/seed-13-receiving-matching.ts`, `tests/unit/seed-integration.test.ts`, `package.json`, configuración de pruebas.

## Fase 1 — Integridad y accesos inmediatos

### SEC-01 — Autorizar mantenimiento por equipo y sucursal

**Entrega:** el alta general usa el mismo alcance seguro que los servicios de equipo.

**Aceptación:** (1) equipo ajeno o fuera del alcance produce rechazo sin escrituras; (2) actor sin permiso no crea mantenimiento; (3) programar mantenimiento no cambia la fecha de último mantenimiento realizado.

**Verificación:** pruebas API con dos empresas y dos sucursales; alta válida y cierre real en navegador. **Dependencias:** BASE-01. **Tamaño:** M. **Entradas:** `app/api/equipment/maintenance/route.ts`, `lib/services/equipment-service.ts`, pruebas de aislamiento de equipos.

### SEC-02 — Restringir la consulta de evidencia

**Entrega:** colaborador consulta sólo sus tareas/evidencias y supervisión aplica el alcance autorizado.

**Aceptación:** (1) filtros manipulados no amplían acceso; (2) empleado no ve adjuntos de otro asignatario; (3) historial, descarga y URL firmada respetan el mismo alcance.

**Verificación:** solicitudes directas a la API y navegación con empleado/gerente/admin, incluidas URLs de evidencia ajena. **Dependencias:** BASE-01. **Tamaño:** M. **Entradas:** `app/api/workflows/evidence/route.ts`, `lib/storage/scoped-evidence.ts`, pruebas de evidencia/acceso.

### SEC-03 — Cerrar la escritura legacy de ventas

**Entrega:** toda venta y su consumo validan permiso, receta, empresa y sucursal en el servidor.

**Aceptación:** (1) empresa/sucursal/receta ajenas se rechazan antes del primer movimiento; (2) empleado sin autoridad no registra ventas; (3) ruta manual e importación tienen reglas de acceso coherentes.

**Verificación:** pruebas de API con IDs cruzados y ventas legítimas. **Dependencias:** BASE-01. **Tamaño:** M. **Entradas:** `app/api/inventory/sales-entry/route.ts`, `lib/services/theoretical-consumption-service.ts`, guard de alcance y pruebas.

### REC-01 — Corregir el saldo de recepción

**Entrega:** una única escritura incrementa el stock recibido.

**Aceptación:** (1) recibir 10 crea saldo 10 y movimiento +10; (2) cantidades fraccionarias y conversión de unidad conservan cantidad/valor; (3) cuarentena no aumenta stock disponible.

**Verificación:** regresiones del servicio y recorrido API/workflow con recepción conocida. **Dependencias:** BASE-01. **Tamaño:** M. **Entradas:** `lib/services/receiving-service.ts`, `lib/services/inventory-service.ts`, pruebas de recepción.

### REC-02 — Hacer la recepción atómica e idempotente

**Entrega:** reporte, lotes, movimientos, líneas y avance de OC se confirman juntos.

**Aceptación:** (1) fallo intermedio revierte todos los efectos DB; (2) doble envío/reintento/concurrencia produce una sola recepción; (3) factura, proveedor, ítems y OC se validan antes de escribir; efectos externos salen después del commit mediante entrega recuperable.

**Verificación:** fallos inyectados en cada escritura y dos peticiones simultáneas con la misma clave; revisar recuperación de notificaciones. **Dependencias:** REC-01, SEC-03. **Tamaño:** M por subtarea. **Entradas:** servicio de recepción, extractor, esquema/migración de idempotencia y pruebas; separar el cambio de contrato del de transacción si excede cinco archivos.

### REC-03 — Diagnosticar y corregir saldos históricos afectados

**Entrega:** reporte por lote de discrepancias atribuibles, seguido de ajustes explícitos cuando la evidencia lo permita.

**Aceptación:** (1) diagnóstico de sólo lectura distingue saldo esperado, movimientos y ambigüedad; (2) jamás dividir todos los saldos entre dos ni reescribir movimientos originales; (3) corrección usa ajuste trazable o conteo físico y su repetición no aplica dos veces.

**Verificación:** dry-run con lotes usados, transferidos, cuarentenados y sin historial suficiente; comparación antes/después de ajustes en copia aislada. **Dependencias:** REC-02. **Tamaño:** M. **Entradas:** script de diagnóstico nuevo, servicio de ajustes/conteos y pruebas. Aplicar correcciones al entorno operativo sólo con lote de cambios revisable y respaldo identificado.

**Puerta de fase 1:** solicitudes cruzadas rechazadas sin efecto; recepción válida exacta, atómica e idempotente; saldos históricos pendientes identificados.

## Fase 2 — Evidencia, auditoría y seguridad de datos

### EVI-01 — Persistir la evidencia común

**Entrega:** registro durable de adjunto con empresa, entidad, autor, tipo y clave de almacenamiento.

**Aceptación:** (1) evidencia sigue consultable tras reiniciar el proceso; (2) alta/lectura/borrado aplican pertenencia y alcance; (3) adjuntos existentes mantienen acceso durante la migración por dominio y no se duplican.

**Verificación:** alta→reinicio→consulta/descarga y rechazo cruzado; primer recorrido con workflow. **Dependencias:** SEC-02. **Tamaño:** M por subtarea. **Entradas:** `lib/services/evidence-store.ts`, esquema/migración nuevos, almacenamiento con alcance y pruebas. Adaptar gastos, OS y banca en las tareas de sus recorridos.

### AUD-01 — Garantizar auditoría de mutaciones sensibles

**Entrega:** contrato común de auditoría para actor, alcance, entidad, antes/después y motivo, conservando las bitácoras existentes cuando corresponda.

**Aceptación:** (1) una mutación económica/sensible no se confirma sin su auditoría durable o un outbox atómico; (2) fallos dejan error recuperable visible; (3) lecturas/exportaciones sensibles registran acceso sin copiar secretos ni adjuntos completos.

**Verificación:** caída simulada de la escritura de auditoría y comprobación de rollback/recuperación. **Dependencias:** BASE-01. **Tamaño:** M por dominio. **Entradas:** `lib/services/audit-service.ts`, `lib/security/audit.ts`, primer servicio piloto y pruebas. El resto se integra junto a cada tarea económica, no mediante una migración masiva de todos los callers.

### SEC-04 — Probar contexto de tenant y RLS en un dominio piloto

**Entrega:** aislamiento DB compatible con el pool, sesiones HTTP y workers.

**Aceptación:** (1) contexto de empresa ligado a transacción, sin filtrarse entre conexiones; (2) rol runtime sin bypass y rechazo por defecto cuando falta contexto; (3) tareas programadas/soporte usan alcance explícito, separado del rol de migración.

**Verificación:** reutilizar conexiones entre dos empresas, intento de consulta sin contexto y ejecución de job con tenant; probar inicialmente un dominio. **Dependencias:** SEC-01/02/03, AUD-01. **Tamaño:** M. **Entradas:** `lib/db/index.ts`, migración/política piloto, helper de contexto y pruebas DB. No habilitar RLS en 173 tablas de una sola vez.

### SEC-05.<dominio> — Extender RLS por lotes pequeños

**Entrega:** una subtarea independiente por cada dominio migrado, con inventario de tablas y servicios alcanzados.

**Aceptación:** (1) políticas prueban aislamiento también en tablas hijas sin `companyId`; (2) API, jobs y reportes del dominio funcionan con rol runtime; (3) se registran excepciones técnicas justificadas y reversión, sin declarar cobertura universal antes de terminar el inventario.

**Verificación:** matriz DB de dos empresas y suite del dominio por cada lote. **Dependencias:** SEC-04 y tarea funcional del dominio cuando cambie su esquema. **Tamaño:** S/M por lote. **Entradas:** migración, consultas del dominio y pruebas; máximo cinco archivos por subtarea. Prioridad: evidencia/excepciones, inventario, personal/nómina y tesorería; después organización, compras, mantenimiento y proyecciones.

## Fase 3 — Excepciones y acciones correctivas

### EXC-01 — Instalar el esquema canónico

**Entrega:** migración de `exceptions` y validación de compatibilidad con los datos existentes.

**Aceptación:** (1) tabla, índices, restricciones y enums requeridos existen; (2) unicidad por sujeto evita duplicados; (3) migración es repetible según el mecanismo del proyecto y no altera datos legacy.

**Verificación:** migración en base aislada con datos y comparación de esquema completa. **Dependencias:** BASE-01. **Tamaño:** S/M. **Entradas:** `lib/db/schema/exceptions.ts`, migración y pruebas de persistencia.

### EXC-02 — Sincronizar y activar el feed canónico

**Entrega:** adaptadores producen filas verificables antes de activar la lectura nueva.

**Aceptación:** (1) sincronización repetida conserva responsable/lifecycle y no duplica; (2) diferencias frente al feed legacy quedan explicadas por empresa/sucursal/dominio; (3) flag se activa después de validar datos, con reversión de lectura comprobada.

**Verificación:** incidente y factura discrepante recorren origen→sync→feed→pantalla. **Dependencias:** EXC-01, SEC-01/02/03. **Tamaño:** M. **Entradas:** adaptadores, `group-exceptions-service.ts`, `exceptions-sync.ts`, pruebas del feed.

### EXC-03 — Completar lifecycle y vencimiento de SLA

**Entrega:** resolución verificable, protección de transiciones concurrentes y escalamiento recuperable.

**Aceptación:** (1) verificador distinto de resolvedor y cierre sólo verificado; (2) actualización obsoleta no pisa una transición nueva; (3) SLA vencido escala una vez por nivel y reapertura conserva historial/motivo.

**Verificación:** ciclo completo, dos acciones simultáneas y reloj controlado con reintento del job. **Dependencias:** EXC-02, AUD-01, EVI-01 para adjuntos de resolución. **Tamaño:** M por subtarea. **Entradas:** `exception-service.ts`, `exception-lifecycle.ts`, `exception-sla.ts`, job y pruebas; separar concurrencia de automatización si excede cinco archivos.

### EXC-04.<dominio> — Cubrir las fuentes faltantes

**Entrega:** subtareas separadas para merma alta, gasto fuera de presupuesto, ausencia laboral y pago/depósito sin conciliar.

**Aceptación:** (1) umbral/evento se configura o deriva de una política explícita; (2) crear y resolver en el dominio mantiene consistente la excepción sin saltarse verificación; (3) cada fila tiene owner, SLA y enlace accionable.

**Verificación:** un caso dentro/fuera de rango por dominio, repetido sin duplicar. **Dependencias:** EXC-03; INV-04 para merma, NOM-02 para ausencia, BAN-04/06 para banco. **Tamaño:** S/M por fuente. **Entradas:** adaptador, servicio origen y pruebas del caso.

**Puerta de fase 3:** temperatura, merma, factura, presupuesto, ausencia, equipo y pago tienen recorrido demostrado de detección a cierre/reapertura. No basta con que los nueve adaptadores actuales compilen.

## Fase 4 — Workforce conectado a nómina

### NOM-01 — Fijar la unidad salarial y las políticas vigentes

**Entrega:** contrato inequívoco de salario diario/hora/período, calendario, redondeo y vigencia de reglas.

**Aceptación:** (1) servicio y exportación interpretan igual cada contrato; (2) registros antiguos ambiguos se reportan y no se convierten por una heurística silenciosa; (3) reglas fiscales/laborales aplicables quedan respaldadas por fuentes oficiales vigentes al implementarlas o por proveedor fiscal validado.

**Verificación:** fixtures equivalentes de diferentes periodicidades y revisión de casos ambiguos. **Dependencias:** BASE-01. **Tamaño:** M. **Entradas:** contratos, cálculo salarial, normalización y pruebas. No usar los porcentajes estimados actuales como criterio de aceptación fiscal.

### NOM-02 — Calcular pre-nómina desde asistencia e incidencias

**Entrega:** resultado por empleado/período reproducible a partir de fuentes aprobadas.

**Aceptación:** (1) incorpora horas programadas/trabajadas, descansos, overtime aprobado, faltas, vacaciones y permisos según NOM-01; (2) bonos/deducciones tienen concepto, origen y autorización; (3) zona horaria, turno nocturno y vigencia contractual no generan dobles días/horas.

**Verificación:** períodos de duración distinta con falta, festivo, vacaciones, permiso, bono, deducción y horas extra; comparar con resultados esperados explícitos. **Dependencias:** NOM-01. **Tamaño:** M por familia de incidencias. **Entradas:** `payroll-service.ts`, asistencia/incidencias, calculador puro y pruebas.

### NOM-03 — Aprobar y congelar pre-nómina

**Entrega:** gerente/RH autorizado revisa diferencias antes de correr nómina.

**Aceptación:** (1) snapshot conserva entradas, conceptos, importes y aprobador; (2) editar una fuente relevante invalida aprobación o crea revisión; (3) acceso acotado por empresa/sucursal y separación de autoridad configurable.

**Verificación:** revisar→aprobar→cambiar incidencia→intentar ejecutar; rechazo de actor fuera de alcance. **Dependencias:** NOM-02, AUD-01. **Tamaño:** M por subtarea. **Entradas:** esquema/snapshot, servicio, API/UI y pruebas; dividir aprobación de interfaz si excede tamaño.

### NOM-04 — Unificar exportación y timbrado con el cálculo aprobado

**Entrega:** exportación, corrida y payslips consumen el mismo snapshot aprobado.

**Aceptación:** (1) desaparecen los 15 días fijos y los cálculos paralelos; (2) fallo parcial del proveedor se reintenta por empleado sin timbrado duplicado; (3) importe/conceptos/exportación/payslip coinciden y se recuperan errores visibles.

**Verificación:** exportación de dos períodos diferentes y corrida contra sandbox/proveedor simulado, con caída y reintento. **Dependencias:** NOM-03, EVI-01. **Tamaño:** M por integración. **Entradas:** `app/api/payroll/export/route.ts`, `payroll-service.ts`, `fiscal-service.ts`, pruebas. El timbrado productivo es una etapa de liberación posterior, no una prueba de desarrollo.

### NOM-05 — Conectar nómina aprobada con tesorería

**Entrega:** obligación neta por empleado o agrupación soportada, con cuenta destino y política de dispersión explícitas.

**Aceptación:** (1) nómina inválida/no aprobada no entra a pago; (2) montos netos y beneficiarios coinciden con payslips y no se programa dos veces; (3) rechazo bancario mantiene deuda pendiente sin alterar el CFDI por sí mismo.

**Verificación:** nómina→corrida→layout soportado→rechazo/confirmación; conciliación real se demuestra con BAN-04. **Dependencias:** NOM-04, BAN-01; finalización económica depende de BAN-04. **Tamaño:** M por recorrido. **Entradas:** `treasury-service.ts`, política de dispersión, documentos de nómina y pruebas.

## Fase 5 — Ventas, producción, inventario y costeo

### INV-01 — Corregir ventas con efectos transaccionales

**Entrega:** importación y corrección conservan relación entre cantidad vendida y consumo.

**Aceptación:** (1) importar 10→12→12 consume el equivalente neto de 12 una sola vez; (2) fallo tras guardar venta no deja consumo omitido irrecuperable; (3) reducción/anulación usa reversa trazable y respeta el período cerrado.

**Verificación:** reimportación, caída y concurrencia; revisar saldo, ledger y estado de procesamiento. **Dependencias:** SEC-03, REC-02. **Tamaño:** M. **Entradas:** `sales-ingest-service.ts`, `theoretical-consumption-service.ts`, persistencia de efecto y pruebas.

### INV-02 — Definir dónde se consume cada ingrediente

**Entrega:** política operativa por receta/SKU que distingue producir de vender y evita descontar dos veces la misma materia prima.

**Aceptación:** (1) flujo directo y flujo con producto preparado tienen propietario explícito del consumo; (2) versión de receta, rendimiento y unidades se conservan en el efecto; (3) correcciones revierten la versión original, no una receta editada después.

**Verificación:** producir y vender el mismo lote, más cambio posterior de receta y corrección de venta. **Dependencias:** INV-01. **Tamaño:** M. **Entradas:** recetas, consumo y producción; fijar contrato antes de modificar ambos servicios.

### PROD-01 — Registrar el lote de producto terminado

**Entrega:** producción consume insumos y crea una salida inventariable una sola vez según INV-02.

**Aceptación:** (1) saldo de insumos/salida conserva cantidades, costos, rendimiento y lote; (2) genealogía liga lotes de entrada a lote de salida; (3) rollback y reintento no crean salida ni consumo duplicado.

**Verificación:** subreceta compartida, faltante, fracciones y dos cierres simultáneos. **Dependencias:** INV-02. **Tamaño:** M por subtarea. **Entradas:** `production-service.ts`, `recipe-production.ts`, modelo de lote/movimiento y pruebas.

### PROD-02 — Unificar hold time y modelo de producción

**Entrega:** prep list, workflow y merma usan el mismo modelo; las tablas alternativas tienen destino documentado sin borrar historial.

**Aceptación:** (1) vencimiento/merma de terminado afecta su lote/costo una vez; (2) ambos puntos de entrada muestran las mismas cantidades/estados; (3) modelos alternativos se migran o quedan explícitamente fuera de escritura, con compatibilidad validada.

**Verificación:** producir→vencer→confirmar descarte→reintentar cron; comparar pantalla y ledger. **Dependencias:** PROD-01. **Tamaño:** M por entrada. **Entradas:** `prep-list-service.ts`, `production-from-workflow.ts`, `hold-time-service.ts`, pruebas.

### INV-03 — Operar conteos físicos y ajustes aprobados

**Entrega:** conteo inicial/final por sucursal y sus diferencias verificables.

**Aceptación:** (1) conteo captura fecha local, ítems/lotes y responsable; (2) sólo ajuste autorizado modifica saldo y no se aplica dos veces; (3) varianza distingue falta de dato de diferencia real.

**Verificación:** conteo→revisión→ajuste→reporte con dos períodos y actores; considerar lotes afectados por REC-03. **Dependencias:** REC-03, PROD-02. **Tamaño:** M por recorrido. **Entradas:** `stock-count-service.ts`, extractores/ajustes, reportes y pruebas.

### INV-04 — Congelar costo y comprobar varianza

**Entrega:** costos/snapshots de inventario reproducibles en el período cerrado.

**Aceptación:** (1) costo histórico no cambia por editar precio o receta actuales; (2) consumo teórico, físico y merma muestran origen/cobertura y diferencias; (3) snapshot repetido no duplica y reapertura conserva revisión anterior.

**Verificación:** cerrar→cambiar costos actuales→recalcular, comparando total y detalle congelados. **Dependencias:** INV-03, AUD-01. **Tamaño:** M por snapshot/reporte. **Entradas:** `food-cost-service.ts`, `inventory-snapshot-service.ts`, `reports-service.ts`, persistencia de costo y pruebas.

## Fase 6 — Banca, tesorería y cierre económico

### BAN-01 — Dar identidad a las cuentas bancarias propias

**Entrega:** catálogo por empresa, moneda y estado con acceso restringido; migración del texto libre sin asignaciones inventadas.

**Aceptación:** (1) corrida identifica cuenta origen propia válida; (2) datos sensibles se protegen y auditan; (3) corridas antiguas ambiguas quedan pendientes de vinculación explícita.

**Verificación:** alta/consulta con dos empresas y corrida que intenta usar cuenta ajena/inactiva. **Dependencias:** SEC-04, EVI-01, AUD-01. **Tamaño:** M por backend/UI. **Entradas:** esquema bancario nuevo, tesorería, API/UI de cuenta y pruebas.

### BAN-02 — Importar movimientos de un banco piloto

**Entrega:** importación de un formato real disponible, conservando archivo original y metadatos del lote.

**Aceptación:** (1) cargos/abonos, fecha valor, moneda y cuenta se interpretan sin ambigüedad; (2) reimportar el archivo no duplica y transacciones legítimas iguales no se colapsan por monto/fecha; (3) filas rechazadas y causa se muestran sin perder las válidas.

**Verificación:** fixture anonimizado del banco elegido, repetición y archivo parcialmente inválido. **Dependencias:** BAN-01. **Tamaño:** M. **Entradas:** parser, servicio/importación, lote/evidencia y pruebas. Cada banco adicional es una subtarea nueva.

### BAN-03 — Proponer coincidencias de pago sin confirmarlas a ciegas

**Entrega:** sugerencias trazables entre movimientos bancarios y partidas de tesorería.

**Aceptación:** (1) exige empresa/cuenta/moneda coherentes y reglas explícitas de referencia/importe/fecha; (2) múltiples candidatos quedan ambiguos; (3) una referencia capturada o layout descargado no marca conciliación por sí mismo.

**Verificación:** pagos iguales, referencias parciales, fechas distintas y movimiento de cuenta ajena. **Dependencias:** BAN-02. **Tamaño:** M. **Entradas:** servicio de matching nuevo, consultas de partidas y pruebas.

### BAN-04 — Confirmar o revertir conciliación de egresos

**Entrega:** usuario autorizado concilia una partida y su obligación con trazabilidad bancaria.

**Aceptación:** (1) vínculo y estado económico se actualizan atómicamente sin doble uso del movimiento; (2) fallo/reversa restaura deuda y conserva historial; (3) pagos parciales, varios movimientos y comisiones tienen soporte explícito o un bloqueo visible hasta implementarse.

**Verificación:** factura/gasto→corrida→movimiento→conciliar→revertir, con concurrencia; agregar caso de nómina al cerrar NOM-05. **Dependencias:** BAN-03, AUD-01. **Tamaño:** M por modalidad. **Entradas:** `treasury-service.ts`, relaciones bancarias, API/UI y pruebas. Entregar primero uno-a-uno; dividir parcial/múltiple en subtareas.

### BAN-05 — Relacionar ingresos esperados con liquidaciones de canal

**Entrega:** corte/TPV/canal produce liquidación esperada con bruto, comisión, impuestos/retenciones y neto documentados según el archivo fuente.

**Aceptación:** (1) distingue venta del día y fecha de liquidación; (2) importación repetida no duplica; (3) faltantes y diferencias generan pendiente accionable con responsable.

**Verificación:** lote de terminal y liquidación de un agregador, incluyendo ajuste/devolución. **Dependencias:** BAN-02, INV-01. **Tamaño:** M por canal. **Entradas:** `tpv-batch-service.ts`, `aggregator-settlement-service.ts`, `commission-service.ts`, pruebas.

### BAN-06 — Conciliar depósitos de ingresos con banco

**Entrega:** ingreso esperado se liga al abono real y conserva diferencias.

**Aceptación:** (1) no confunde ventas brutas con depósito neto; (2) una liquidación con varios cortes puede comprobarse sin duplicar depósitos; (3) comisiones/faltantes/depósitos tardíos alimentan excepciones y antigüedad.

**Verificación:** corte→lote/liquidación→abono bancario→diferencia/resolución. **Dependencias:** BAN-05, BAN-04 para reutilizar controles de vínculo/reversa. **Tamaño:** M por modalidad. **Entradas:** matching de ingresos, gateway/settlements, API/UI y pruebas.

### FIN-01 — Separar caja proyectada y saldo bancario conciliado

**Entrega:** cash-flow muestra saldo conciliado, obligaciones y proyección con procedencia explícita.

**Aceptación:** (1) fecha/moneda/cuenta del saldo son visibles; (2) lo capturado manualmente y lo estimado se identifican; (3) una obligación no se cuenta simultáneamente como OC, factura y pago pendiente.

**Verificación:** mismo período con pago parcial, contrato recurrente y liquidación pendiente; cuadrar saldo inicial+movimientos=saldo final. **Dependencias:** BAN-04, BAN-06. **Tamaño:** M. **Entradas:** `cash-flow-service.ts`, consultas bancarias, API/UI y pruebas.

### FIN-02 — Cerrar P&L por sucursal y grupo

**Entrega:** período cerrado con versión reproducible y fuentes de cada línea.

**Aceptación:** (1) ventas, food cost, merma, labor y comisión tienen período y procedencia; (2) suma de sucursales concilia con consolidado, explicitando corporativos/no asignados; (3) cierre y reapertura conservan snapshots y autorizaciones.

**Verificación:** escenario con datos conocidos; cierre→cambio posterior→consulta histórica sin alteración. **Dependencias:** INV-04, NOM-05, BAN-06. **Tamaño:** M por cierre/consolidado. **Entradas:** `pnl-service.ts`, `pnl-snapshot-service.ts`, `financial-period-service.ts`, pruebas.

**Puerta de fase 6:** una factura pagada y un ingreso por canal quedan conciliados con movimientos bancarios identificables; rechazo y reversa preservan deuda; P&L/cash muestran fuentes reales y límites.

## Fase 7 — Completar cobertura operativa

### OPE-01 — Operar recurrencias de mantenimiento

**Entrega:** schedule editable genera la siguiente orden sin duplicados y registra su ejecución.

**Aceptación:** (1) alta/cambio/pausa del schedule se refleja en próximas fechas; (2) dos jobs/reintentos no generan la misma orden dos veces; (3) cierre real actualiza fechas/costo y dispara la próxima ocurrencia según política.

**Verificación:** equipo→schedule→job→orden→cierre con reloj controlado. **Dependencias:** SEC-01, AUT-01 para la verificación desplegada. **Tamaño:** M por UI/job. **Entradas:** `equipment-service.ts`, schedules, función Inngest y pruebas.

### OPE-02 — Medir indisponibilidad y costo de equipo

**Entrega:** intervalos de falla/reparación y reporte comparativo reproducible.

**Aceptación:** (1) apertura/cierre de falla registra inicio/fin sin intervalos contradictorios; (2) costos de OS/mantenimiento se atribuyen sin duplicarse; (3) reporte muestra recurrencia y costo acumulado para apoyar reparar/reemplazar, sin inventar una recomendación automática.

**Verificación:** dos averías y reparaciones del mismo equipo; comparar historia, duración y costo. **Dependencias:** OPE-01, COM-01. **Tamaño:** M. **Entradas:** equipos, OS, reporte y pruebas.

### OPE-03 — Cubrir las rutinas faltantes y control de aceite

**Entrega:** subtareas independientes para aceite, cocina, salón/counter, checklist gerente y handoff.

**Aceptación:** (1) cada rutina define medición/evidencia, responsable, frecuencia y política de excepción; (2) se ejecuta por el motor existente, con resultado consultable; (3) incumplimiento crea acción verificable y no una simple marca verde.

**Verificación:** una ejecución conforme y otra fuera de rango por rutina; los umbrales sanitarios se validan al implementar con la política aplicable. **Dependencias:** EXC-03, EVI-01. **Tamaño:** S/M por rutina. **Entradas:** template JSON, validación/efecto existente y prueba del recorrido. No requerir sensores ni control directo de delivery para cerrar estas rutinas.

### COM-01 — Demostrar compra y servicio hasta obligación pagable

**Entrega:** recorridos separados de requisición→OC→recepción→CFDI y OS→cotización→conformidad→factura.

**Aceptación:** (1) delegación, presupuesto, proveedor y aprobación actúan en el servidor; (2) discrepancia/reclamo/nota de crédito conserva vínculo y no habilita pago indebido; (3) deuda se presenta una vez a tesorería con centro de costo y vencimiento.

**Verificación:** un caso normal y otro con diferencia por recorrido. **Dependencias:** REC-02, EXC-03, BAN-04. **Tamaño:** M por recorrido. **Entradas:** servicios de OC/OS, matching y pruebas; corregir sólo las brechas reproducidas, sin reconstruir lo que ya funciona.

### APR-01 — Unificar el contrato de aprobación entre dominios

**Entrega:** consulta/acción coherente de pendientes con autoridad, monto, motivo y evidencia, conservando reglas especializadas.

**Aceptación:** (1) UI y servidor deciden con la misma política; (2) factura/gasto/OC/OS/nómina/pago no evitan su regla al cambiar de endpoint; (3) revocación/cambio de monto invalida aprobaciones cuando corresponda.

**Verificación:** matriz de autorizaciones por tipo documental, incluyendo acceso directo a API. **Dependencias:** NOM-03, COM-01, BAN-04, AUD-01. **Tamaño:** M por documento. **Entradas:** approval matrix, políticas de gastos/tesorería y API de pendientes. Unificar contrato no exige reemplazar todos los motores con uno nuevo.

### PER-01 — Verificar las ocho vistas por persona

**Entrega:** mapa explícito persona→capacidades→alcance, consistente entre navegación y API.

**Aceptación:** (1) OWNER accede de forma consistente y supervisor sólo a su cartera autorizada; (2) Finanzas/Compras/RH tienen capacidades separadas sin depender del nombre del puesto; (3) colaborador sólo opera sus tareas/instrucciones/evidencias y sus funciones personales permitidas.

**Verificación:** ocho cuentas de prueba y matriz allow/deny en API y navegador, incluidas URLs directas. **Dependencias:** SEC-01/02/03, APR-01. **Tamaño:** M por perfil. **Entradas:** `lib/permissions.ts`, `lib/rbac/permissions.ts`, visibilidad por sucursal y pruebas. Decidir con el contrato existente si hacen falta roles nuevos o bastan capacidades; no duplicar sistemas de permisos.

### AUT-01 — Verificar el runtime de automatización

**Entrega:** entorno identificado con Inngest/colas configurado, jobs observables y recuperación demostrada.

**Aceptación:** (1) finalización de workflow llega al efecto de negocio y se recupera de caída; (2) reintentos y aislamiento por empresa no duplican efectos; (3) fallo terminal tiene responsable y señal visible, sin exponer claves.

**Verificación:** workflow de prueba→outbox→extractor→movimiento y simulación de consumidor caído. **Dependencias:** REC-02, EXC-02, AUD-01. **Tamaño:** M por job/recorrido. **Entradas:** `lib/inngest/functions`, outbox, observabilidad y pruebas. Verificar también hold time, mantenimiento, SLA y snapshots al cerrar sus tareas.

### CTL-01 — Alimentar control tower y daily brief con fuentes verificadas

**Entrega:** dashboard, comparación y brief persistido reflejan la misma fecha, alcance y calidad de datos.

**Aceptación:** (1) KPI enlaza a su detalle y declara antigüedad/cobertura; (2) brief del día se genera idempotentemente y sus acciones tienen owner/SLA; (3) falta de dato no equivale a salud perfecta ni saldo cero.

**Verificación:** generar/repetir brief, resolver excepción y comparar dashboard↔detalle↔snapshot. **Dependencias:** EXC-04 por fuentes necesarias, FIN-01/02, AUT-01. **Tamaño:** M por vista/proyección. **Entradas:** `live-command-service.ts`, `executive-twin-engine.ts`, `morning-brief-service.ts`, pruebas.

### INT-01 — Demostrar ingesta por POS y canal

**Entrega:** formatos disponibles del grupo producen cortes y mix reconciliables, con mapeo reutilizable.

**Aceptación:** (1) ventas/tickets/mix por sucursal y canal cuadran con el archivo original; (2) repetición/corrección no duplica efectos; (3) importación soportada se distingue de API directa y de control online/offline de tienda/producto.

**Verificación:** archivos anonimizados POS, terminal y agregador; seguimiento hasta BAN-06. **Dependencias:** INV-01/02, BAN-06. **Tamaño:** M por fuente. **Entradas:** ingesta POS, mapeo, comisiones y pruebas.

Si se requiere operar disponibilidad online/offline, crear subtarea independiente por proveedor después de comprobar API, credenciales, permisos y semántica de tienda/producto. No prometer conectores directos por tener el nombre del canal en el catálogo. El importador verificable cubre recepción de información cuando el proveedor no ofrece una integración accesible.

## Fase 8 — Validación y liberación

### VAL-01 — Resolver cada fila de la matriz de requisitos

**Entrega:** matriz actualizada con tarea responsable y evidencia de aceptación, separando lo implementado de lo aún pendiente.

**Aceptación:** (1) las 217 filas tienen estado final, prueba, entorno y fecha; (2) funciones hoy sólo «CÓDIGO/PLANTILLA» se ejecutan en su recorrido o permanecen pendientes; (3) cero tabla vacía se interpreta como falta de uso observado, nunca como permiso para poblarla artificialmente y declarar cumplimiento.

**Verificación:** recorrido por los 17 módulos y ocho personas, incluyendo vacaciones, training, performance, versiones de receta, transferencias, alto valor, PAR, petty cash, scorecard y reportes NOM. **Dependencias:** todas las tareas aplicables de fases 1–7 y SEC-05 de los dominios liberados. **Tamaño:** S/M por módulo. **Entradas:** pruebas de aceptación y matriz; cada brecha nueva genera subtarea con criterio, sin ampliación silenciosa del alcance.

### VAL-02 — Pilotear operación y recuperación en grupo

**Entrega:** piloto trazable antes de declarar completo el sistema.

**Aceptación:** (1) ciclo de día/turno, compra, conteo, nómina y cierre financiero probado con importes/cantidades conocidos; (2) pruebas de volumen con 3, 8 y 15 sucursales usan datos aislados y un presupuesto de latencia aprobado antes de medir; (3) respaldo/restauración, reversa de conciliación y recuperación de jobs se ensayan sin pérdida/doble efecto.

**Verificación:** suite unitaria + TypeScript + build finalizado + E2E y reporte de conciliaciones/latencia/errores; piloto con usuarios designados y riesgos residuales explícitos. **Dependencias:** VAL-01. **Tamaño:** M por jornada/recorrido. **Entradas:** fixtures, E2E, configuración de despliegue y reporte de piloto.

**Puerta final:** ningún P0 abierto; cada requisito está demostrado o explícitamente pendiente con alcance acordado; no se declara cumplimiento total mientras queden filas sin resolver. Entregar evidencia del código y del entorno desplegado, no sólo capturas o datos de seed.

## Trazabilidad de los hallazgos

| Hallazgo de investigación | Tareas de cierre |
|---|---|
| H01 Recepción duplica saldo | REC-01/02/03 |
| H02 Nómina/exportación incompletas | NOM-01/02/03/04/05 |
| H03 Excepción canónica sin tabla/activación | EXC-01/02/03/04 |
| H04 Alcance/autorización desiguales | SEC-01/02/03/04/05, PER-01 |
| H05 Falta conciliación banco↔pago | BAN-01/02/03/04/05/06, FIN-01 |
| H06 Corrección de venta no ajusta consumo | INV-01/02 |
| H07 Sin lote de producto terminado/modelos paralelos | PROD-01/02 |
| H08 EvidenceStore en memoria | EVI-01 |
| H09 Automatizaciones/cierres sin ejecución acreditada | AUT-01, CTL-01, INV-04, FIN-02 |
| H10 Auditoría no garantizada | AUD-01, integración en cada recorrido sensible |

## Cobertura de módulos

| Módulo | Tareas principales para cerrarlo |
|---|---|
| 1 Organización/configuración | SEC-04/05, AUD-01, PER-01, VAL-01 |
| 2 Centro de control | EXC-02/04, FIN-01/02, CTL-01 |
| 3 Workflows | REC-02, EVI-01, AUT-01, VAL-01 |
| 4 Evidencia/verificación | SEC-02, EVI-01, EXC-03, VAL-01 |
| 5 Excepciones/incidentes | EXC-01/02/03/04 |
| 6 Operación diaria | OPE-03, AUT-01, INT-01, VAL-01 |
| 7 Food safety/calidad | REC-01/02, OPE-03, EXC-04, VAL-01 |
| 8 Equipos/mantenimiento | SEC-01, OPE-01/02, COM-01 |
| 9 Workforce | NOM-01/02, PER-01, VAL-01 |
| 10 Nómina | NOM-01/02/03/04/05 |
| 11 Recetas/food cost | INV-01/02/04, PROD-01/02 |
| 12 Producción | PROD-01/02, INV-02/03/04 |
| 13 Inventarios | REC-01/02/03, INV-01/02/03/04 |
| 14 Compras/proveedores | COM-01, APR-01, VAL-01 |
| 15 Recepción | REC-01/02/03, COM-01 |
| 16 Administración/CxP | COM-01, APR-01, BAN-04, EVI-01 |
| 17 Finanzas/tesorería | BAN-01/02/03/04/05/06, FIN-01/02 |
| Ventas/canales | SEC-03, INV-01/02, INT-01, BAN-05/06 |
| Personas/alcances | SEC-01/02/03/04/05, PER-01 |

## Riesgos y decisiones pendientes, sin bloquear el trabajo independiente

| Tema | Resolución prevista |
|---|---|
| Cambios concurrentes en código/base | BASE-01 registra snapshot y cada tarea revalida antes de editar |
| Datos históricos insuficientes | REC-03 reporta ambigüedad; se corrige por evidencia o conteo, nunca por suposición |
| Salario contractual ambiguo y reglas fiscales | NOM-01 fija contrato/vigencia antes de calcular o migrar |
| Consumo duplicado entre producción y venta | INV-02 define propietario del consumo antes de inventariar terminado |
| Banco y formatos disponibles | Elegir un archivo real anonimizado en BAN-02; añadir bancos como subtareas |
| RLS rompe jobs/pool | Piloto transaccional SEC-04 y rollout por dominio SEC-05, con reversión probada |
| Roles departamentales/cartera supervisor | PER-01 fija capacidades y alcance antes de agregar roles o relajar controles |
| API directa de delivery no disponible | Mantener importación verificable; control de disponibilidad queda separado y explícito |
| Fechas de entrega no fundadas | Estimar después de BASE-01 y primer lote P0; no comprometer un calendario ficticio para todas las fases |

Este plan no ejecuta migraciones, ajustes de saldos, pagos, timbrados ni despliegues. El siguiente trabajo concreto es BASE-01 y, una vez revalidados, los tres accesos afectados y el saldo de recepción.
