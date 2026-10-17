# Evaluación de Pulso frente a sistemainvestigacion17oct.md

Fecha: 17 de octubre de 2026. Alcance: repositorio local de Pulso, incluyendo cambios sin commit. Referencia Git: `008005acc3dab8f6786e675bac5cac6e194d88f6`.

## Dictamen

**Pulso cumple parcialmente con el alcance solicitado. Tiene una base funcional extensa, pero todavía no se puede afirmar que cubra integralmente los 17 módulos y sus conexiones.**

Las áreas con mayor evidencia de implementación son workflows, recetas, inventario, compras, recepción y administración del personal. También existen CxP, tesorería, timbrado de nómina, presupuestos, P&L y conciliación de ingresos. El trabajo pendiente combina controles transversales, conexiones entre módulos y algunas funciones ausentes.

Los bloqueos principales son:

1. Evidencia común todavía sin índice persistente en base de datos.
2. Excepciones agregadas desde varios dominios, sin ciclo de vida canónico compartido.
3. Nómina sin integrar completamente horas extra, ausencias, vacaciones, bonos y deducciones.
4. Cuentas bancarias propias, movimientos y conciliación banco–pago sin implementación localizada.
5. Producción sin completar el alta del lote de producto terminado en el flujo revisado.
6. Consumo por ventas conectado, pero sin resolver adecuadamente correcciones y recuperación ante fallos.
7. Auditoría fragmentada, autorizaciones distintas por dominio y RLS pendiente de aplicación.

**No recomiendo reconstruir los módulos existentes. Recomiendo cerrar estos circuitos sobre los modelos actuales y exigir pruebas de extremo a extremo antes de declararlos completos.**

## Cómo interpretar la revisión

La evaluación contrasta requisitos contra esquema, servicios, entradas API, plantillas, tareas durables y pruebas. CodeGraph reportó 1,659 archivos indexados. Se inspeccionaron directamente los flujos con mayor impacto y se usaron los planes existentes como contexto, no como prueba de implementación.

Estados de la matriz adjunta:

| Estado | Significado |
|---|---|
| Implementado en código | Existe evidencia concreta de lógica o flujo implementado para ese requisito. No certifica su operación en producción. |
| Parcial | Hay implementación, pero se identificó una limitación o conexión pendiente. |
| Sin implementación localizada | No se encontró la pieza requerida en el alcance inspeccionado. No equivale a demostrar su inexistencia en servicios externos. |
| Base localizada; por verificar | Hay una ruta, modelo, plantilla o servicio relacionado, pero la revisión no demuestra el requisito completo. No debe contarse como cumplido ni como faltante confirmado. |

La [matriz de requisitos](matriz-cumplimiento-sistema-2026-10-17.csv) conserva los puntos del documento y añade ventas, canales, casos de excepción y perfiles. No se asigna un porcentaje global: mezclar funciones implementadas, tablas sin consumidor y capacidades no verificadas produciría una cifra engañosa.

La matriz contiene **239 puntos de evaluación**: las 205 viñetas de los 17 módulos y 34 puntos adicionales del texto sobre casos, preguntas, canales, personas y alcance. La clasificación técnica es: 98 implementados en código, 98 parciales, 39 con base localizada pendiente de verificación y cuatro sin implementación localizada. Estos conteos no representan porcentajes de preparación para producción.

### Límites de la evidencia

- Esta es una revisión técnica del repositorio, no una certificación operativa, fiscal o normativa.
- No se consultaron registros de producción para comprobar las ocho unidades, responsables, saldos, configuración o calidad de datos.
- No se ejecutaron timbrados, pagos, migraciones, mensajes ni cambios en bases de datos.
- No se probó la aplicación en navegador ni se ejecutó la suite E2E con base de datos. Que existan esos tests no significa que hayan pasado en esta revisión.
- Las mejoras locales de seguridad y doble firma se incluyen en el resultado, pero no se presume que estén desplegadas.

## Cobertura de los 17 módulos

