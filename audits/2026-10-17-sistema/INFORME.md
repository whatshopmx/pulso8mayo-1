# Investigación del sistema implementado — 17 de octubre de 2026

**Dictamen: Pulso tiene una implementación amplia, pero no cumple todavía el mapa completo como sistema integrado y confiable.** Hay procesos conectados y registros en la base, junto con funciones sin ejecución observada, una tabla pendiente de instalar, controles de acceso desiguales y errores de cálculo que afectan inventario y nómina.

El archivo `sistemainvestigacion17oct.md` se usó exclusivamente como lista de requisitos. Sus afirmaciones sobre lo que ya estaba terminado no se tomaron como hechos. No se utilizaron otros documentos Markdown del proyecto como evidencia funcional; tampoco se tomaron comentarios de código como prueba de que una función opera. Las conclusiones se apoyan en instrucciones ejecutables, rutas, servicios, esquema, pruebas ejecutadas y consultas de sólo lectura.

## Alcance y significado de los estados

- Se revisó el directorio de trabajo, incluidos cambios locales, sobre HEAD `14c104ed03ef32e09b557d71bf1404df18d44bb9`. No se auditó solamente la versión del commit.
- La base es la configurada en los archivos de entorno locales. **No se comprobó que sea la base del despliegue de producción.** Las conclusiones de datos y configuración se limitan a este entorno.
- La consulta del catálogo y los conteos se ejecutó dentro de `BEGIN READ ONLY`; finalizó con `ROLLBACK`. No se crearon datos ni se aplicaron migraciones. No se timbró nómina, enviaron pagos ni mensajes externos.
- Un registro existente puede venir de seeds, pruebas o uso real. Los conteos acreditan persistencia, no procedencia productiva ni corrección del dato.
- **CÓDIGO:** se localizó implementación o conexión de servicio/ruta. No significa aceptación E2E aprobada.
- **PARCIAL:** existe implementación, pero tiene un límite, defecto, dependencia o falta de ejecución observada que impide dar por satisfecho el alcance.
- **PLANTILLA:** se localizó la definición JSON ejecutable en el motor común; no se comprobó cada rutina en ejecución.
- **BLOQUEADO_BD:** hay código que requiere una tabla ausente en la base observada.
- **NO_LOCALIZADO:** no se localizó la implementación específica en el alcance revisado. No es una demostración matemática de inexistencia.

La matriz completa está en [requisitos.csv](requisitos.csv): 205 requisitos con viñeta del archivo fuente y 12 filas transversales de ventas/canales/perfiles. [requisitos-fuente.txt](requisitos-fuente.txt) conserva la versión utilizada. Las fuentes de cada fila son referencias de área; los defectos concretos y sus ubicaciones se detallan abajo. No se asigna un porcentaje global de cumplimiento: sumar una pantalla y una conciliación bancaria como unidades equivalentes produciría una cifra engañosa.

## Verificación realizada

| Verificación | Resultado |
|---|---|
| Catálogo de tablas de la base configurada | 173 tablas públicas |
| Tablas exportadas por el esquema Drizzle del código | 174 tablas distintas |
| Tabla del código ausente en la base | `exceptions` |
| Columnas del código ausentes en tablas existentes | Ninguna detectada por comparación de nombres |
| RLS habilitado / políticas públicas | 0 tablas / 0 políticas |
| Suite `pnpm run test:unit` | 128 archivos aprobados, 1 fallido; 1,627 pruebas aprobadas, 1 fallida, 1 omitida y 1 pendiente (`todo`) |
| Duración de la suite | 115.30 segundos |
| TypeScript `pnpm exec tsc --noEmit --incremental false` | Aprobado, código de salida 0 |
| Compilación `pnpm run build` | Inconclusa: se interrumpió tras permanecer en `Creating an optimized production build ...`; no se obtuvo resultado del compilador |
| Interfaz/API autenticada en navegador | No verificada: no había servidor escuchando en `localhost:3000` al comprobarlo |

La comparación de esquema cubrió nombres de tablas y columnas; no certifica igualdad de tipos, índices, restricciones, enums, permisos o migraciones completas. El test fallido fue `tests/unit/seed-integration.test.ts`: `seed-13-receiving-matching` intenta insertar una línea de factura sin `clave_prod_serv`, columna obligatoria. Es un fallo de la carga de datos, no una prueba de que todos los caminos de recepción fallen.

