# Auditoría de conexión entre frontend y backend

Fecha: 10 de octubre de 2026. Proyecto: Pulso HORECA.

## Diagnóstico

La sensación de desconexión tiene fundamento. El proyecto tiene una base funcional, pero conviven flujos completos, pantallas de demostración conectadas a escrituras reales, configuraciones sin consumidores y varias implementaciones de reglas similares. El problema principal es la falta de un contrato uniforme por flujo: permisos, datos, políticas, validación, efectos y respuesta visible.

No conviene empezar borrando servicios ni reescribiendo todo. Primero hay que cerrar aislamiento y autorización; después terminar los recorridos activos; finalmente consolidar y retirar lo que se confirme sin uso.

## Alcance y límites

Revisión estática de 1,350 archivos de código en app, lib, components y hooks, incluyendo 357 rutas API y 159 páginas del dashboard. Se rastrearon importaciones, llamadas del frontend, persistencia, consumidores de configuración y funciones Inngest.

El índice CodeGraph local existe, pero su última indexación registrada es del 18 de septiembre de 2026. Se usó para exploración estructural y se complementó con el código actual para cambios posteriores. Los resultados de ausencia de consumidores se limitan al repositorio: no descartan integraciones externas.

No se ejecutaron operaciones sobre la base de datos ni envíos de mensajes. El intento de ejecutar la suite de pruebas no pudo iniciar por un error del lanzador de procesos del entorno. Este documento no acredita pruebas funcionales, explotación en producción ni el estado de políticas RLS de la base remota. No se modificó código de aplicación.

## H01 — P0: acciones de turnos sin sesión, permisos ni aislamiento de empresa

La pantalla activa de turnos usa acciones de servidor que llaman directamente al servicio para listar, crear, editar, borrar y publicar. No obtienen sesión ni comprueban roles. El servicio admite filtros vacíos para listar y recibe companyId desde el cliente para crear.

- [Acciones de servidor](../../app/actions/shifts.ts:27).
- [Consulta sin filtro obligatorio de empresa](../../lib/services/shift-service-extended.ts:47).
- [Creación que recibe datos del cliente](../../lib/services/shift-service-extended.ts:120).
- [Pantalla que expone el recorrido](../../app/dashboard/labor/shifts/page.tsx:18).

Un guard de roles en React no sustituye autorización en el servidor. El contexto de empresa debe provenir de la sesión; cada empleado, sucursal y turno debe verificarse contra ese contexto. Debe aplicarse también a edición, eliminación, publicación y operaciones masivas.

## H02 — P0: rutas paralelas de workflows con controles diferentes

Hay dos rutas para modificar plantillas. Una exige permiso y filtra por empresa; la otra consulta, actualiza y elimina por id tras comprobar únicamente sesión. El administrador de plantillas usa la segunda para borrar.

- [Ruta con permiso y empresa](../../app/api/templates/[id]/route.ts:31).
- [Ruta paralela por id](../../app/api/workflows/templates/[id]/route.ts:23).
- [Borrado desde el frontend](../../app/dashboard/builder/templates/template-manager.tsx:152).

La ejecución y lectura de workflows presenta el mismo patrón: sesión autenticada, pero consultas por id sin comprobar de forma uniforme empresa, sucursal, asignación o permiso. La actualización de pasos permite llegar al servicio sin ese alcance.

- [Inicio de ejecución](../../app/api/workflows/execute/route.ts:28).
- [Lectura de ejecución](../../app/api/workflows/executions/[id]/route.ts:26).
- [Actualización de paso](../../app/api/workflows/executions/[id]/steps/[stepId]/route.ts:22).
- [Carga de plantilla por id](../../lib/services/workflow-execution-service.ts:28).
- [Actualización de paso en servicio](../../lib/services/workflow-execution-service.ts:282).

También se detectaron consultas de sesiones de turno y descansos sin filtro obligatorio de empresa, y actualización del método de costeo de una sucursal sin verificar su pertenencia al tenant.

- [Sesiones de turno](../../app/api/shift-sessions/route.ts:43).
- [Estado de descansos](../../app/api/labor/breaks/status/route.ts:41).
- [Cambio de método de costeo](../../app/api/inventory/costing/config/route.ts:27).