| Módulo | Lo que sí está localizado o implementado | Pendiente para cubrir el alcance completo |
|---|---|---|
| 1. Organización y configuración | Empresas, sucursales con horarios/zona/responsable, usuarios, permisos y configuración operacional. | Auditoría unificada; aplicar y probar seguridad en DB; demostrar vistas y permisos específicos por departamento; comprobar configuración real de las ocho unidades. |
| 2. Centro de Control | Comparación de sucursales, tableros ejecutivos, twin, riesgos, morning brief persistido y feed de excepciones. | Pendientes con owner/SLA y cierre verificable comunes; liquidez respaldada por banco; demostrar consistencia entre indicadores, alertas y decisiones. |
| 3. Workflows | Builder, plantillas, asignaciones, programación, ejecución, finalización y extractores de recepción, conteo, merma y producción. Existe outbox, recuperación y seguimiento de efectos. | Validar el circuito completo en staging, incluyendo caída de Inngest, reintentos, duplicados y permisos. Los efectos heredan los pendientes de recepción y producción. |
| 4. Evidencia | Fotos, archivos y evidencia embebida en workflows y otros dominios; verificación con IA; referencias a almacenamiento R2. | Hacer persistente la entidad común, ampliar sujetos a gasto/factura/pago/aprobación y unificar consulta, verificación y autorización. |
| 5. Excepciones e incidentes | Incidentes, severidad, remediación, escalamiento y agregación de varias fuentes. | Una excepción común con responsable, SLA, acción, resolución, verificación independiente, cierre y reapertura para todos los casos del documento. |
| 6. Operación diaria | Plantillas de apertura, cierre, cambio de turno, limpieza, sanitización, producción, higiene y mantenimiento. | Demostrar rutinas por estación y checklist de gerente; entrega de turno con pendientes; registro/control de disponibilidad de canales delivery. |
| 7. Food safety y cumplimiento | Temperaturas, validación en recepción, cuarentena por lecturas fuera de rango, FEFO, higiene, fumigación, auditoría interna y reportes. | Política de lectura obligatoria; trazabilidad de frío completa; control de aceite más allá de checklist; cierre verificable de planes correctivos y prueba operacional del historial. |
| 8. Equipos y mantenimiento | Catálogo, equipo por sucursal, historial, garantías, proveedores, registros de mantenimiento, costos y próximos mantenimientos registrados. | Writer productivo de programación recurrente; generación/seguimiento de órdenes; demostrar downtime, reincidencia y soporte a decisión reparar/reemplazar. |
| 9. People / Workforce | Expedientes, contratos, puesto/sucursal, plantillas y horarios, sesiones de turno, breaks, permisos/vacaciones, propinas, performance y estructuras de capacitación. | Conectar incidencias y asistencia aprobada con nómina; demostrar certificaciones y vencimientos; permisos específicos de RH frente a finanzas. |
| 10. Nómina | Corridas, recibos, validación previa, percepciones base, propinas, prima por festivos y llamada al timbrado. Tesorería contempla nómina. | Pre-nómina basada en asistencia real, horas extra, faltas, vacaciones, bonos y deducciones; aprobación de versión congelada antes de timbrar; conciliación del pago neto. |
| 11. Catálogo, recetas y food cost | SKUs, unidades, recetas/subrecetas, versiones, yield, costeo, simulación y consumo teórico desde importación de ventas. | Mapeo estable de producto POS/canal; correcciones por diferencia, recuperación y atomicidad del consumo; comparar costo real/teórico con una base consistente. |
| 12. Producción | Órdenes, prep list por estación/turno/responsable/hora, resultados, ingredientes, cantidades, costos, FEFO, hold time, sugerencias y faltantes. | Alta del producto terminado como lote; genealogía completa; consolidar el modelo paralelo; revisar movimientos, fracciones y relación producción–consumo por ventas. |
| 13. Inventarios | Stock por sucursal, lotes/caducidades, FEFO, movimientos, conteo, ajustes, merma, transferencias, alto valor, costos y servicios de snapshots/sugeridos. | Probar integridad contra producción y correcciones de ventas; demostrar PAR, snapshots y variaciones en operación con datos reales y concurrencia. |
| 14. Compras y proveedores | Proveedores/productos, términos, cuentas verificadas, órdenes, aprobación OC/OS, requisiciones, sugeridos, delegación, scorecard y claims localizados. | Validar la secuencia requisición→autorización→OC→recepción→factura→pago; alinear políticas de autorización entre dominios. |
| 15. Recepción | Reporte, OC, cantidades/precios, lote/caducidad, fotos/firma, cuarentena, reclamo, entrada de inventario y enlace a factura/3-way match. | Evitar aceptación sin lectura donde corresponda; corregir costo al convertir unidades; probar reintentos y fallos sin entradas incompletas ni duplicadas. |
| 16. Administración y CxP | CFDI/XML, bandeja/sync, líneas, matching, discrepancias, vencimientos/aging, gastos, caja chica, contratos recurrentes y catálogo de centros de costo. | Evidencia/aprobación compartidas; trazabilidad financiera de centros de costo hasta reportes; completar conciliación bancaria y demostrar el circuito de pago. |
| 17. Finanzas y tesorería | CxP, payees, corridas, aprobaciones, doble firma local, layouts, liquidación por partida, presupuestos, períodos, cash flow, P&L, food/labor cost y comisiones. | Banco propio y movimientos; conciliación bancaria verificable; validación bancaria de layouts; solicitudes de pago como proceso trazable; consistencia de costos/contribution/unit economics. |