El repositorio recibió cambios locales durante la investigación. El resultado de pruebas corresponde a la ejecución iniciada a las 17:46:45 UTC; no se presenta como garantía de cualquier edición posterior. [verificacion.json](verificacion.json) conserva la referencia de la ejecución y hashes de archivos de evidencia. [evidencia-base.json](evidencia-base.json) conserva el catálogo resumido y los conteos sin datos personales.

## Hallazgos que impiden considerar cerrado el sistema

### H01 — Alto: recepción suma dos veces la cantidad recibida

`processReceiving` crea el lote con `initialQuantity = quantity` y `currentQuantity = quantity`; después llama a `InventoryService.recordMovement` con `type: 'RECEIVING'` y `quantityChange: quantity`. El movimiento ejecuta `currentQuantity + quantityChange` sobre ese mismo lote.

**Ejemplo deducido del código:** recibir 10 unidades crea un saldo de 10 y lo incrementa a 20. El flujo no necesita un segundo usuario ni una petición duplicada para producir la diferencia. El servicio se usa tanto desde la API de recepción como desde el extractor de workflows. No se insertó una recepción en la base durante esta auditoría.

Evidencia: [receiving-service.ts:254](../../lib/services/receiving-service.ts#L254), [movimiento de recepción:274](../../lib/services/receiving-service.ts#L274) y [suma al lote en inventory-service.ts:241](../../lib/services/inventory-service.ts#L241); `app/api/inventory/receiving/route.ts:16`; `lib/services/receiving-from-workflow.ts:10`.

**Cierre necesario:** una sola operación debe ser dueña del incremento del saldo, dentro de una transacción que mantenga lote, movimiento y recepción consistentes. Probar expresamente que recibir 10 deja 10 y que un reintento no vuelve a recibirlas.

### H02 — Alto: nómina no incorpora la asistencia real de forma completa

`calculateEmployeePayroll` calcula sueldo base como salario contractual por días calendario del período. Añade propinas y festivos trabajados, pero devuelve `overtimePayCents: 0` y `totalDeduccionesCents: 0`. La validación previa consulta sesiones y vacaciones, pero esa validación no sustituye el cálculo de faltas, permisos y horas extra.

La exportación tiene otro cálculo: `workDays = 15`, divide el salario base entre 30 y estima IMSS/ISR con porcentajes fijos. `startDate` y `endDate` se validan y se usan en el nombre del archivo, pero no delimitan un cálculo de asistencia. Además, el servicio de nómina trata la base contractual como diaria, mientras la exportación la trata como mensual. Los dos resultados no tienen un contrato salarial uniforme.

Evidencia: [payroll-service.ts:330](../../lib/services/payroll-service.ts#L330), [exportación con 15 días fijos:64](../../app/api/payroll/export/route.ts#L64); `app/api/payroll/run/route.ts:32`. La base tiene 104 sesiones de turno, pero **0 corridas de nómina y 0 payslips**. Hay 1 registro en `cfdi_nomina_timbrados`, insuficiente para acreditar una corrida completa calculada correctamente.

**Cierre necesario:** un único cálculo de pre-nómina basado en asistencia/incidencias aprobadas, consumido por corrida, exportación, costo laboral y dispersión. Verificar un período con falta, horas extra, vacaciones y festivo antes de declarar el módulo listo.

### H03 — Alto: la excepción canónica existe en código, pero no está instalada en la base

Existe `ExceptionService`, máquina de estados, asignación, SLA, resolución, verificación por una persona distinta del resolvedor, cierre, reapertura y cancelación. También hay rutas de lifecycle y nueve adaptadores desde dominios operativos y financieros.

Sin embargo, el catálogo consultado no contiene `exceptions`. En el entorno local tampoco está definido `EXCEPTIONS_CANONICAL_READ`; el código sólo usa el feed canónico si su valor es exactamente `"true"`. Por tanto, el feed actual sigue el agregador legacy. Activar el flag sin instalar la tabla provocaría consultas a una relación ausente.

Evidencia: `lib/db/schema/exceptions.ts`; `lib/services/exception-lifecycle.ts`; `lib/services/exception-service.ts`; `lib/services/group-exceptions-service.ts:117`; `lib/services/exception-adapters/index.ts`; `lib/inngest/functions/exceptions-sync.ts`; catálogo de [evidencia-base.json](evidencia-base.json).

**Cierre necesario:** instalar el esquema mediante migración revisada, ejecutar sincronización verificable, comprobar volumen/alcance y después activar la lectura canónica. No se aplicó esa migración como parte de esta investigación.

### H04 — Alto: aislamiento y autorización no son uniformes en todas las rutas

Se localizaron controles sólidos en ABAC, alcance de sucursal y servicios nuevos, pero también rutas que los evitan:

1. `POST /api/equipment/maintenance` acepta `equipmentId`, inserta el mantenimiento y actualiza `branchEquipments` filtrando sólo por ID. No consulta antes que ese equipo pertenezca a la empresa/sucursal del actor ni exige permiso de mantenimiento. Además marca `lastMaintenanceDate = now()` al crear un registro todavía `SCHEDULED`.
2. `GET /api/workflows/evidence` comprueba sesión y empresa, pero no limita un empleado a sus instancias/asignaciones ni fuerza su sucursal. El filtro de sucursal proviene del query y es opcional. La consulta puede devolver evidencia de otros colaboradores de la misma empresa.
3. `POST /api/inventory/sales-entry` comprueba sesión, acepta `branchId` y `recipeId`, inserta la venta y consume insumos sin un guard de permiso ni una comprobación de pertenencia de esos IDs en esa ruta. El servicio de consumo busca recetas por ID.

Evidencia: `app/api/equipment/maintenance/route.ts:54`; `app/api/workflows/evidence/route.ts:11`; `app/api/inventory/sales-entry/route.ts:21`; `lib/services/theoretical-consumption-service.ts:23`.

Son hallazgos de lectura del servidor; no se explotaron contra otros usuarios ni se alteró información. La ausencia de RLS en las 173 tablas aumenta la importancia de que cada punto de entrada imponga el alcance. No demuestra por sí sola que todas las consultas expongan información.

Se revisó también `proxy.ts`: para las rutas API aplica verificación de sesión para identificar el rate limit y luego permite continuar. La autorización RBAC por ruta se aplica al dashboard, no sustituye los guards que faltan en estos handlers API. `getSession` en `lib/auth.ts` devuelve la sesión; no añade por sí mismo validación de pertenencia de equipo/receta/sucursal.

### H05 — Alto: tesorería no tiene conciliación bancaria completa

Hay cuentas de proveedores y contrapartes, corridas, autorización, congelamiento de cuenta destino, layout y liquidación por partida. `settlePaymentRunItem` exige referencia o motivo de fallo y actualiza la factura/gasto asociado dentro de una transacción cuando se confirma.

Pero `payment_runs.sourceAccount` es texto libre, no una cuenta bancaria propia con ledger. No se localizaron entidad/rutas de cuentas bancarias propias, movimientos de banco y vínculo conciliado banco↔pago. La liquidación observada es una confirmación humana por referencia. El importador de conciliación existente carga transacciones de pasarela/adquirente; no cierra esta relación de egresos.

Evidencia: `lib/db/schema/treasury.ts:63`; `lib/services/treasury-service.ts:1228`; `app/api/finance/reconciliation/upload/route.ts:26`; `lib/services/gateway-report-service.ts:53`; inventario de rutas y esquema.

**Cierre necesario:** cuentas propias, importación/registro de movimientos, matching con partidas, diferencias y reversas; comprobar que una transferencia rechazada conserva la deuda y que un pago confirmado sólo se concilia contra evidencia bancaria identificable.

### H06 — Medio/alto: corregir una venta importada no corrige su consumo

`SalesIngestService.ingest` hace upsert por empresa/sucursal/fecha/receta y actualiza cantidad e ingreso cuando ya existía la fila. Sólo llama a `TheoreticalConsumptionService.consume` cuando `xmax = 0`, es decir, cuando la venta es nueva.

**Ejemplo deducido del código:** importar primero 10 porciones y corregir el mismo registro a 12 deja ventas por 12, pero consumo por 10. Además, la escritura de venta y el consumo no comparten una única transacción; si el consumo falla tras insertar, el siguiente upsert entra por el camino que omite consumo.

Evidencia: `lib/services/sales-ingest-service.ts:139`, cláusula de conflicto y condición `written?.isNew`. Por ello sí hay venta→receta→consumo implementado, pero no puede darse por cerrado E2E.

### H07 — Medio: producción no crea inventario de producto terminado

El flujo utilizado registra órdenes/resultados/ingredientes, consume lotes de insumos y contempla hold time/merma. `recordProduction` no inserta un lote de salida del producto terminado. El modelo alternativo `production_plans`, `production_plan_items`, `production_batches` tiene tablas y aparece en seeds, pero no se localizó como modelo operativo principal; las tres tablas están vacías.

Evidencia: `lib/services/production-service.ts:59`, final del método; `lib/services/recipe-production.ts`; `lib/services/prep-list-service.ts:300`; `lib/services/hold-time-service.ts`; `lib/db/schema/production.ts`.

La trazabilidad está mejor resuelta para insumos que para el producto resultante. Falta consolidar el modelo y cerrar saldo, lote y destino de lo producido.

### H08 — Medio: EvidenceStore no es una primitive transversal persistente

El servicio genérico almacena su registro en `Map<string, EvidenceRecord>`. Aunque puede subir el binario a R2, el índice genérico vive en memoria del proceso y sus consultas no reciben `companyId` para filtrar. No se localizó una tabla canónica `evidence` en el esquema exportado/base.

Eso no significa que todas las fotos se pierdan: workflows, gastos, órdenes de servicio y otros dominios conservan referencias propias. Significa que la primitive común solicitada todavía no es una entidad durable y uniformemente aislada.

Evidencia: `lib/services/evidence-store.ts:78`; `app/api/workflows/evidence/route.ts`; `app/api/expenses/evidence/route.ts`; `app/api/service-orders/[id]/evidence/route.ts`.

### H09 — Medio: automatizaciones y cierres sin ejecución persistida observable

En la base consultada están vacías `workflow_completion_outbox`, `morning_briefs`, `corporate_twins`, `operational_twins`, `financial_periods`, `pnl_snapshots` e `inventory_snapshots`. En el entorno local no están definidas las claves de eventos/firma de Inngest ni `INNGEST_DEV`.

Los handlers sí están exportados y registrados en `app/api/inngest/route.ts`. **No se puede concluir que el despliegue remoto esté mal configurado**, porque sus variables y ejecuciones no se consultaron. Lo comprobado es que este entorno no aporta evidencia suficiente de ejecución continua y cierres completos.

### H10 — Medio: auditoría distribuida y no garantizada para toda mutación

Existen `employee_audit_logs`, `inventory_audit_log`, `data_access_logs`, `config_change_logs` y eventos de dominio. La base tiene respectivamente 5, 80, 1,465, 0 y 8 registros en esas familias relevantes. No hay un rastro único que cubra todas las mutaciones de los 17 módulos.

`AuditService.logEmployeeAction` y `logInventoryAction` capturan errores de inserción y devuelven `null`; sus callers pueden continuar sin la bitácora. Esto impide considerar garantizado el requisito universal «quién cambió qué, cuándo y por qué» sólo por tener AuditService.

Evidencia: `lib/services/audit-service.ts:40` y `:89`; `lib/security/audit.ts`; `lib/services/domain-event-service.ts`.

## Resultado por los 17 módulos

| # | Módulo | Implementación localizada | Límite que impide considerarlo cerrado |
|---|---|---|---|
| 1 | Organización y configuración | Empresas, sucursales, usuarios, permisos, tenant y operating config | Auditoría y seguridad desiguales; sin RLS; no se verificó grupo de 8/15 |
| 2 | Centro de control | Dashboard, comparación, pulso, KPIs, twin y brief | Twin/brief sin filas; excepción canónica sin instalar; cash es proyección |
| 3 | Workflows | Builder, templates, asignaciones, horarios, pasos y extractores | Entrega durable no observada en base; recepción tiene defecto de saldo |
| 4 | Evidencia | Fotos/documentos/datos, IA, revisión e historial por dominio | Primitive común en memoria y alcance insuficiente en consulta de evidencia |
| 5 | Excepciones/incidentes | Incidentes/remediation; lifecycle canónico y adaptadores | Tabla canónica ausente; cobertura y SLA universal incompletos |
| 6 | Operación diaria | Apertura, cierre, cambio de turno, limpieza y producción | Parte es template; sin control online/offline de delivery acreditado |
| 7 | Food safety/calidad | Temperaturas, cuarentena, FEFO, sanitización, plagas y auditorías | Sin control específico de aceite localizado ni cadena de frío continua verificada |
| 8 | Equipos/mantenimiento | Catálogo, equipos, garantías, registros, costos, alertas y OS | Recurrencias no cerradas; downtime no acreditado; ruta con aislamiento insuficiente |
| 9 | Workforce | Expedientes, contratos, turnos, checadas, descansos, permisos, propinas y performance | Incidencias no conectadas completamente al cálculo de nómina |
| 10 | Nómina | Validación, cálculo parcial, corrida, payslips y cliente fiscal | Cálculo/exportación incompletos; sin corridas ni payslips observados |
| 11 | Recetas/food cost | BOM, subrecetas, rendimiento, versiones, simulación, consumo y reportes | Corrección de ventas no ajusta consumo; sin conteos físicos/versiones persistidas |
| 12 | Producción | Prep list, órdenes, resultados, ingredientes, FEFO, hold time y merma | Sin lote de salida; segundo modelo sin uso operativo acreditado |
| 13 | Inventarios | Lotes, movimientos, conteo, merma, transferencias, PAR y costeo | Saldo de recepción incorrecto; sin conteos/snapshots observados |
| 14 | Compras/proveedores | Requisición, OC, aprobación, delegación, sugerencias, precios, scorecard y claims | Varias tablas sin uso observado; no basta para probar flujo completo |
| 15 | Recepción | PO→recepción→lote→factura, temperatura, evidencia y discrepancias | Suma doble y escrituras no agrupadas en una transacción del proceso completo |
| 16 | Administración/CxP | CFDI, match 2/3-way, aging, gastos, caja chica, centros de costo y presupuesto | Aprobaciones separadas; fiscal productivo no validado; exceptions ausente |
| 17 | Finanzas/tesorería | Corridas, layouts, liquidación, contratos, presupuestos, P&L y cash-flow | Falta banco propio/ledger/conciliación y completar costo laboral |

### 1. Organización y configuración

`CompanyService`, `BranchService`, usuarios, `lib/permissions.ts`, ABAC y `tenantOperatingConfig` son implementaciones concretas. La base tiene 9 empresas, 11 sucursales y 15 usuarios; el máximo observado es 3 sucursales en una empresa. Eso no acredita operación con 8 o 15 sucursales ni una prueba de carga.

Los roles de negocio son `SUPER_ADMIN`, `OWNER`, `ADMIN`, `GERENTE`, `SUPERVISOR`, `EMPLEADO`, `READONLY`. No hay roles independientes de Finanzas, Compras y RH en ese enum. `DIRECTOR_OPS` aparece como autoridad de aprobación, no como rol asignable de usuario. El catálogo de acceso a rutas usa un conjunto distinto que omite `OWNER`; debe comprobarse su recorrido real antes de prometer cada vista por persona.

Fuentes: `lib/services/company-service.ts`, `lib/services/branch-service.ts`, `lib/tenant-context.ts`, `lib/permissions.ts`, `lib/rbac/permissions.ts`, `lib/rbac/abac.ts`.

### 2. Centro de control

Se localizaron APIs `group/live-pulse`, `group/branches-qsr`, `group/exceptions`, executive/twin y brief. `LiveCommandService` agrega personal, temperatura, ventas e incidentes; `CrossBranchService` compara sucursales; el P&L llama a servicios de food cost, labor cost y comisiones.

Twin y brief tienen código de cálculo y persistencia, pero sus tablas están vacías. Un score calculable no es un score operativo ya actualizado. «Open Actions» se reparte entre dominios; no hay un lifecycle activo común que resuelva todas las clases del mapa.

### 3. Workflows

Se observan 43 templates, 567 instancias, 4,322 pasos, 53 asignaciones y 26 schedules. El cierre del workflow escribe un outbox y los consumidores Inngest ejecutan cuatro extractores: receiving, stock-count, merma y production. Hay reintentos, generación de recuperación, locks y pruebas de idempotencia/contratos de pasos.

Esto es más que un constructor visual. Sin embargo, `workflow_completion_outbox` tiene 0 filas en esta base: no se acreditó una finalización nueva recorriendo esa entrega hasta efecto de negocio. La integración usa el servicio de recepción afectado por H01.

Fuentes: `lib/services/workflow-execution-service.ts:899`, `:927`, `lib/services/workflow-completion-delivery.ts`, `lib/inngest/functions/workflow-extractors.ts:37` y pruebas bajo `tests/unit/workflows`.

### 4. Evidencia y verificación

Hay carga/consulta de evidencia, URLs con alcance de almacenamiento, pasos de foto/texto/checklist, OCR y verificación IA con política de veredicto determinista. Los resultados de IA se guardan en pasos. Existen pantallas/rutas de revisión y adjuntos de gastos y órdenes de servicio.

La evidencia es real por dominio, pero el registro genérico no es durable (H08) y la consulta de workflows incumple la restricción estricta de «sólo mis tareas/evidencias» (H04). No se hicieron llamadas nuevas a proveedores de IA o R2 para comprobar sus credenciales.

### 5. Excepciones, incidentes y acciones correctivas

Hay 9 incidentes y 3 acciones de remediation. El modelo canónico implementa `OPEN → ASSIGNED → IN_ACTION → RESOLVED → VERIFIED → CLOSED`, con ramas de reapertura/escalamiento/cancelación. Impide que la misma persona resuelva y verifique. Los SLA por severidad están codificados.

Los nueve adaptadores incluyen incidentes, alertas de inventario, compliance, equipos, NOM-035, aprobaciones/cambios de turno, diferencias de caja y discrepancias de facturas. Esto no equivale todavía a cubrir cada caso pedido: no se acreditó adaptador específico de cualquier merma alta, gasto fuera de presupuesto, falta de empleado o pago sin conciliar. El cron sincroniza adaptadores; no demuestra un escalador universal automático por SLA vencido. El bloqueo actual más inmediato sigue siendo la tabla ausente.

### 6. Operación diaria de sucursal

Los JSON de `templates/operaciones_diarias` definen apertura, cierre, cambio de turno, limpieza/sanitización, mantenimiento y producción. La ejecución, evidencia, asignación y calendario provienen del motor común. Eso permite rutinas configurables; no acredita automáticamente todos los procedimientos de cocina, salón/counter y checklist gerente de un grupo concreto.

Inventario y producción aportan señales de disponibilidad. No se localizó una función que publique disponibilidad online/offline de la tienda o platillos a Uber Eats, Rappi o DiDi. Capturar un canal de ventas es una capacidad diferente de operar su disponibilidad.

### 7. Food safety, calidad y cumplimiento

Hay 28 registros térmicos, 5 alertas de compliance, políticas de temperatura de recepción, cuarentena, FEFO y templates de higiene, alimentos, fumigación y auditoría. La recepción conecta una lectura fuera de rango con incidente/reclamo. Los reportes NOM y componentes de compliance están implementados.

FEFO ordena lotes disponibles por caducidad y antigüedad con `FOR UPDATE`. No se acreditaron sensores ni monitoreo continuo de toda la cadena de frío, ni un módulo específico de control de aceite. Los templates y reportes no constituyen por sí solos certificación legal de NOM ni cumplimiento efectivo en todas las unidades.

Fuentes: `lib/services/fefo-allocator.ts:43`, `lib/services/receiving-temperature.ts`, `lib/services/receiving-service.ts`, templates JSON de `control_calidad` y `compliance`.

### 8. Equipos y mantenimiento

Persisten 22 equipos, 9 mantenimientos, 6 schedules, 4 garantías, 3 proveedores de servicio y 6 órdenes de servicio. Hay creación/cierre de mantenimiento, costos de partes/mano de obra, fotos, garantías, consulta de próximos/vencidos y servicios externos.

La tabla de schedules existe y tiene datos; eso corrige una posible lectura de «no existe mantenimiento». Pero no se localizó el circuito productivo completo de edición y generación recurrente desde esa tabla. No se acreditó downtime por intervalos, análisis de fallas ni decisión reparar/reemplazar. El alta general tiene además los defectos de alcance y fecha de último mantenimiento de H04.

Fuentes: `lib/services/equipment-service.ts:510`, `:570`, `:647`, `lib/db/schema/equipment.ts:290`, `app/api/equipment/maintenance/route.ts`, `lib/services/service-order-service.ts`.

### 9. People / Workforce

Persisten 7 expedientes y contratos, 104 turnos planeados, 104 sesiones de turno, 104 logs de descansos, solicitudes de permisos/vacaciones, propinas y evaluaciones de desempeño. Existen APIs de onboarding, contratos, documentos, training, checadas, horas extra, cambios y aprobaciones de turnos.

El cálculo de sesión contempla tiempos, descansos, overtime y geolocalización. La brecha principal está después: esos resultados no se incorporan completamente a la nómina. El training también tiene tablas paralelas (`employee_training` con 7 filas y `employee_training_records` vacía), por lo que no se da por certificado un recorrido único de formación/certificación.

Fuentes: `lib/services/employee-service.ts`, `lib/services/shift-service.ts`, `lib/services/break-management-service.ts`, rutas `employees`, `leave`, `overtime`, `performance` y `vacations`.

### 10. Nómina

Hay código para validar datos, calcular percepciones, crear corrida/payslips y llamar a FiscalAPI; no es un módulo inexistente. `fiscal-service.ts` contempla host de pruebas/producción y persiste resultados de timbrado. No se ejecutó una operación fiscal durante esta revisión.

La capacidad técnica de timbrar no resuelve el cálculo incompleto de H02. Tampoco se localizó un estado persistido de aprobación de pre-nómina por gerente antes de la corrida. El costo laboral tiene su propio servicio de cálculo: no debe confundirse con una nómina ya calculada y pagada. La dispersión bancaria de nómina tiene una política específica y no se debe anunciar como equivalente al layout de proveedores sin verificar esa política.

### 11. Catálogo, recetas y food cost

Hay 32 insumos, 8 conversiones de unidades, 7 recetas, 30 líneas de receta y 465 entradas de ventas por receta. `RecipeService` calcula subrecetas, detecta ciclos, simula cambios de precio y crea snapshots de versiones. `recipe_versions` está vacía, aunque hay pruebas unitarias de versionado.

Sí existe venta→receta→descuento FEFO. Hay dos vías distintas: ingesta de cortes POS agregados y entrada/importación de ventas por receta. Importar un corte no significa necesariamente que se cargó el mix por platillo. La corrección de ventas tiene el defecto H06.

La varianza de `ReportsService` sí calcula consumo teórico frente a consumo físico; no es correcto afirmar que toda varianza esté fija en cero. Cuando faltan conteos inicial/final informa `MISSING_DATA`. La base tiene 0 `stock_counts`. `FoodCostService` valoriza con costos actuales del catálogo y usa alternativas declaradas según datos; `pnl_snapshots` puede congelar cierres, pero está vacío.

Fuentes: `lib/services/recipe-service.ts:57`, `:159`, `:375`, `lib/services/sales-ingest-service.ts:139`, `lib/services/reports-service.ts:31`, `lib/services/food-cost-service.ts:110`.

### 12. Producción de alimentos

Hay prep list, órdenes, cierre transaccional por línea, producción desde workflow, resultados, ingredientes consumidos, faltantes, costos y hold time. La base tiene 10 órdenes, 13 resultados y 37 líneas de ingredientes.

Los lotes FEFO de insumos quedan relacionados a ingredientes de producción. El registro de faltantes y merma existe; no crea producto terminado en inventario. Los planes/batches alternativos están vacíos. La consolidación requerida no debe borrar el flujo que sí se usa ni tratar tablas de seed como un segundo proceso completo.

### 13. Inventarios

Hay 70 lotes, 103 movimientos, 54 mermas, 2 transferencias, ubicaciones, precios, alertas y reportes. Están implementados FEFO, expiraciones, PAR/min-max, alto valor, stock count y ajustes. `InventoryService.recordMovement` agrupa movimiento y actualización del lote en una transacción cuando no recibe una ya abierta.

No hay conteos físicos ni snapshots en sus tablas. Por tanto, inventario físico inicial/final y varianza no tienen la misma evidencia de uso que merma/movimientos. El doble incremento de recepción compromete saldos y cualquier cálculo que dependa de ellos, aunque el módulo tenga muchos servicios y tests.

Fuentes: `lib/services/inventory-service.ts:207`, `lib/services/stock-count-service.ts`, `lib/services/inventory-snapshot-service.ts`, `lib/services/inventory-reports-service.ts`, rutas de transfers, waste, high-value y stock-count.

### 14. Compras y proveedores

Hay supplier master, artículos por proveedor, términos de pago, cuentas bancarias, historial de precio, requisiciones, OC, matriz de aprobación, delegación, sugerencias, scorecard y claims. La base tiene 10 proveedores, 7 OC, 16 líneas de OC, 9 cuentas proveedor y 40 registros de precio.

Las requisiciones, reglas de delegación y reclamos tienen 0 filas. Sus rutas y servicios existen; la falta de filas no permite declararlos inexistentes, pero tampoco operados E2E. La existencia de 9 cuentas no prueba que todas hayan pasado verificación.

Fuentes: `lib/services/purchase-order-service.ts:125`, `:200`, `:620`, `lib/services/supplier-scorecard-service.ts:47`, `lib/services/suggested-order-service.ts`, `lib/services/supplier-bank-account-service.ts`, `app/api/purchase-delegation/route.ts`.

### 15. Recepción de mercancía

El servicio enlaza OC, cantidades, precio, lote, caducidad, evidencia, lectura térmica, discrepancia, actualización de OC y factura/matching. Hay 3 reportes y 6 líneas de recepción en la base. La cuarentena y el reclamo por temperatura están codificados.

Además de H01, el proceso completo no está agrupado en una única transacción: crea el reporte y va escribiendo lotes/movimientos/líneas; algunas validaciones de factura suceden después de insertar el reporte. Un error intermedio puede dejar una recepción parcial. Las transacciones individuales de `recordMovement` no vuelven atómica toda la recepción.

La conclusión es «proceso conectado con defectos de integridad», no «recepción completa y confiable».

### 16. Administración y cuentas por pagar

Hay 5 facturas, 3 líneas, 4 CFDI recibidos, 4 gastos, 5 centros de costo, 35 presupuestos y 1 fondo de caja chica. Existen parser XML, asociación a recepción, match 2/3-way, diferencias de cantidad/precio, autorización de discrepancia, aging y fechas de vencimiento.

Los centros de costo **sí están conectados** a gastos/presupuesto/OC/OS. También hay conexión CxP→tesorería para facturas/gastos y espejo de liquidación al documento. Las aprobaciones, sin embargo, están repartidas entre matriz OC/OS, gastos, discrepancia y corrida; no forman una sola primitive universal. El camino fiscal contempla sandbox; no se probó buzón SAT productivo.

Fuentes: `lib/services/invoice-matching-service.ts:400` y `:518`, `lib/services/accounts-payable-service.ts:59`, `lib/services/expense-service.ts:208`, `lib/services/budget-service.ts`, `lib/services/cost-center-service.ts`, `lib/services/fiscal-buzon-service.ts`.

### 17. Finanzas, tesorería y control económico

Persisten 11 corridas, 7 partidas, 13 payees, 2 contratos recurrentes y 35 presupuestos. Hay autorización, cuentas destino verificadas, layouts, liquidación por partida y documentos origen. `payment_approvals`, `payee_bank_accounts`, `financial_periods` y `pnl_snapshots` están vacías.

`PnLService` combina ventas, gasto operativo, food cost, costo laboral, merma, caja chica y comisiones. Declara procedencia/cobertura y usa fallbacks cuando faltan datos. Esto es más riguroso que una pantalla con porcentajes fijos, pero no reemplaza un cierre conciliado. Cash-flow proyecta ventas y obligaciones desde un saldo inicial capturado; no deriva el saldo de un banco reconciliado.

El cierre pendiente principal es H05 y la calidad de los datos que alimentan costo/margen, especialmente inventario y nómina. No se localizó una solicitud canónica independiente de pago que cubra de forma uniforme todos los dominios.

## Ventas, canales y vistas por persona

Hay parser CSV/XLSX, mapeo POS, cortes, datos por canal, terminales, TPV batches, tarifas/comisiones e importación de reportes de pasarela. La base contiene 93 cortes, 186 batches TPV, 6 terminales y 2 tarifas de canal. `gateway_transactions` y `aggregator_settlements` tienen 0 filas.

Los nombres Uber Eats/Rappi/DiDi y sus tarifas/modelos acreditan clasificación de canales. **No acreditan conectores API activos a cada plataforma ni depósitos conciliados en cuentas propias.** El ticket/mix procede de lo que realmente exporte y se importe del POS; no se construyó ni se exige un POS propio.

Los perfiles solicitados se atienden mediante roles técnicos y módulos, con límites:

- Owner/director: módulos ejecutivos y financieros disponibles, sin twin/brief persistido ni cash bancario conciliado en esta base.
- Dirección de operaciones: capacidades operativas distribuidas; no hay rol de usuario `DIRECTOR_OPS` independiente.
- Supervisor: el alcance usual lo fija a una sucursal; no se acreditó cartera de visitas y SLA para varias unidades.
- Gerente: muchas superficies operativas disponibles, con los defectos de integridad y alcance señalados.
- Finanzas, compras y RH: módulos presentes, pero sin tres roles departamentales independientes que reproduzcan automáticamente la separación solicitada.
- Colaborador: ejecución y tareas propias existen, pero la API de evidencias y rutas legacy no aseguran todavía la restricción estricta a sus propias tareas/evidencias.

## Orden de cierre recomendado a partir de los hallazgos

1. Corregir el doble incremento de recepción y verificar la consistencia histórica de lotes afectados antes de confiar en sus saldos.
2. Cerrar los puntos de entrada con autorización/alcance insuficiente; aplicar la misma regla a todas las rutas del dominio, incluidas las legacy.
3. Instalar y validar `exceptions`, su sincronización y su lectura canónica; completar cobertura y escalamiento por SLA.
4. Unificar cálculo salarial y exportación con asistencia real/incidencias; comprobar aprobación, timbrado y pago como etapas distintas.
5. Incorporar cuentas propias, ledger y conciliación banco↔pago/depósito.
6. Corregir actualización/reintento de ventas y completar producto terminado, conteos físicos y cierres congelados de costos.
7. Completar persistencia transversal de evidencia/auditoría y verificar automatizaciones en el entorno desplegado.

Esto es una investigación, no una implementación de correcciones. No se cambiaron archivos de la aplicación ni datos de negocio para resolver los hallazgos.