requireTenant obtiene contexto; no agrega automáticamente un filtro a todas las consultas. Debe haber una sola política de acceso por recurso, aplicada por todos sus puntos de entrada.

## H03 — P1: el planificador activo mezcla datos ficticios y backend real

El contenedor de turnos define sucursales y empleados ficticios, muestra conteos de esos arrays y pasa esos datos a la matriz que lee/escribe mediante acciones reales. No entrega companyId; la matriz sustituye su ausencia por una cadena vacía al abrir el editor. Esto no es solamente una pantalla sin terminar: puede enviar ids ficticios al backend.

- [Arrays de demostración y contenedor](../../components/labor/shifts/ShiftSchedulerContainer.tsx:12).
- [Matriz y editor](../../components/labor/shifts/WeeklyMatrixView.tsx:19).
- [Hook conectado a acciones reales](../../hooks/use-shifts.ts:48).

El botón Exportar no tiene acción y las pestañas de plantillas/asignación masiva muestran próximamente. Existe código para operaciones masivas, pero contiene valores vacíos para sucursal y rol; no basta con conectar un botón.

- [Operación masiva incompleta](../../lib/services/shift-template-service.ts:65).

Debe cerrarse un recorrido completo con sucursales y empleados de la empresa, permisos de servidor, validación y resultado visible antes de ampliar la pantalla.

## H04 — P1: las siete dimensiones del Modelo Operativo se guardan, pero no gobiernan la operación

Se capturan purchasingStructure, foodProduction, treasuryModel, supplierPayment, managerAutonomy, payrollDispersion y tenantType. La interfaz describe efectos sobre compras, producción, tesorería, pagos, autonomía y nómina. En el código actual no se encontraron consumidores de estas siete propiedades que apliquen esos efectos en la lógica de negocio; aparecen en formulario, persistencia, defaults y comentarios.

- [Dimensiones e impactos presentados al usuario](../../components/company/operating-dimensions-section.tsx:44).
- [Payload del formulario](../../components/company/operating-config-form.tsx:173).
- [Persistencia en esquema](../../lib/db/schema.ts:3228).
- [Servicio de configuración y ejemplos comentados](../../lib/services/tenant-config-service.ts:9).

Por ejemplo, seleccionar compras centralizadas o autonomía baja no demuestra que se bloquee una compra local ni que cambie su aprobación. Los límites monetarios de autorización sí tienen consumidores; son una política distinta.

También pettyCashLimitCents se persiste sin consumidor operativo identificado. El fondo de caja chica tiene su propio flujo de apertura: no debe asumirse que ese ajuste lo gobierna.

La interfaz debe distinguir configuración descriptiva y política aplicada. Cada dimensión necesita una especificación concreta de decisiones, servicios afectados y casos verificables antes de prometer su efecto.

## H05 — P1: parámetros financieros aplicados sin editor, y valores alterados al cargar

El backend utiliza IVA, factor de carga laboral e impuesto estatal sobre nómina. Esos parámetros no están expuestos en OperatingConfigValues ni admitidos por el esquema PUT de la configuración. También existe un umbral de variación de merma utilizado y admitido por la API, pero sin campo en el formulario.

- [Base de ventas e IVA](../../lib/services/sales-base.ts:60).
- [Parámetros de carga laboral](../../lib/services/labor-burden.ts:43).
- [Configuración aceptada por API](../../app/api/company/operating-config/route.ts:52).
- [Campos e inicialización del formulario](../../components/company/operating-config-form.tsx:24).
- [Umbral consumido en conteos](../../lib/services/stock-count-from-workflow.ts:296).

La inicialización usa operadores de valor verdadero/falso para varios límites, por lo que un cero puede sustituirse por el default y ciertos valores vacíos pierden la distinción entre cero y null. Además, si falla la carga de configuración, la página termina mostrando el formulario con valores por defecto sin un estado de error explícito.

- [Carga de la página](../../app/dashboard/company/operating-config/page.tsx:15).

Cada parámetro necesita unidad, rango, semántica de null/cero, alcance, permiso y auditoría. Los parámetros fiscales requieren un responsable y vigencia; este informe no evalúa su adecuación normativa.

## H06 — P1: la vista de sucursales y el motor financiero calculan métricas distintas