## Hallazgos que requieren implementación o corrección

### H01. Evidencia común no durable — prioridad alta

**Evidencia:** [evidence-store.ts](../lib/services/evidence-store.ts), líneas 14–17 y 78–80. La fachada declara que la persistencia está diferida y usa `Map<string, EvidenceRecord>`. Sus sujetos actuales son workflow, incidente, documento y general.

El archivo puede permanecer en R2, pero el registro común y sus metadatos no sobreviven necesariamente al reinicio o a otra instancia del servidor. Esto no implica que toda la evidencia existente se pierda: varios dominios sí conservan sus propias URLs en DB.

**Implementar:** registro persistente con empresa/sucursal, sujeto, tipo, archivo, autor, fecha y resultado de verificación; escritura desde los dominios actuales; migración idempotente de referencias y consulta con permisos.

**Criterio de cierre:** un gasto, una factura, un pago, una excepción y un paso de workflow recuperan su evidencia tras reiniciar el proceso, con acceso denegado a otra empresa.

### H02. Excepción común sin lifecycle — prioridad alta

**Evidencia:** [group-exceptions-service.ts](../lib/services/group-exceptions-service.ts), líneas 16–22 y método `listOpen` desde la línea 252. Su diseño explícito es agregar lecturas; cada dominio conserva la resolución.

No es correcto decir que no hay excepciones. Sí hay feed e incidentes con procesos propios. Lo que no está cerrado es un comportamiento transversal equivalente para temperatura, merma, factura, presupuesto, ausencia, equipo y pago sin conciliar.

**Implementar:** identidad persistente e idempotente de excepción; owner, SLA y estados; adaptadores desde los dominios; escalamiento; evidencia de resolución; verificación y reapertura; API/UI de acciones y auditoría.

**Criterio de cierre:** los siete casos del documento recorren detección→asignación→acción→resolución→verificación→cierre/reapertura con la misma política y sin duplicarse al reintentar.

### H03. Nómina no consume completamente la realidad laboral — prioridad alta

**Evidencia:** [payroll-service.ts](../lib/services/payroll-service.ts), líneas 227–344. La base se calcula como salario diario por días calendario del período; `overtimePayCents` y `totalDeduccionesCents` se devuelven en cero. Sí se consultan sesiones completadas para prima de festivos.

El reporte de costo laboral tiene su propio cálculo en [labor-cost-service.ts](../lib/services/labor-cost-service.ts). Tener un indicador que usa asistencia no demuestra que la nómina timbrada use el mismo cálculo.

**Implementar:** pre-nómina por empleado/período con asistencia validada, horas extra aprobadas, faltas, vacaciones/permisos, bonos y deducciones; revisión y aprobación; snapshot de conceptos; timbrado y pago de esa misma versión. Reutilizar reglas existentes y validar los conceptos con responsables de nómina.

**Criterio de cierre:** un período con falta, vacaciones, overtime, bono y deducción produce importes explicables y coherentes entre pre-nómina, recibo, CFDI, costo de sucursal y pago neto. La autorización para ejecutar nómina no sustituye la aprobación de su contenido.

### H04. Falta cerrar banca y conciliación de egresos — prioridad alta

**Evidencia:** [treasury.ts](../lib/db/schema/treasury.ts), línea 77: la cuenta origen de corrida es texto libre. No se localizaron símbolos `companyBankAccounts`/`bankTransactions` ni tablas/migraciones con los nombres bancarios convencionales buscados. Las cuentas verificadas encontradas son de proveedores y payees.