La vista QSR de sucursales calcula porcentajes sobre ventas brutas y usa porcentajes fijos de 31.5 y 24.5 cuando faltan costos. Aplica umbrales fijos de prime cost. El motor financiero utiliza base neta con IVA, carga laboral y objetivos configurables.

- [Frontend que consume la vista QSR](../../app/dashboard/branches/page.tsx:40).
- [Fallbacks, porcentajes y calidad del dato](../../lib/services/cross-branch-service.ts:1067).
- [Motor financiero](../../lib/services/financial-kpi-service.ts:145).

Si no hay ventas ni registros, la vista QSR puede conservar porcentajes de referencia y marcar VERIFIED porque la bandera de estimación solamente se activa en otros casos. Algunos indicadores de cumplimiento también parten de 100 cuando faltan registros. Esto puede presentar como saludable o verificado un dato inexistente.

Conviene centralizar definiciones de ventas, food cost, labor cost y prime cost. Dato real, estimado y ausente deben ser estados diferentes, visibles en cada pantalla.

## H07 — P1: preferencias de IA guardadas sin uso y confianza susceptible de sobrescritura

El editor guarda proveedor, proveedor alternativo y reintentos en aiConfig. La ejecución no transmite esa configuración a VerificationEngine.evaluate ni a AIService.verifyPhoto. Esta última utiliza su configuración por defecto y variables de entorno.

- [Configuración enviada por editor](../../components/builder/workflow-settings-modal.tsx:348).
- [Ejecución de verificación](../../lib/services/workflow-execution-service.ts:339).
- [Defaults del proveedor](../../lib/services/ai-service.ts:77).

En VerificationEngine se rechaza inicialmente una confianza inferior al mínimo, pero las ramas de calidad y seguridad vuelven a asignar success. Después, autoApprove puede eliminar la revisión manual. La regla de confianza no se conserva como condición obligatoria.

- [Evaluación y autoaprobación](../../lib/services/verification-engine.ts:35).

El resultado debe combinar todas las condiciones requeridas y devolver qué regla produjo aprobación, rechazo o revisión. La selección de proveedor debe llegar efectivamente al adaptador.

## H08 — P1: validaciones de negocio separadas de la escritura definitiva

El ejecutor comprueba campos obligatorios en el navegador. La API permite un valor opcional genérico, y el servicio no repite uniformemente las comprobaciones de requerido, tipo y límites antes de completar un paso. La verificación IA también depende de que exista valor o evidencia.

- [Comprobación del frontend](../../components/workflow/workflow-executor.tsx:704).
- [Contrato de actualización](../../app/api/workflows/executions/[id]/steps/[stepId]/route.ts:11).
- [Escritura del paso](../../lib/services/workflow-execution-service.ts:315).

En turnos hay un servicio de validación con límites distintos a los de la ruta API, mientras que la acción de creación solo pasa por la comprobación de solapamiento del servicio de persistencia.

- [Reglas de validación](../../lib/services/shift-validation-service.ts:9).
- [Validación de API](../../app/api/shifts/route.ts:178).
- [Creación en servicio](../../lib/services/shift-service-extended.ts:120).

La UI puede anticipar errores, pero toda escritura debe aplicar la misma política de servidor. Este informe no valida los límites laborales contra legislación vigente.

## H09 — P1: capas de notificaciones que no comparten el mismo contrato

El router calcula canales, incluyendo restricciones por horario, y los pasa como metadata.routedChannels. El dispatcher no consume esa decisión; vuelve a seleccionar canales según plantilla y preferencias. Por ello, una decisión del router puede no gobernar el envío real.

- [Selección y metadata del router](../../lib/notifications/notification-router.ts:300).
- [Despacho por canales](../../lib/services/notification-dispatcher.ts:526).

El dispatcher usa Promise.allSettled sin revisar resultados y varios adaptadores capturan errores. La función Inngest puede devolver éxito aunque un canal falle, perdiendo la señal necesaria para reintentar. El email genérico llega a registrar contenido sin enviarlo. El horario se calcula con hora local fija, sin contexto de sucursal.

- [Función durable de notificación](../../lib/inngest/functions/notification-dispatch.ts:41).
- [Email genérico](../../lib/services/notification-dispatcher.ts:694).