[reconciliation/transactions](../app/api/finance/reconciliation/transactions/route.ts) consulta `GatewayReportService`: es evidencia de conciliación del lado de cobros/pasarelas, no del ledger bancario de la empresa. La liquidación en [treasury-service.ts](../lib/services/treasury-service.ts), línea 1228, acepta referencia o motivo de fallo suministrados por el actor.

**Implementar:** catálogo de cuentas propias; importación idempotente de estados/movimientos; asociación banco–partida–documento; pendientes/diferencias; manejo de parciales, reversos y comisiones; revisión y auditoría. Vincular las corridas a cuentas propias verificadas y probar layouts con los bancos objetivo.

**Criterio de cierre:** una salida bancaria real enlaza con el pago y su obligación; una diferencia queda visible y gestionable; reimportar no duplica movimientos; una confirmación manual se distingue de una conciliación respaldada por banco.

### H05. Producción no completa el lote de salida — prioridad alta

**Evidencia:** [production-service.ts](../lib/services/production-service.ts), línea 232: `TODO: insert into inventoryBatches for finished goods`. El flujo registra resultados e ingredientes y descuenta lotes; [recipe-production.ts](../lib/services/recipe-production.ts) lo invoca desde el recorrido FEFO. El producto terminado no queda creado como lote en ese recorrido.

También existen `production_plans`, `production_plan_items` y `production_batches` en [schema/production.ts](../lib/db/schema/production.ts); CodeGraph no encontró llamadores para `productionPlans` ni `productionBatches`. La prep list actual usa `production_orders`, según [prep-list-service.ts](../lib/services/prep-list-service.ts).

**Implementar:** definir el modelo canónico sobre el recorrido usado; lote de producto terminado con cantidad/unidad/caducidad y genealogía de ingredientes; movimientos consistentes y operación atómica. Decidir cuándo descuenta materia prima la producción y cuándo la venta para evitar descontarla dos veces. Revisar soporte a fracciones: el helper de producción redondea la cantidad producida.

**Criterio de cierre:** producir una subreceta genera stock utilizable y trazable; consumirla conserva la genealogía y no vuelve a descontar los mismos insumos. Un reintento o fallo no deja media operación aplicada.

### H06. Venta→consumo existe, pero las correcciones pueden desalinear stock — prioridad alta

**Evidencia:** [sales-ingest-service.ts](../lib/services/sales-ingest-service.ts), líneas 87–183. Hace upsert de ventas; llama a `TheoreticalConsumptionService.consume` únicamente si la fila es nueva (`written?.isNew`).

Dos casos se desprenden directamente del flujo:

- Reimportar 12 unidades donde antes había 10 actualiza la venta, pero no descuenta las dos adicionales.
- Si la venta se persiste y falla su consumo posterior, la reimportación encuentra una fila existente y puede omitir la recuperación del consumo.

El descuento tiene transacciones internas por insumo en [theoretical-consumption-service.ts](../lib/services/theoretical-consumption-service.ts), pero eso no hace atómico el conjunto venta–receta–todos los insumos.

**Implementar:** identidad de importación/venta, versión o diferencia de consumo; efectos recuperables e idempotentes; cambios, anulaciones y reversos; mapeo explícito POS/canal→receta, incluyendo SKU cuando aplique. Separar consumo teórico analítico de movimientos físicos cuando corresponda al modelo productivo.

**Criterio de cierre:** importar, repetir, corregir y anular produce exactamente el consumo esperado; un fallo intermedio puede recuperarse sin omitir ni duplicar movimientos.

### H07. Recepción permite omitir temperatura y tiene un error de conversión de costo — prioridad alta

**Evidencia de temperatura:** [receiving-service.ts](../lib/services/receiving-service.ts), línea 30, la lectura es opcional. [receiving-temperature.ts](../lib/services/receiving-temperature.ts) devuelve `quarantined: false` si no recibe lectura. Cuando sí hay lectura fuera de los rangos configurados, el flujo crea cuarentena y genera señales de incidente/reclamo.

**Evidencia de costo:** líneas 140–143 de `receiving-service.ts`: asigna `quantity = convertedQty` y luego multiplica `unitCost` por `quantity / convertedQty`, factor que ya es uno. Se pierde la corrección inversa de costo por unidad.