Hay tres APIs de preferencias para la misma área, con contratos distintos. La pantalla de preferencias inicia valores en true sin cargar lo guardado, y el dispatcher permite siempre stock_alert y shift_reminder en su selección por tipo.

- [Pantalla de preferencias](../../components/profile/notification-preferences.tsx:31).
- [API notifications/preferences](../../app/api/notifications/preferences/route.ts:11).
- [API profile/notification-preferences](../../app/api/profile/notification-preferences/route.ts:20).
- [API users/profile/preferences](../../app/api/users/profile/preferences/route.ts:21).

NotificationService y NotificationDispatcher tienen consumidores activos. Eso demuestra superposición de caminos, no que cada evento se envíe dos veces. Debe existir una sola decisión efectiva de destinatario/canal y resultados de envío por canal, con estados y reintentos explícitos.

## H10 — P1: completar un workflow no garantiza sus efectos posteriores

checkProgress ejecuta completionActions al detectar todos los pasos terminados, sin una barrera previa que haga única la transición. El runner captura errores de acciones; después se marca la instancia COMPLETED. La publicación del evento posterior también captura errores sin un outbox transaccional.

- [Finalización y publicación](../../lib/services/workflow-execution-service.ts:553).
- [Acciones que capturan errores](../../lib/services/workflow-action-runner.ts:79).
- [Extractores registrados en Inngest](../../lib/inngest/functions/workflow-extractors.ts:43).

Los extractores sí están conectados y emplean pasos durables; no son simplemente código abandonado. El problema está en garantizar la transición, la entrega del evento y la trazabilidad de los efectos. Una reevaluación puede repetir completionActions; un fallo de publicación puede dejar una ejecución completada sin extracción.

Se requiere transición atómica, idempotencia por efecto y estado visible de procesamiento. No se reprodujeron duplicaciones en una base real.

## H11 — P2: hay un motor de workflows anterior todavía registrado

El endpoint /api/workflow publica eventos de un executor anterior. Esa función espera workflow/step.completed y marca la ejecución terminada tras un evento, en lugar de comprobar todos los pasos. No se encontró productor actual de ese evento ni consumidor interno de ese endpoint en el frontend revisado. La función sigue exportada en el registro Inngest.

- [Endpoint anterior](../../app/api/workflow/route.ts:5).
- [Executor anterior](../../lib/inngest/functions/workflow-executor.ts:78).
- [Registro de funciones](../../lib/inngest/functions/index.ts:36).
- [Catálogo de eventos](../../lib/inngest/events.ts:7).

Debe identificarse si existen consumidores externos antes de desactivarlo. Es un caso de posible implementación anterior en paralelo, distinto del servicio actual y sus extractores.

## H12 — P2: componentes huérfanos, servicios sin consumidores y documentación desactualizada

Se encontraron componentes no montados que llaman endpoints inexistentes: descansos, asignación masiva de turnos y acciones de alertas KPI. También la página workflow-test llama tres endpoints ausentes. Un literal de endpoint en un componente huérfano no equivale a un fallo en una pantalla activa.

Ejemplos de implementación sin importadores actuales de aplicación: notification-dispatcher del directorio lib/notifications, notification-queue de WhatsApp, workflow-conversation-handler-fixed, break-management-service y compliance/payroll-calculator. Otros servicios especializados solo tienen consumidores en pruebas. Son candidatos a clasificar, no una orden automática de eliminarlos.

- [Dispatcher anterior con logs](../../lib/notifications/notification-dispatcher.ts).
- [Cola anterior](../../lib/whatsapp/notification-queue.ts).
- [Página de prueba](../../app/dashboard/workflow-test/page.tsx).

El archivo raíz del esquema indica deprecación, pero sigue siendo el punto de entrada de la conexión y Drizzle, y contiene tablas que no están completas en los módulos. Seguir ese comentario sin migración puede romper imports.

- [Esquema raíz](../../lib/db/schema.ts:1).
- [Conexión](../../lib/db/index.ts:4).
- [Configuración Drizzle](../../drizzle.config.ts:7).

La integración efectiva de WhatsApp usa WHAPI en la fábrica, mientras documentación/instrucciones describen Wasender. Eso es deriva documental; no demuestra envío activo por ambos proveedores.