Ejemplo ilustrativo: recibir 2 cajas de 10 kg a $1,000 por caja debe quedar como 20 kg a $100/kg. El ajuste actual no transforma ese costo si se usan esas unidades y valores.

**Implementar:** política de lectura exigible por tipo de almacenamiento con excepción autorizada y trazable; conservar cantidad original para convertir el costo; validar unidades soportadas. Probar también recepción incompleta, repetición y caída entre escrituras: el servicio realiza múltiples escrituras y no establece por sí mismo una transacción global.

**Criterio de cierre:** falta de lectura no se confunde con conformidad; una conversión conserva el valor total recibido; un fallo no duplica stock ni deja un reporte aparentemente completo con entradas parciales.

### H08. Mantenimiento recurrente incompleto — prioridad media/alta

**Evidencia:** `equipmentMaintenanceSchedules` está definido en [schema/equipment.ts](../lib/db/schema/equipment.ts), línea 290. No se encontraron llamadores en CodeGraph. [equipment-service.ts](../lib/services/equipment-service.ts), desde línea 510, sí crea y completa registros individuales y consulta próximos mantenimientos desde el historial.

**Implementar:** alta/edición/activación de recurrencias; generador durable de órdenes sin duplicados; responsable/proveedor/SLA; actualización de próximas fechas; alertas por vencimiento y medición de downtime/costo/reincidencia.

**Criterio de cierre:** una frecuencia configurada produce su orden, la vuelve visible y notificable, y el cierre programa la siguiente sin generar duplicados.

### H09. Auditoría, autorizaciones y seguridad DB siguen fragmentadas — prioridad alta

**Evidencia:** [audit-service.ts](../lib/services/audit-service.ts) escribe logs de empleado e inventario. [security/audit.ts](../lib/security/audit.ts) registra accesos. La razón del cambio es opcional en interfaces de auditoría; el logger de accesos captura su propio fallo y continúa.

[approval-matrix-service.ts](../lib/services/approval-matrix-service.ts), líneas 13–19, declara alcance exclusivo OC/OS; los gastos mantienen otro mecanismo y tesorería su política de firmas. No implica ausencia de aprobación: implica que todavía no es un control compartido para todos los documentos.

El [plan RLS](closeout-pulso-1.0/PHASE--1-RLS-PLAN.md) declara que no se aplicó. La búsqueda de sentencias de activación/policies en el esquema y migraciones no encontró una implementación. Los controles de aplicación actuales sí existen y deben conservarse.

**Implementar:** lectura unificada de auditoría y cobertura obligatoria de actor/fecha/acción/antes/después/motivo en acciones críticas; políticas de aprobación coherentes, sin perder especialización por documento; contexto de empresa en conexiones/transacciones antes de aplicar RLS; prueba de aislamiento en staging.

**Criterio de cierre:** reconstruir desde una factura hasta su aprobación, evidencia, pago y conciliación; demostrar bloqueo entre empresas/sucursales y separación entre preparador, aprobador y verificador.

### H10. Cierre financiero y vistas por persona requieren demostración — prioridad media/alta

**Evidencia:** [pnl-service.ts](../lib/services/pnl-service.ts), línea 101, agrega ventas, gastos, costos de alimentos, personal, comisiones y caja chica. [food-cost-service.ts](../lib/services/food-cost-service.ts), línea 98, utiliza movimientos cuando los tiene, compras como aproximación y declara ausencia de datos. El P&L conserva fuentes/estimaciones y dispone de mecanismos de cierre/snapshot relacionados.

El catálogo en [cost-center-service.ts](../lib/services/cost-center-service.ts) existe. Eso no demuestra distribución, imputación y lectura por centro de costo en todos los egresos y renglones del reporte.

La [matriz general de permisos](../lib/permissions.ts) usa siete roles: `SUPER_ADMIN`, `OWNER`, `ADMIN`, `GERENTE`, `SUPERVISOR`, `EMPLEADO`, `READONLY`. `DIRECTOR_OPS` existe como nivel de aprobación, no como rol de usuario de esa matriz. Hay recursos amplios como `reports` e `inventory`.