- [Fábrica de WhatsApp](../../lib/whatsapp/client-factory.ts:39).

## Similitudes que no justifican fusionar servicios

| Archivos o capas | Diferencia real |
| --- | --- |
| sales-ingest-service / sales-ingestion-service | El primero ingresa ventas de productos y consumo teórico; el segundo cortes diarios. Se deben conciliar, no fusionar solo por el nombre. |
| approvals / approval-requests | Aprobaciones RH y de compras/servicios tienen dominios distintos. |
| period-service / financial-period-service | Periodos de inventario y financieros no son necesariamente la misma entidad. |
| Funciones Inngest / lib/cron | Un wrapper durable y la función de negocio forman una separación válida. |
| Esquema raíz / módulos de esquema | Son agregación y migración incompleta dentro de la misma base, no evidencia de dos backends independientes. |

## Qué lógica debería ser editable desde la interfaz

La interfaz edita políticas permitidas. El backend determina alcance, valida valores, aplica la política y registra quién la cambió. Un campo guardado sin consumidor no constituye una regla implementada.

| Política | Estado observado | Tratamiento recomendado |
| --- | --- | --- |
| Siete dimensiones del Modelo Operativo | Captura/persistencia sin aplicación encontrada | Definir efectos por dominio antes de presentarlas como operativas. |
| Límite de autorización y doble aprobación | Consumidos en gastos | Conservar, corregir cero/null y probar decisiones de aprobación. |
| Límite de emergencia, cortesías y merma | Hay consumidores concretos | Documentar alcance exacto y distinguir las reglas. |
| Límite de caja chica del Modelo Operativo | Sin consumidor identificado | Conectar a una política definida o etiquetar como descriptivo. |
| IVA | Utilizado en cálculos, sin editor en configuración | Añadir administración con permiso y vigencia; evitar recalcular historia implícitamente. |
| Carga laboral e impuesto de nómina | Utilizados, sin editor en configuración | Administración autorizada y cálculo centralizado. |
| Umbral de variación de merma | Backend/API disponibles, sin campo UI | Exponerlo con unidad y rango. |
| Objetivos financieros | Consumidos por motor financiero | Reutilizarlos en comparación de sucursales y mostrar estado del dato. |
| Proveedor/reintentos de IA por plantilla | Guardados, sin propagación a ejecución | Pasar la política al adaptador o retirar la promesa de efecto. |
| Requerido, evidencia y condiciones del paso | Comprobación parcial en cliente | Validación autoritativa en servidor; UI anticipa errores. |
| Canales y preferencias de notificación | APIs y selección divergentes | Una política efectiva y resultado de entrega por canal. |
| Límites de turnos y descansos | Reglas separadas y no uniformes | Política única aplicada en todas las escrituras. |

No corresponde al navegador decidir empresa, identidad, permisos, aprobación definitiva, costo final, deducción de inventario ni transición final de workflow. Puede mostrar previsiones y solicitar cambios; el servidor decide y persiste.

## Orden recomendado

1. Cerrar autorización y tenant en acciones de turnos, rutas paralelas de plantillas, ejecuciones/pasos, sesiones, descansos y costeo. Verificar casos de otra empresa y roles insuficientes.
2. Terminar el planificador con datos reales y un único camino de escritura validado. Evitar ids ficticios y operaciones incompletas en el recorrido operativo.
3. Inventariar las políticas del Modelo Operativo: implementada, descriptiva o pendiente. Conectar efectos concretos y completar parámetros financieros necesarios.
4. Unificar validación de pasos/IA y definiciones financieras. Mostrar ausente/estimado/real; conservar todas las condiciones de aprobación.
5. Unificar contrato de notificaciones y garantizar efectos posteriores de workflows, con idempotencia y fallos observables.
6. Clasificar implementación anterior, prototipos y módulos sin uso; confirmar consumidores externos, retirar progresivamente y actualizar documentación.

## Criterio para declarar un flujo conectado

Un usuario autorizado puede cargar datos de su empresa, ejecutar una operación, recibir el resultado real y consultar su estado. El servidor repite validación y autorización, persiste una sola vez y produce efectos trazables. Los cambios de configuración modifican las decisiones documentadas. Los errores no se presentan como éxito ni se sustituyen silenciosamente por datos de demostración.