**Implementar/validar:** trazabilidad por centro de costo; consistencia entre nómina pagada y costo de personal; costos históricos al cerrar períodos; indicadores prime cost/contribution/unit economics con definiciones explícitas; vistas y permisos efectivos por puesto. No hacen falta necesariamente ocho nuevos roles: capacidades y alcances pueden cubrirlos.

**Criterio de cierre:** director, operaciones, supervisor, gerente, finanzas, compras, RH y colaborador completan su trabajo con la información autorizada y sin acceso lateral. El colaborador queda limitado a sus tareas/instrucciones/evidencia, si se mantiene literalmente el requisito.

## Ventas y canales

El enfoque de recibir información de POS/canales es compatible con la implementación existente. Se localizaron ingestión, cortes, analytics, comisiones, terminales, batches TPV, transacciones gateway y settlements de agregadores.

**Sí hay:** importación de información, normalización, ventas por sucursal/período, cortes, fuentes de conciliación de cobros y comisión de canal en el P&L.

**Falta demostrar o cerrar:** mapeo de cada POS/canal a receta; correcciones y reversos; trazabilidad ticket→mix→corte→settlement→depósito; conciliación con cuenta bancaria propia. No se ha demostrado en esta revisión un conector automático operativo independiente para Uber Eats, Rappi y DiDi. Su presencia como canal o importador no prueba sincronización directa.

No se identifica necesidad de construir un POS para cerrar estos requisitos.

## Qué debe ver cada persona

| Perfil solicitado | Cobertura actual | Cierre pendiente |
|---|---|---|
| Owner/Director | Tablero ejecutivo, ranking, P&L, brief y riesgos. | Cash respaldado por banco, costo laboral consistente, excepciones con cierre común. |
| Director de Operaciones | Workflows, inventario, producción, incidentes y cumplimiento. | Permiso/vista de operaciones separable de administración; mantenimiento recurrente y cierres verificables. |
| Supervisor | Alcance y permisos de supervisor; feed e incidentes. | Cartera común de owner/SLA y prioridades de visita demostradas. |
| Gerente | Operación de sucursal, turnos, inventario, recepción y gastos. | Entrega de turno y pendientes integrados; validación de aislamiento entre sucursales. |
| Administración/Finanzas | CFDI, CxP, gastos, corridas y reportes. | Banca, conciliación, centros de costo y controles comunes. |
| Compras | Proveedores, requisiciones/OC, recepción y claims. | Demostrar permisos propios sin otorgar capacidades administrativas innecesarias. |
| RH/Nómina | Expedientes, horarios, asistencia y corridas. | Pre-nómina real y separación de capacidades RH/finanzas. |
| Colaborador | Ejecución y captura en workflows. | La matriz general concede lecturas de usuarios/empresa/sucursal/inventario: revisar que los endpoints y la interfaz cumplan la restricción literal a sus propias tareas. |

## Correcciones a las afirmaciones del documento de entrada

| Afirmación | Resultado de la investigación |
|---|---|
| “Reconectar CxP con pagos”. | Ya hay conexión para facturas y gastos: liquidar una partida confirmada actualiza el documento a pagado. Falta respaldarla con conciliación bancaria y probarla E2E. El comentario antiguo al final de `accounts-payable-service.ts` no describe por sí solo el estado actual de tesorería. |
| “Venta→receta→consumo teórico necesita cerrarse”. | El llamado sí existe en `SalesIngestService.ingest`. Lo pendiente incluye correcciones, recuperación ante fallos, mapeo e integridad con producción; no hace falta iniciar ese enlace desde cero. |
| “Pulso genera/timbra CFDI”. | Se confirmó la llamada desde la corrida a `timbrarNomina` y persistencia de resultados. No se ejecutó un timbrado externo. |
| “Mantenimiento schedules sin writer completo”. | Consistente con lo inspeccionado: tabla localizada sin llamadores y mantenimiento individual implementado. |
| “Evidencia ligada al workflow”. | El problema es más preciso: hay evidencia en varios dominios, pero la fachada común conserva su índice en memoria. |
| “Faltan cuentas propias y conciliación banco–pago”. | Sigue siendo una brecha en el alcance inspeccionado. Pasarelas y cuentas de beneficiarios no cubren ese requisito. |

## Orden de implementación recomendado

| Orden | Entrega | Dependencias y prueba de aceptación |
|---|---|---|
| 1 | Corregir recepción: costo/unidades y política de temperatura. | Corrección acotada; pruebas de conservación de valor, lectura ausente y cuarentena. Puede hacerse sin esperar el resto. |
| 2 | Evidence persistente + excepción canónica + auditoría común. | Factura discrepante genera excepción con owner/SLA, evidencia durable, verificación y cierre auditado. Reutilizar el plan de Phase 0 revisándolo contra el código actual. |
| 3 | Endurecer aprobaciones y cerrar trazabilidad CxP→corrida→liquidación. | Aprovechar conexión existente y doble firma local; probar duplicados, cambio de cuenta, roles y trazabilidad documental. |
| 4 | Pre-nómina real y aprobación antes de timbrar. | Fuente común de conceptos, período congelado, recibo/CFDI/pago coherentes. |
| 5 | Consolidar producción y corregir venta→consumo. | Lote terminado, genealogía y movimientos; reimportación/corrección/anulación/fallo sin doble consumo. |
| 6 | Cuentas propias, movimientos y conciliación bancaria. | Relación banco–pago–factura con parciales/reversos y excepciones. |
| 7 | Mantenimiento recurrente y cierre operativo. | Recurrencia produce orden, alerta, cierre y siguiente ejecución; completar entrega de turno y canales. |
| 8 | Cierre financiero, perfiles y validación integral. | Centros de costo, reportes consistentes, prueba de los ocho perfiles y circuito completo en staging. RLS requiere preparación y prueba propia; no basta activar una bandera. |

No se estiman semanas sin revisar datos, bancos/POS objetivo y decisiones de nómina. El documento deja una hoja de ruta verificable, no una promesa de calendario.

## Verificaciones realizadas

- Inventario estructural mediante CodeGraph y revisión directa de fuentes críticas.
- Revisión del documento completo, incluyendo casos de excepción, canales y personas.
- Suite unitaria inicial: 119 archivos; 1,471 tests aprobados, uno omitido y uno pendiente según salida de Vitest. La primera invocación terminó con código de proceso 1 pese al resumen de tests aprobados; se abrió una comprobación adicional del resultado.
- Una repetición simultánea con la comprobación de tipos agotó memoria del entorno y produjo fallos de workers. No se considera fallo funcional demostrado del producto. Se detuvo el compilador iniciado por esta revisión y se repitió la suite con dos workers.
- **Resultado final confirmado:** `pnpm exec vitest run --configLoader bundle --maxWorkers=2 --reporter=json --outputFile=.tmp/auditoria-requisitos-17oct-unit.json` terminó con código 0. El JSON declara `success: true`, 1,471 aprobados, cero fallidos, uno omitido y uno pendiente. El [resultado local de pruebas](../.tmp/auditoria-requisitos-17oct-unit.json) queda disponible como evidencia técnica.
- `tsc --noEmit --incremental false`: interrumpido tras el problema de recursos; no se declara aprobado.
- No se ejecutó build de producción ni pruebas E2E en esta revisión. No se modificó código de producto.

### Pruebas necesarias antes de declarar cumplimiento integral

1. Compra→recepción→inventario→factura→aprobación→pago→movimiento bancario→conciliación.
2. Turno real con faltas/overtime/vacaciones→pre-nómina aprobada→CFDI→pago neto.
3. Producción/subreceta→lote terminado→venta→consumo→conteo→variación.
4. Los siete casos de excepción con evidencia, SLA, cierre y reapertura.
5. Ocho perfiles, dos empresas y sucursales diferentes; lectura y escritura fuera de alcance rechazadas.
6. Caídas y reintentos sin documentos, movimientos, pagos ni consumos duplicados.
7. Piloto de varias sucursales, con datos reales conciliados y responsables operativos que validen los resultados.

## Entregables y continuidad

- Este reporte: decisiones y brechas con evidencia.
- [Matriz detallada](matriz-cumplimiento-sistema-2026-10-17.csv): requisito, estado, evidencia y acción/validación pendiente.
- Plan reutilizable existente: [Phase 0 — Control Core](../tasks/plan-closeout-pulso-1.0-phase-0.md). Es un plan; sus casillas no demuestran implementación.

El siguiente trabajo de implementación debe partir de estos hallazgos y criterios de aceptación. No se han aplicado cambios funcionales durante la investigación.
