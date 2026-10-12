# Plan de conexión entre frontend y backend — Pulso HORECA

Fecha: 10 de octubre de 2026. Actualización: 12 de octubre de 2026. Estado: C00–C13 implementadas con límites de verificación registrados en el seguimiento; C12 se cierra con la entrega de C11. C14–C40 pendientes.

Origen: [auditoría de conexiones](../docs/audits/2026-10-10-backend-frontend-wiring-audit.md). Seguimiento: [lista de tareas](todo-conexion-frontend-backend.md).

## Objetivo

Cerrar los recorridos operativos existentes: datos reales y autorizados, una política efectiva por decisión, escritura validada en servidor y efectos posteriores trazables. El usuario debe poder cambiar una configuración permitida y observar su efecto documentado en la operación.

El resultado esperado es un proyecto conectado por flujos completos, con responsabilidades claras entre interfaz, servicios y procesos durables. Cada hallazgo de la auditoría debe quedar corregido o resuelto mediante una decisión de alcance explícita y comprobable.

## Alcance y estado de la evidencia

Este plan cubre H01–H12 de la auditoría. Los hallazgos provienen de lectura estática, no de reproducción en producción. C00 establece una línea base y confirma el recorrido actual antes de modificarlo. Una tarea no se considera terminada solo porque el código compila, una configuración se guarda o un log dice enviado.

La prioridad inicial es autorización y aislamiento. Después se completa turnos, configuración, workflows, métricas y notificaciones. La retirada de implementaciones anteriores ocurre cuando sus consumidores ya están clasificados.

La estimación es de tamaño relativo: S, una operación acotada; M, un recorrido de tres a cinco archivos contando pruebas. Hay 41 tareas principales; C35 se ejecuta por productor y C38 por lote. No se fijan fechas de entrega sin resolver los contratos pendientes. Si una tarea exige más de cinco archivos o más de una sesión enfocada, se divide en subtareas con el mismo criterio de aceptación antes de implementarla.

## Decisiones de arquitectura

1. El servidor deriva empresa e identidad de sesión o de un contexto interno verificable. No confía en companyId del navegador. Tenant, sucursal, rol y relación con el recurso son controles separados; obtener contexto no filtra automáticamente las consultas.
2. Rutas, acciones de servidor y jobs reutilizan políticas del dominio. La UI anticipa validación y muestra resultados; el servidor autoriza y decide la escritura definitiva.
3. Se mantiene un contrato canónico por operación. Las rutas compatibles delegan al mismo comportamiento durante la transición; no se borra una ruta solo por tener otro nombre.
4. Configuración descriptiva, política aplicada y funcionalidad pendiente se distinguen. Cada política tiene unidad, rango, alcance, vigencia cuando corresponda, permiso y consumidor efectivo.
5. Las fórmulas financieras comparten base y procedencia. Dato real, estimado y ausente son estados distintos. Una ausencia no se convierte en cumplimiento de 100 ni en porcentaje saludable.
6. Finalización de pasos y procesamiento de efectos son estados separados. Las transiciones tienen idempotencia y la entrega de eventos se recupera ante fallos mediante outbox o un mecanismo durable equivalente.
7. Cada canal de notificación tiene resultado e idempotencia propios. Un fallo parcial permite reintentar sin volver a enviar los canales exitosos.
8. Los servicios se consolidan por responsabilidad y consumidores demostrados. Cortes diarios y ventas por producto, aprobaciones RH y compras, y periodos de dominios distintos conservan su separación.

## Límites de la intervención

- Reutilizar helpers, servicios y adaptadores vigentes antes de crear equivalentes.
- Cambiar un recorrido por tarea; evitar una migración general de carpetas o un servicio gigante para todo el negocio.
- Mantener decisiones y evidencia de planes anteriores que sigan vigentes. Un checkbox histórico no reemplaza la verificación de comportamiento actual.
- No activar una política de compras, tesorería o nómina deducida únicamente del nombre de un campo.
- Verificar con empresas de prueba y adaptadores simulados. Las pruebas de entrega no envían WhatsApp, email ni pagos reales.
- Las migraciones necesarias serán aditivas y revisadas, con datos previos preservados y recuperación definida. El plan no usa db:push como atajo de implementación.

## Relación con planes existentes

Los archivos generales tasks/plan.md y tasks/todo.md pertenecen al refinamiento del dashboard ejecutivo. Se conservan; estos dos archivos específicos son la fuente de seguimiento para la auditoría de conexión.

| Plan existente | Cómo se incorpora |
| --- | --- |
| [Alcance por sucursal](plan-branch-scope-fail-closed.md) | Reutilizar el modelo ALL/BRANCH/NONE y comprobar que los puntos de entrada nuevos no fallen abiertos. |
| [Rediseño de configuración](plan-operating-config-redesign.md) | Conservar el trabajo visual; agregar semántica, consumidores y estados reales. |
| [Cierre de auditoría financiera](plan-cierre-auditoria-finanzas.md) | Reutilizar cálculos ya corregidos; resolver la divergencia de la vista QSR sin rehacer finanzas completas. |
| [Revisión y bitácora de workflows](plan-workflow-review-bitacora.md) | Preservar la definición aplicable a la instancia y el historial; complementar validación y efectos. |
| [Grupo restaurantero unificado](plan-grupo-restaurantero-unificado.md) | Conciliar productores y dominios existentes. Sus estados históricos no acreditan que todos los efectos sigan conectados. |

## Orden y dependencias

~~~mermaid
flowchart TD
  A[C00: mapa y línea base] --> B[C01–C07: permisos y empresa]
  B --> C[C08–C12: turnos reales]
  B --> D[C13–C23: políticas efectivas]
  B --> E[C24–C28: workflows y efectos]
  D --> F[C29–C31: métricas consistentes]
  B --> G[C32–C35: notificaciones]
  A --> H[C36: clasificar implementación anterior]
  E --> I[C37–C39: consolidación]
  G --> I
  H --> I
  C --> J[C40: cierre con evidencia]
  F --> J
  I --> J
  D --> J
~~~

El diagrama muestra familias de trabajo; las dependencias de cada tarea son las precisas. Se recomienda completar la fase P0 antes de ampliar pantallas. Las políticas con decisiones pendientes pueden permanecer descriptivas sin bloquear las correcciones de seguridad o los recorridos ya definidos. Cambios que compartan esquema, API o servicio deben realizarse secuencialmente.

## Verificación utilizada por las tareas

Los comandos se basan en los scripts actuales de package.json y usan pnpm. Las rutas de pruebas nuevas se crean durante implementación, no en esta planificación.

| Clave | Ejecución y evidencia requerida |
| --- | --- |
| V0 | Línea base y puertas de fase: pnpm run lint, pnpm run build y pnpm run test:unit según el alcance. Registrar comando, fecha, resultado y fallos preexistentes. En Windows puede usarse pnpm.cmd. |
| V1 | Prueba de contrato, integración o regla: pnpm run test:unit -- <archivo.test.ts>. Cubrir resultados, aislamiento y ausencia de efectos al rechazar; no limitarse a comprobar que un helper fue llamado. |
| V2 | Recorrido en navegador: pnpm exec playwright test <archivo.spec.ts>. Usar servidor local y datos aislados; comprobar carga, operación, persistencia tras recarga y error corregible. El comando de suite es pnpm test:e2e. |
| V3 | Fallos y concurrencia: pruebas enfocadas de integración con adaptadores controlados, dos solicitudes concurrentes, reintento, entrega duplicada y caída entre persistencia y publicación. Verificar el estado final y la cantidad real de efectos. |

En cada punto de control se registran las pruebas de las tareas del bloque. Build y lint se revisan al cierre de la fase y antes de integrar cambios. Las suites completas se ejecutan al cierre y cuando un cambio transversal lo justifique. Un bloqueo del runner queda como no verificado, no como prueba aprobada.

## Tareas ejecutables

## Fase 0 — Preparación y trazabilidad

**Entrega:** Inventario de recorridos y línea base reproducible.

<a id="c00"></a>

### C00 — Establecer línea base y mapa de recorridos

**Hallazgos:** H01, H02, H03, H04, H05, H06, H07, H08, H09, H10, H11, H12. **Dependencias:** ninguna. **Tamaño:** M.

Registrar para cada recorrido activo su pantalla, entrada de servidor, servicio, tablas, política y efectos. Conciliar los hallazgos con planes anteriores antes de abrir cambios.

**Criterios de aceptación:**

- [ ] La matriz cubre los doce hallazgos y clasifica cada recorrido como completo, parcial, demostración o sin consumidor interno.
- [ ] Existe una matriz de rol/empresa/sucursal y fixtures de dos empresas sin datos de producción.
- [ ] Se registran resultados reales de pruebas y build; un fallo del entorno se distingue de un fallo de aplicación.

**Verificación:** Inspección de contratos y V0; no marcar esta tarea completa solo por enumerar archivos.

**Archivos probables:**

- `docs/audits/2026-10-10-backend-frontend-wiring-audit.md`
- `tasks/plan-conexion-frontend-backend.md`
- `tests/fixtures/tenant-isolation.ts (nuevo)`

#### Punto de control C00–C00

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

**Puerta de fase:** revisar build/lint y regresiones pertinentes; conservar evidencia de la entrega indicada al inicio.

## Fase 1 — Permisos y aislamiento de empresa — P0

**Entrega:** Ninguna entrada revisada consulta o escribe fuera del alcance autorizado.

<a id="c01"></a>

### C01 — Acotar la lectura de turnos

**Hallazgos:** H01. **Dependencias:** C00. **Tamaño:** M.

Obtener sesión y alcance de empresa/sucursal en el servidor y hacer obligatorio ese contexto al listar turnos.

**Criterios de aceptación:**

- [ ] Sin sesión se rechaza la lectura; un rol sin permiso no obtiene datos.
- [ ] Un usuario de la empresa A no obtiene turnos de B con filtros vacíos o IDs de B.
- [ ] Un rol limitado a sucursal sin sucursal asignada no obtiene acceso global.

**Verificación:** V1: lecturas con filtros vacíos, empresa ajena y alcance NONE, BRANCH y ALL.

**Archivos probables:**

- `app/actions/shifts.ts`
- `lib/services/shift-service-extended.ts`
- `tests/shifts/read-scope.test.ts (nuevo)`

<a id="c02"></a>

### C02 — Autorizar las escrituras de turnos

**Hallazgos:** H01. **Dependencias:** C01. **Tamaño:** M.

Aplicar sesión, permisos y pertenencia de recursos a crear, editar, borrar, publicar y duplicar turnos. Derivar companyId de la sesión.

**Criterios de aceptación:**

- [ ] Los IDs de turno, empleado y sucursal de otra empresa son rechazados antes de escribir.
- [ ] Crear, editar, borrar, publicar y duplicar requieren su permiso y no confían en companyId del cliente.
- [ ] Una operación rechazada no deja escrituras parciales ni altera recursos ajenos.

**Verificación:** V1: intentar cada operación con sesión ausente, rol insuficiente y recursos de la segunda empresa.

**Archivos probables:**

- `app/actions/shifts.ts`
- `lib/services/shift-service-extended.ts`
- `tests/shifts/write-scope.test.ts (nuevo)`

<a id="c03"></a>

### C03 — Unificar autorización de plantillas

**Hallazgos:** H02. **Dependencias:** C00. **Tamaño:** M.

Hacer que las dos familias de rutas de plantillas compartan la política de permiso y empresa, preservando compatibilidad hasta inventariar consumidores.

**Criterios de aceptación:**

- [ ] GET, PATCH y DELETE comprueban empresa y permiso según la matriz.
- [ ] Ambas rutas producen el mismo resultado de autorización para el mismo recurso.
- [ ] El administrador de plantillas usa el contrato elegido y muestra rechazos sin simular éxito.

**Verificación:** V1 en ambas rutas y V2 del borrado desde el administrador; cubrir plantillas globales si existen como caso explícito.

**Archivos probables:**

- `app/api/templates/[id]/route.ts`
- `app/api/workflows/templates/[id]/route.ts`
- `app/dashboard/builder/templates/template-manager.tsx`
- `tests/workflows/template-access.test.ts (nuevo)`

#### Punto de control C01–C03

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

<a id="c04"></a>

### C04 — Acotar creación y lectura de ejecuciones

**Hallazgos:** H02. **Dependencias:** C03. **Tamaño:** M.

Verificar plantilla, sucursal, asignado e instancia contra el contexto autorizado al iniciar y consultar una ejecución.

**Criterios de aceptación:**

- [ ] No se inicia una ejecución con plantilla, sucursal o asignado ajenos.
- [ ] La lectura por ID respeta empresa, sucursal y relación con el ejecutor según el rol.
- [ ] Los caminos internos y smart links conservan un contexto explícito sin convertirlos en bypass.

**Verificación:** V1 de creación/lectura y V2 de inicio y consulta válidos; contrastar ejecución interna y externa.

**Archivos probables:**

- `app/api/workflows/execute/route.ts`
- `app/api/workflows/executions/[id]/route.ts`
- `lib/services/workflow-execution-service.ts`
- `tests/workflows/execution-access.test.ts (nuevo)`

<a id="c05"></a>

### C05 — Autorizar actualización y revisión de pasos

**Hallazgos:** H02. **Dependencias:** C04. **Tamaño:** M.

Validar acceso a la instancia y permiso de operación antes de actualizar evidencia, estado o revisión.

**Criterios de aceptación:**

- [ ] Un operador ajeno o de otra sucursal no modifica pasos fuera de su alcance.
- [ ] La revisión requiere un rol autorizado y se distingue del permiso de ejecución.
- [ ] El servicio recibe contexto verificado y ningún punto de entrada habilita edición por ID solamente.

**Verificación:** V1 de actualización y revisión con matriz de roles; V2 del recorrido ejecutar/revisar.

**Archivos probables:**

- `app/api/workflows/executions/[id]/steps/[stepId]/route.ts`
- `app/api/workflows/executions/[id]/route.ts`
- `lib/services/workflow-execution-service.ts`
- `tests/workflows/step-access.test.ts (nuevo)`

<a id="c06"></a>

### C06 — Acotar consultas de sesiones y descansos

**Hallazgos:** H02. **Dependencias:** C00. **Tamaño:** M.

Añadir empresa y alcance por sucursal a las consultas de sesiones de turno y estado de descansos.

**Criterios de aceptación:**

- [ ] Filtros vacíos nunca producen sesiones de otras empresas.
- [ ] Un branchId o userId ajeno se rechaza o queda fuera del resultado sin revelar datos.
- [ ] Los roles sin sucursal asignada fallan de forma cerrada según la matriz.

**Verificación:** V1 con dos empresas, roles de sucursal y consultas sin filtros.

**Archivos probables:**

- `app/api/shift-sessions/route.ts`
- `app/api/labor/breaks/status/route.ts`
- `tests/labor/session-scope.test.ts (nuevo)`

#### Punto de control C04–C06

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

<a id="c07"></a>

### C07 — Verificar pertenencia al cambiar costeo

**Hallazgos:** H02. **Dependencias:** C00. **Tamaño:** M.

Comprobar que la sucursal pertenece a la empresa y está dentro del alcance permitido antes de cambiar su método de costeo.

**Criterios de aceptación:**

- [ ] Solo una sesión con permiso de inventario y alcance válido cambia el método.
- [ ] Un ID de otra empresa no llega a la actualización.
- [ ] Una operación válida conserva auditoría y comportamiento esperado del costeo.

**Verificación:** V1 con cambios permitidos y rechazados; verificar que el método ajeno permanece intacto.

**Archivos probables:**

- `app/api/inventory/costing/config/route.ts`
- `lib/services/costing-service.ts`
- `tests/inventory/costing-config-access.test.ts (nuevo)`

#### Punto de control C07–C07

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

**Puerta de fase:** revisar build/lint y regresiones pertinentes; conservar evidencia de la entrega indicada al inicio.

## Fase 2 — Planificador de turnos con datos reales

**Entrega:** Crear, editar, publicar y exportar turnos funciona desde la pantalla activa.

<a id="c08"></a>

### C08 — Cargar empleados y sucursales reales en el planificador

**Hallazgos:** H03. **Dependencias:** C01, C02. **Tamaño:** M.

Sustituir arrays ficticios por datos autorizados de la empresa y presentar carga, vacío y error sin usar mocks como fallback.

**Criterios de aceptación:**

- [ ] Los selectores y conteos corresponden a datos reales dentro del alcance de la sesión.
- [ ] No se envían IDs ficticios ni companyId vacío al guardar.
- [ ] Un error de carga impide una escritura inválida y ofrece reintento.

**Verificación:** V2: cargar, filtrar, crear, recargar y comprobar persistencia en dos empresas.

**Archivos probables:**

- `components/labor/shifts/ShiftSchedulerContainer.tsx`
- `components/labor/shifts/WeeklyMatrixView.tsx`
- `hooks/use-shifts.ts`
- `tests/e2e/shifts-real-data.spec.ts (nuevo)`

<a id="c09"></a>

### C09 — Aplicar una política de validación de turnos

**Hallazgos:** H08. **Dependencias:** C02, C08. **Tamaño:** M.

Reutilizar la política de validación al guardar desde acciones, API y operaciones de servicio. Resolver discrepancias sin inventar nuevos límites legales.

**Criterios de aceptación:**

- [ ] Acción y API aceptan/rechazan el mismo turno con el mismo contexto.
- [ ] Solapamiento, horas y descanso se verifican en servidor; el cliente anticipa el mismo error.
- [ ] Los límites tienen procedencia documentada y las excepciones autorizadas quedan auditadas.

**Verificación:** V1 de límites, solapamientos y casos frontera; V2 de error corregible al guardar.

**Archivos probables:**

- `lib/services/shift-validation-service.ts`
- `lib/services/shift-service-extended.ts`
- `app/api/shifts/route.ts`
- `app/actions/shifts.ts`
- `tests/shifts/business-validation.test.ts (nuevo)`

<a id="c10"></a>

### C10 — Completar exportación de turnos

**Hallazgos:** H03. **Dependencias:** C08. **Tamaño:** M.

Conectar el botón Exportar al formato ya previsto y a los filtros/alcance efectivos.

**Subtareas de implementación (11-10-2026):** C10.1 — CSV utilizable y pruebas de formato/descarga; C10.2 — conectar la descarga a la semana y filtros de la matriz, con estados de vacío/error y comprobación en navegador. Se reutiliza `useShiftExport` y la lectura autorizada de C01; el formato expuesto será CSV. Cada subtarea conserva los criterios de C10.

C10.3 — impedir que lecturas fuera de orden sustituyan los turnos del filtro actual y comprobarlo con respuestas controladas en navegador. Es necesario para que el archivo corresponda al filtro visible; se acota a `useShifts` y a la prueba de descarga.

**Criterios de aceptación:**

- [x] Exportar produce un archivo utilizable con los turnos visibles del periodo.
- [x] No incluye empleados o sucursales fuera del alcance autorizado.
- [x] Vacío y fallo de exportación tienen respuesta visible; el botón no es inerte.

**Verificación:** V2: descargar y verificar contenido, periodo y filtros.

**Evidencia (11-10-2026):** [C10 — Exportación del planificador](../docs/audits/2026-10-11-shifts-export.md). Siete pruebas de navegador con acciones simuladas, nueve casos unitarios de CSV, suite unitaria 870 aprobadas (una omitida y un TODO), build aprobado y lint enfocado sin errores ni warnings. No acredita los recorridos de creación/recarga de C08 ni los de excepciones de C09.

**Archivos probables:**

- `components/labor/shifts/ShiftSchedulerContainer.tsx`
- `hooks/use-shift-export.ts`
- `tests/e2e/shifts-export.spec.ts (nuevo)`

#### Punto de control C08–C10

- [x] Criterios del bloque verificados con resultados registrados.
- [x] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [x] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

<a id="c11"></a>

### C11 — Aplicar plantillas de turnos válidas

**Hallazgos:** H03. **Dependencias:** C09. **Tamaño:** M.

Completar vista previa y aplicación de una plantilla con empleados, sucursal y rol válidos.

**Criterios de aceptación:**

- [x] La vista previa permite identificar turnos a crear y conflictos antes de confirmar.
- [x] La aplicación respeta permisos, alcance y validación común sin IDs vacíos.
- [x] Se informa qué se aplicó y qué se rechazó; la recarga refleja el resultado persistido.

**Verificación:** V1 de conflictos y V2 de vista previa/aplicación; definir atomicidad antes de escribir.

**Corte de implementación C11 (11-10-2026):** resultado por empleado y fecha, en orden cronológico. Cada elemento se autoriza y valida de nuevo al guardar; los válidos persisten y los rechazados no escriben. La vista previa simula los elementos aceptados del lote sin escribir. No reserva cupos ni garantiza que el estado no cambie antes de confirmar.

- C11.1: contrato de destino y resultado; vista previa autorizada y validación compartida con la escritura; pruebas V1.
- C11.2: pestaña de plantillas con catálogo real, selección explícita de sucursal/rol/empleados, confirmación y resultados; V2.
- C11.3: regresiones, build/lint y evidencia, incluyendo los límites de adaptadores simulados.

**Decisiones (11-10-2026):** atomicidad **por elemento**, no por lote —cada turno se guarda en su propia transacción con `pg_advisory_xact_lock` por empresa y empleado, de modo que reintentar un lote parcial es seguro—. `MAX_DAILY_HOURS` no es una excepción del lote: la jornada larga se rechaza elemento a elemento como en la creación manual.

**Evidencia (11-10-2026):** [C11 — Plantillas de turnos y asignación masiva](../docs/audits/2026-10-11-plantillas-turnos.md). 34 casos unitarios sobre el servicio, la política y las acciones reales; 12 pruebas de Chromium (8 de plantillas, 4 de asignación masiva); suite 903 aprobadas (una omitida y un TODO), build aprobado y tsc limpio. Los límites —adaptador que emula el bloqueo, plantillas sin persistencia, recorridos de workflows sin verificar— quedan en la evidencia.

**Cubierto por C11:** los tres criterios de [C12](#c12) se cumplen dentro de este bloque.

**Archivos probables:**

- `lib/services/shift-template-service.ts`
- `app/actions/shifts.ts`
- `components/labor/shifts/ShiftSchedulerContainer.tsx`
- `tests/shifts/template-apply.test.ts (nuevo)`
- `tests/e2e/shifts-template.spec.ts (nuevo)`

<a id="c12"></a>

### C12 — Completar asignación masiva de turnos

**Hallazgos:** H03. **Dependencias:** C11. **Tamaño:** M.

Conectar una operación masiva explícita con validación de cada destino y resultado trazable.

**Criterios de aceptación:**

- [x] No se generan turnos con sucursal o rol vacíos.
- [x] La política de todo-o-nada o resultado por elemento está definida y se respeta frente a conflictos.
- [x] Repetir una solicitud no crea duplicados accidentales y el usuario ve el resultado real.

**Verificación:** V1 de operaciones masivas con conflicto/duplicado y V2 desde la pestaña activa.

**Archivos probables:**

- `lib/services/shift-template-service.ts`
- `app/actions/shifts.ts`
- `components/labor/shifts/ShiftSchedulerContainer.tsx`
- `tests/shifts/bulk-apply.test.ts (nuevo)`

#### Punto de control C11–C12

- [x] Criterios del bloque verificados con resultados registrados.
- [x] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [x] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

**Cierre de C12 (11-10-2026):** sus tres criterios se verificaron dentro de [C11](#c11): destino obligatorio por contrato y catálogo, atomicidad por elemento declarada y respetada frente a conflictos, y rechazo de duplicados con resultado real visible. No se abre un recorrido aparte.

**Puerta de fase de la Fase 2 (12-10-2026):** `lint` 0 errores (2386 warnings), `build` OK, `test:unit` 924/924 (69 archivos) y 30/30 pruebas de navegador de la configuración aislada (11 de C13, 19 de turnos de C10–C12). Los límites de V2 de C08 y de la excepción de C09 siguen declarados en el [seguimiento](todo-conexion-frontend-backend.md).

**Puerta de fase:** revisar build/lint y regresiones pertinentes; conservar evidencia de la entrega indicada al inicio.

## Fase 3 — Configuración que produce efectos

**Entrega:** Cada ajuste tiene una regla aplicada o se presenta expresamente como descriptivo.

<a id="c13"></a>

### C13 — Conservar valores y errores de configuración

**Hallazgos:** H05. **Dependencias:** C00. **Tamaño:** M.

Corregir inicialización y serialización para preservar cero, null y valores guardados; impedir edición silenciosa con defaults tras una carga fallida.

**Criterios de aceptación:**

- [x] Guardar y recargar preserva cero, null y límites existentes según su contrato.
- [x] Un GET fallido muestra error/reintento y no permite sobrescribir con defaults aparentes.
- [x] PUT valida unidades y rangos y devuelve errores por campo.

**Verificación:** V1 de ida y vuelta y V2 de carga fallida/recuperación.

**Evidencia (12-10-2026):** [C13 — Conservar valores y errores de configuración](../docs/audits/2026-10-12-operating-config-roundtrip.md). 21 casos unitarios sobre la ruta real y el mapeo en `lib/company/operating-config-values.ts`; 11 pruebas de Chromium con `GET`/`PUT` controlados; suite unitaria 924 aprobadas (una omitida y un TODO), build aprobado y lint sin errores. Límites: el navegador no ejecuta Next/auth —la autorización queda en los casos unitarios—, y vigencia/periodos cerrados siguen pendientes en C14.

**Archivos probables:**

- `components/company/operating-config-form.tsx`
- `app/dashboard/company/operating-config/page.tsx`
- `app/api/company/operating-config/route.ts`
- `tests/company/config-roundtrip.test.ts (nuevo)`

<a id="c14"></a>

### C14 — Exponer parámetros consumidos que faltan en la interfaz

**Hallazgos:** H05. **Dependencias:** C13. **Tamaño:** M.

Añadir IVA, carga laboral, impuesto estatal y umbral de merma al contrato autorizado y su formulario, reutilizando consumidores existentes.

**Subtareas de implementación (12-10-2026):** el recorrido toca la ruta PUT, el mapeo ida y vuelta, el formulario, una sección nueva, una migración aditiva para el historial y pruebas — más de cinco archivos — así que se divide antes de implementar, con los mismos criterios de aceptación:

- C14.1 — contrato y formulario: el PUT acepta `vatRatePercent`, `laborBurdenFactorPercent` y `payrollStateTaxPercent` con `null` explícito (además de `mermaVarianceThresholdPct`, ya admitido), y una sección nueva los expone con unidad, rango y semántica de vacío; ida y vuelta con V1 y V2.
- C14.2 — historial de actor y cambio: tabla aditiva `config_change_logs` y un registro por campo en el PUT; V1 sobre la ruta real.
- C14.3 — efectos y vigencia: un caso controlado por parámetro sobre su consumidor y `docs/operating-policy-contracts.md` con la decisión de vigencia y periodos cerrados.

**Criterios de aceptación:**

- [ ] Los cuatro parámetros se pueden consultar, editar y recargar con unidades y rangos explícitos.
- [ ] Solo el rol definido puede modificarlos y queda historial de actor y cambio.
- [ ] Un caso controlado demuestra el efecto de cada parámetro; se define vigencia y tratamiento de periodos cerrados antes de habilitar efectos históricos.

**Verificación:** V1 de contrato y efectos en consumidores; V2 de edición/recarga. Si la vigencia requiere migración, separarla antes de ampliar esta tarea.

**Archivos probables:**

- `components/company/operating-config-form.tsx`
- `app/api/company/operating-config/route.ts`
- `lib/services/tenant-config-service.ts`
- `tests/company/financial-config.test.ts (nuevo)`
- `docs/operating-policy-contracts.md (nuevo)`

<a id="c15"></a>

### C15 — Definir el contrato de cada política operativa

**Hallazgos:** H04. **Dependencias:** C13. **Tamaño:** M.

Crear un catálogo de las siete dimensiones y caja chica: valores, comportamiento esperado, alcance, consumidor, permiso, momento de aplicación y excepciones.

**Criterios de aceptación:**

- [ ] Cada valor tiene un caso dado/cuando/entonces o queda clasificado como descriptivo.
- [ ] La UI distingue aplicada, descriptiva y pendiente sin prometer restricciones inexistentes.
- [ ] Las decisiones de negocio pendientes se identifican por dimensión y no bloquean las políticas ya definidas.

**Verificación:** Revisión de catálogo contra UI y servicios; no inferir reglas solo del nombre del campo.

**Archivos probables:**

- `docs/operating-policy-contracts.md (nuevo)`
- `components/company/operating-dimensions-section.tsx`
- `lib/services/tenant-config-service.ts`

#### Punto de control C13–C15

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

<a id="c16"></a>

### C16 — Aplicar política de estructura de compras

**Hallazgos:** H04. **Dependencias:** C15. **Tamaño:** M.

Implementar el contrato de purchasingStructure en un recorrido de solicitud/aprobación de compra; si es descriptivo, ajustar su promesa en UI.

**Criterios de aceptación:**

- [ ] La opción elegida determina exactamente las decisiones del recorrido definidas en C15.
- [ ] Las entradas alternativas de ese recorrido no evitan la política y el resultado llega a la UI.
- [ ] Hay casos para cada valor y excepción autorizada; no se alteran compras históricas implícitamente.

**Verificación:** V1 de decisiones y V2 de una compra bajo dos configuraciones; implementación supeditada al contrato de C15.

**Archivos probables:**

- `lib/services/tenant-config-service.ts`
- `Consumidor de compras identificado en C00`
- `Entrada de servidor de ese recorrido`
- `components/company/operating-dimensions-section.tsx`
- `Prueba de política de compras (nueva)`

<a id="c17"></a>

### C17 — Aplicar política de producción de alimentos

**Hallazgos:** H04. **Dependencias:** C15. **Tamaño:** M.

Conectar foodProduction al recorrido de producción/abastecimiento definido o tratarla como descripción de la operación.

**Criterios de aceptación:**

- [ ] Cada valor produce el comportamiento especificado o una etiqueta descriptiva honesta.
- [ ] El alcance de cocina/sucursal se verifica en servidor y las excepciones están definidas.
- [ ] Un caso controlado demuestra el efecto sin duplicar movimientos de inventario.

**Verificación:** V1 de reglas y V2 del recorrido de producción identificado; no crear un segundo motor de movimientos.

**Archivos probables:**

- `lib/services/tenant-config-service.ts`
- `Consumidor de producción identificado en C00`
- `Entrada del recorrido de producción`
- `components/company/operating-dimensions-section.tsx`
- `Prueba de política de producción (nueva)`

<a id="c18"></a>

### C18 — Aplicar política de tesorería

**Hallazgos:** H04. **Dependencias:** C15. **Tamaño:** M.

Conectar treasuryModel al alcance de autorización/ejecución de una operación de tesorería definida.

**Criterios de aceptación:**

- [ ] La configuración limita quién puede ejecutar la operación según C15.
- [ ] Un intento por API o acción respeta la misma restricción que la pantalla.
- [ ] Los cambios de política no invalidan estados históricos sin una transición definida.

**Verificación:** V1 de autorización y V2 de operación de tesorería; los permisos de seguridad siguen siendo obligatorios.

**Archivos probables:**

- `lib/services/tenant-config-service.ts`
- `Consumidor de tesorería identificado en C00`
- `Entrada del recorrido de tesorería`
- `components/company/operating-dimensions-section.tsx`
- `Prueba de política de tesorería (nueva)`

#### Punto de control C16–C18

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

<a id="c19"></a>

### C19 — Aplicar política de pagos a proveedores

**Hallazgos:** H04. **Dependencias:** C15. **Tamaño:** M.

Conectar supplierPayment al recorrido de programación/aprobación de pago definido, preservando separación con tesorería.

**Criterios de aceptación:**

- [ ] Cada valor tiene un efecto observable sobre el pago o se presenta como descriptivo.
- [ ] La regla se aplica en servidor con empresa y proveedor verificados.
- [ ] La operación y sus excepciones conservan trazabilidad y no duplican pagos.

**Verificación:** V1 de decisiones e idempotencia y V2 del recorrido de pago.

**Archivos probables:**

- `lib/services/tenant-config-service.ts`
- `Consumidor de pago a proveedores identificado en C00`
- `Entrada del recorrido de pago`
- `components/company/operating-dimensions-section.tsx`
- `Prueba de política de pagos (nueva)`

<a id="c20"></a>

### C20 — Aplicar política de autonomía del gerente

**Hallazgos:** H04. **Dependencias:** C15, C16. **Tamaño:** M.

Relacionar managerAutonomy con los permisos de decisión definidos y los límites monetarios existentes sin imponer una segunda política contradictoria.

**Criterios de aceptación:**

- [ ] Cada nivel de autonomía define qué puede decidir el gerente y cuándo escala.
- [ ] Autonomía, permisos y límites monetarios se combinan de forma documentada en servidor.
- [ ] Un intento equivalente por otra entrada no evita la escalada.

**Verificación:** V1 de matriz de niveles/montos/roles y V2 de autorización/escalada.

**Archivos probables:**

- `lib/services/tenant-config-service.ts`
- `lib/services/expense-service.ts`
- `Consumidor de aprobación identificado en C00`
- `components/company/operating-dimensions-section.tsx`
- `Prueba de autonomía (nueva)`

<a id="c21"></a>

### C21 — Aplicar política de dispersión de nómina

**Hallazgos:** H04. **Dependencias:** C15. **Tamaño:** M.

Precisar y aplicar payrollDispersion al recorrido soportado de nómina/exportación, o etiquetarla como descripción si no hay ejecución de dispersión.

**Criterios de aceptación:**

- [ ] La UI no promete pagos automatizados que el producto no ejecuta.
- [ ] El comportamiento definido respeta empresa, sucursal y permiso de nómina.
- [ ] Un caso de cada modalidad demuestra resultado o clasificación descriptiva sin enviar dinero real.

**Verificación:** V1 y V2 con fixtures de nómina y adaptadores simulados.

**Archivos probables:**

- `lib/services/tenant-config-service.ts`
- `Consumidor de nómina identificado en C00`
- `Entrada del recorrido de nómina`
- `components/company/operating-dimensions-section.tsx`
- `Prueba de política de nómina (nueva)`

#### Punto de control C19–C21

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

<a id="c22"></a>

### C22 — Aplicar política del tipo de empresa

**Hallazgos:** H04. **Dependencias:** C15. **Tamaño:** M.

Definir si tenantType altera agregación, visibilidad o segmentación; aplicar solo los efectos acordados.

**Criterios de aceptación:**

- [ ] Se define cómo distinguir sucursales propias/franquiciadas antes de modificar agregaciones.
- [ ] Las vistas del recorrido elegido cumplen la segmentación sin ampliar acceso a datos.
- [ ] Cada valor tiene casos de inclusión/exclusión o queda expresamente descriptivo.

**Verificación:** V1 de segmentación y V2 de vista de grupo; comprobar que existe el atributo necesario de sucursal.

**Archivos probables:**

- `lib/services/tenant-config-service.ts`
- `lib/services/cross-branch-service.ts`
- `Consumidor de alcance identificado en C00`
- `components/company/operating-dimensions-section.tsx`
- `Prueba de tipo de empresa (nueva)`

<a id="c23"></a>

### C23 — Resolver el límite de caja chica

**Hallazgos:** H04. **Dependencias:** C15. **Tamaño:** M.

Definir cómo pettyCashLimitCents se relaciona con apertura/reposición de fondos y aplicar ese contrato sin sustituir los límites ya consumidos de gastos.

**Criterios de aceptación:**

- [ ] Se distingue límite del fondo, límite por gasto y límite de aprobación.
- [ ] La operación definida aplica el límite en servidor o el ajuste se declara descriptivo.
- [ ] Cero, null, excepciones y fondos existentes tienen comportamiento documentado y verificable.

**Verificación:** V1 de límites y V2 del recorrido de caja chica, sin duplicar su servicio.

**Archivos probables:**

- `lib/services/tenant-config-service.ts`
- `Consumidor de caja chica identificado en C00`
- `app/api/company/operating-config/route.ts`
- `components/company/operating-config-form.tsx`
- `Prueba de límite de caja chica (nueva)`

#### Punto de control C22–C23

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

**Puerta de fase:** revisar build/lint y regresiones pertinentes; conservar evidencia de la entrega indicada al inicio.

## Fase 4 — Workflows y verificación

**Entrega:** Las escrituras respetan el contrato del paso y sus efectos son recuperables.

<a id="c24"></a>

### C24 — Validar el contrato del paso en servidor

**Hallazgos:** H08. **Dependencias:** C05. **Tamaño:** M.

Validar estado, requerido, tipo, límites y evidencia usando la definición aplicable a la instancia antes de persistir.

**Criterios de aceptación:**

- [ ] No se completa un paso requerido con un payload vacío, inválido o sin evidencia exigida.
- [ ] La misma regla protege API, acciones e integraciones internas que actualicen pasos.
- [ ] La UI recibe un error corregible; SKIPPED y transiciones permitidas tienen autorización explícita.

**Verificación:** V1 con payloads malformados y llamada directa al servidor; V2 de rechazo/corrección/completado.

**Archivos probables:**

- `lib/services/workflow-execution-service.ts`
- `app/api/workflows/executions/[id]/steps/[stepId]/route.ts`
- `components/workflow/workflow-executor.tsx`
- `tests/workflows/step-contract.test.ts (nuevo)`

<a id="c25"></a>

### C25 — Transmitir configuración de IA a la ejecución

**Hallazgos:** H07. **Dependencias:** C24. **Tamaño:** M.

Pasar aiConfig de la plantilla/instancia al adaptador y definir defaults, proveedor alternativo y límite efectivo de reintentos.

**Criterios de aceptación:**

- [ ] El proveedor configurado se utiliza en ambas vías de verificación actuales.
- [ ] Proveedor alternativo y reintentos tienen una semántica efectiva y no multiplican los reintentos de Inngest.
- [ ] Una configuración inválida falla de forma explícita; las credenciales permanecen en servidor.

**Verificación:** V1 con adaptadores simulados y conteo de llamadas; V2 de guardar configuración y verificar su uso.

**Archivos probables:**

- `lib/services/workflow-execution-service.ts`
- `lib/services/verification-engine.ts`
- `lib/services/ai-service.ts`
- `components/builder/workflow-settings-modal.tsx`
- `tests/workflows/ai-config.test.ts (nuevo)`

<a id="c26"></a>

### C26 — Conservar confianza mínima en el veredicto IA

**Hallazgos:** H07. **Dependencias:** C25. **Tamaño:** M.

Combinar confianza, resultado específico y autoaprobación como condiciones explícitas para impedir que una rama sobrescriba un rechazo obligatorio.

**Criterios de aceptación:**

- [ ] Calidad o seguridad favorables no autoaprueban cuando no se cumple la confianza requerida.
- [ ] Cada resultado conserva motivo, proveedor, confianza y necesidad de revisión.
- [ ] Los casos frontera de confianza y autoApprove tienen resultado determinista.

**Verificación:** V1 con resultados de calidad/seguridad y confianza debajo/igual/encima del mínimo.

**Archivos probables:**

- `lib/services/verification-engine.ts`
- `lib/types/ai-verification.ts`
- `tests/workflows/verification-verdict.test.ts (nuevo)`

#### Punto de control C24–C26

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

<a id="c27"></a>

### C27 — Hacer única la transición de finalización

**Hallazgos:** H10. **Dependencias:** C24. **Tamaño:** M.

Establecer una transición atómica al completar y claves de idempotencia para completionActions, evitando repetir efectos frente a concurrencia.

**Criterios de aceptación:**

- [ ] Dos solicitudes concurrentes producen una sola transición lógica a completado.
- [ ] Cada acción con efectos tiene una clave estable y repetir la evaluación no duplica el efecto.
- [ ] Un error de acción queda registrado con estado recuperable en vez de desaparecer en un log.

**Verificación:** V3 de concurrencia/reintento y fallo de una acción; separar migración aditiva si resulta necesaria.

**Archivos probables:**

- `lib/services/workflow-execution-service.ts`
- `lib/services/workflow-action-runner.ts`
- `lib/db/schema.ts`
- `tests/workflows/completion-idempotency.test.ts (nuevo)`

<a id="c28"></a>

### C28 — Garantizar entrega de eventos y mostrar efectos pendientes

**Hallazgos:** H10. **Dependencias:** C27. **Tamaño:** M.

Persistir intención de publicación junto con la transición y entregar con reintentos; mostrar estado de extracción/acciones por separado del avance de pasos.

**Criterios de aceptación:**

- [ ] Un fallo entre commit y envío no pierde el evento: la entrega puede recuperarse mediante outbox o mecanismo durable equivalente.
- [ ] Entrega repetida no duplica movimientos/documentos y un fallo terminal tiene estado visible.
- [ ] El usuario distingue pasos completados, efectos pendientes y efectos fallidos con una vía autorizada de recuperación.

**Verificación:** V3 de caída antes/después del envío y entrega duplicada; V2 del estado de procesamiento. Si backend y UI exceden cinco archivos, dividir entrega y presentación antes de ejecutar.

**Archivos probables:**

- `lib/services/workflow-execution-service.ts`
- `lib/inngest/functions/workflow-extractors.ts`
- `lib/db/schema.ts`
- `Vista de ejecución identificada en C00`
- `tests/workflows/completion-delivery.test.ts (nuevo)`

#### Punto de control C27–C28

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

**Puerta de fase:** revisar build/lint y regresiones pertinentes; conservar evidencia de la entrega indicada al inicio.

## Fase 5 — Métricas consistentes

**Entrega:** Las pantallas comparten definiciones y distinguen datos reales, estimados y ausentes.

<a id="c29"></a>

### C29 — Compartir definiciones financieras entre motores

**Hallazgos:** H06. **Dependencias:** C14. **Tamaño:** M.

Reutilizar base de ventas, carga laboral y objetivos en la vista de sucursales, preservando procedencia y conceptos distintos.

**Criterios de aceptación:**

- [ ] Mismo periodo, sucursal y datos producen métricas comparables con la misma base y fórmula.
- [ ] IVA, carga laboral y objetivos configurados afectan ambas vistas coherentemente.
- [ ] Las diferencias legítimas de concepto se nombran en la interfaz en lugar de ocultarse bajo el mismo indicador.

**Verificación:** V1 con fixtures de ventas/costos y conciliación entre motores; considerar duplicación de merma al elegir numeradores.

**Archivos probables:**

- `lib/services/cross-branch-service.ts`
- `lib/services/financial-kpi-service.ts`
- `lib/services/sales-base.ts`
- `lib/services/labor-burden.ts`
- `tests/finance/branch-kpi-consistency.test.ts (nuevo)`

<a id="c30"></a>

### C30 — Distinguir dato real, estimado y ausente

**Hallazgos:** H06. **Dependencias:** C29. **Tamaño:** M.

Reemplazar porcentajes saludables por estados de calidad explícitos cuando faltan ventas, costos o evidencias de cumplimiento.

**Criterios de aceptación:**

- [ ] Ausencia de ventas/costos nunca se presenta como VERIFIED ni con un porcentaje operativo inventado.
- [ ] Toda estimación muestra fuente y metodología; dato real y cero real se distinguen de ausencia.
- [ ] Indicadores de cumplimiento sin evidencias muestran ausencia de datos en lugar de 100 por defecto.

**Verificación:** V1 con conjunto vacío, ventas sin costos, cero real y datos completos; V2 de representación.

**Archivos probables:**

- `lib/services/cross-branch-service.ts`
- `app/dashboard/branches/page.tsx`
- `Componente de indicadores identificado en C00`
- `tests/finance/data-quality.test.ts (nuevo)`

<a id="c31"></a>

### C31 — Verificar efecto financiero desde configuración hasta pantalla

**Hallazgos:** H05, H06. **Dependencias:** C30. **Tamaño:** S.

Cerrar un recorrido controlado de cambio de parámetro y consulta de métricas, sin reinterpretar periodos cerrados de forma implícita.

**Criterios de aceptación:**

- [ ] Cambiar un parámetro permitido modifica las métricas que su contrato declara.
- [ ] La recarga conserva configuración, procedencia y unidad del indicador.
- [ ] Un usuario no autorizado no cambia parámetros y el historial permite explicar el resultado.

**Verificación:** V2 desde configuración a vista financiera/sucursales con datos conocidos.

**Archivos probables:**

- `tests/e2e/financial-policy-effect.spec.ts (nuevo)`
- `docs/operating-policy-contracts.md (nuevo)`

#### Punto de control C29–C31

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

**Puerta de fase:** revisar build/lint y regresiones pertinentes; conservar evidencia de la entrega indicada al inicio.

## Fase 6 — Notificaciones verificables

**Entrega:** Las preferencias gobiernan el envío y cada canal tiene un resultado trazable.

<a id="c32"></a>

### C32 — Unificar contrato de preferencias de notificación

**Hallazgos:** H09. **Dependencias:** C00. **Tamaño:** M.

Elegir un contrato canónico, hacer compatibles las tres APIs y cargar preferencias persistidas antes de editar.

**Criterios de aceptación:**

- [ ] Las tres entradas autorizan al mismo usuario y usan la misma semántica de campos.
- [ ] Guardar/recargar conserva canales y preferencias por tipo, incluidos stock y turnos.
- [ ] Un error de carga no muestra defaults como si fueran las preferencias guardadas.

**Verificación:** V1 de contratos compatibles y V2 de desactivar/guardar/recargar.

**Archivos probables:**

- `app/api/notifications/preferences/route.ts`
- `app/api/profile/notification-preferences/route.ts`
- `app/api/users/profile/preferences/route.ts`
- `components/profile/notification-preferences.tsx`
- `tests/notifications/preferences-contract.test.ts (nuevo)`

<a id="c33"></a>

### C33 — Aplicar una sola decisión de canal

**Hallazgos:** H09. **Dependencias:** C32. **Tamaño:** M.

Hacer efectiva la decisión de routing, preferencias y horario en el dispatcher, con zona horaria y excepciones definidas.

**Criterios de aceptación:**

- [ ] Los canales calculados por el router son exactamente los intentados por el dispatcher.
- [ ] Stock y recordatorios de turnos respetan preferencias por tipo; las excepciones están documentadas.
- [ ] Fuera de horario se aplica la política definida usando zona horaria del contexto, sin depender de la del proceso.

**Verificación:** V1 por tipo/canal/horario con adaptadores simulados y reloj controlado.

**Archivos probables:**

- `lib/notifications/notification-router.ts`
- `lib/services/notification-dispatcher.ts`
- `tests/notifications/routing-policy.test.ts (nuevo)`

<a id="c34"></a>

### C34 — Registrar fallos y reintentar por canal

**Hallazgos:** H09. **Dependencias:** C33. **Tamaño:** M.

Inspeccionar resultados de envío y permitir que Inngest reintente fallos transitorios sin reenviar canales ya exitosos.

**Criterios de aceptación:**

- [ ] Cada canal devuelve resultado verificable; registrar texto no cuenta como email enviado.
- [ ] Un fallo parcial no se presenta como éxito total ni se absorbe sin estado.
- [ ] Reintentar conserva canales exitosos y distingue error transitorio de terminal.

**Verificación:** V3 con email fallido y WhatsApp exitoso, recuperación y agotamiento; usar adaptadores simulados sin mensajes reales.

**Archivos probables:**

- `lib/services/notification-dispatcher.ts`
- `lib/inngest/functions/notification-dispatch.ts`
- `lib/notifications/notification-router.ts`
- `tests/notifications/channel-retry.test.ts (nuevo)`

#### Punto de control C32–C34

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

<a id="c35"></a>

### C35 — Consolidar productores de notificaciones activos

**Hallazgos:** H09. **Dependencias:** C34. **Tamaño:** M por productor.

Migrar productores de NotificationService y NotificationDispatcher por evento a la misma decisión de envío sin cambiar todos de una vez.

**Criterios de aceptación:**

- [ ] Hay un inventario de productores activos y una ruta efectiva por tipo de evento.
- [ ] Cada productor migrado conserva destinatarios, preferencias e idempotencia.
- [ ] El recorrido de prueba no genera dos notificaciones para una sola ocurrencia.

**Verificación:** V1/V3 por productor migrado. Abrir una subtarea por productor; máximo dos productores y cinco archivos por sesión.

**Archivos probables:**

- `lib/services/notification-service.ts`
- `lib/services/notification-dispatcher.ts`
- `Un productor activo identificado en C00`
- `Prueba del productor migrado (nueva)`

#### Punto de control C35–C35

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

**Puerta de fase:** revisar build/lint y regresiones pertinentes; conservar evidencia de la entrega indicada al inicio.

## Fase 7 — Consolidación y cierre

**Entrega:** Se retira implementación anterior con evidencia y se demuestra el recorrido completo.

<a id="c36"></a>

### C36 — Clasificar implementación anterior y módulos sin uso

**Hallazgos:** H11, H12. **Dependencias:** C00. **Tamaño:** M.

Documentar importadores, registros, consumidores externos conocidos y estado de cada candidato antes de eliminarlo.

**Criterios de aceptación:**

- [ ] Cada candidato tiene categoría activo, compatible, prototipo, prueba o retirado, con evidencia y responsable.
- [ ] Se revisan registros Inngest, scripts e integraciones además de importaciones del frontend.
- [ ] No se fusionan ventas/cortes, RH/compras ni periodos distintos por similitud de nombres.

**Verificación:** Inspección de grafo/importaciones y configuración, sin tomar falta de llamadas internas como prueba de ausencia externa.

**Archivos probables:**

- `docs/backend-module-inventory.md (nuevo)`
- `lib/inngest/functions/index.ts`
- `lib/whatsapp/client-factory.ts`
- `tasks/plan-conexion-frontend-backend.md`

<a id="c37"></a>

### C37 — Retirar el executor anterior confirmado sin consumidores

**Hallazgos:** H11. **Dependencias:** C28, C36. **Tamaño:** M.

Desactivar gradualmente el endpoint y función anteriores o migrar sus consumidores si el inventario confirma uso.

**Criterios de aceptación:**

- [ ] Se identifica el tratamiento de cada consumidor antes de retirar el registro.
- [ ] El executor actual y extractores continúan funcionando y los eventos pendientes tienen destino definido.
- [ ] Existe una vía de reversión y no queda una función registrada esperando un evento sin productor.

**Verificación:** V3 del registro y eventos, V2 del executor vigente; decisión basada en evidencia de C36.

**Archivos probables:**

- `app/api/workflow/route.ts`
- `lib/inngest/functions/workflow-executor.ts`
- `lib/inngest/functions/index.ts`
- `lib/inngest/events.ts`
- `tests/workflows/legacy-retirement.test.ts (nuevo)`

<a id="c38"></a>

### C38 — Resolver componentes y servicios huérfanos por lote

**Hallazgos:** H12. **Dependencias:** C36. **Tamaño:** S/M por lote.

Conectar únicamente los candidatos con recorrido de producto definido; retirar o aislar prototipos confirmados, incluidos consumidores de endpoints ausentes.

**Criterios de aceptación:**

- [ ] Cada candidato elegido tiene resultado: conectado con prueba, aislado como demostración o retirado.
- [ ] Las pantallas activas no llaman endpoints inexistentes ni muestran acciones inertes.
- [ ] Eliminar un candidato no rompe scripts, tests, imports o integraciones confirmadas.

**Verificación:** Búsqueda de consumidores y V2 solo para flujos activados. Máximo tres candidatos relacionados por lote; pruebas nuevas solo donde verifican comportamiento.

**Archivos probables:**

- `Uno a tres candidatos del inventario de C36`
- `Prueba del recorrido conectado cuando corresponda`

#### Punto de control C36–C38

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

<a id="c39"></a>

### C39 — Alinear documentación y punto de entrada del esquema

**Hallazgos:** H12. **Dependencias:** C36. **Tamaño:** M.

Actualizar referencias del proveedor WhatsApp y del esquema para que describan el código vigente; decidir aparte una migración modular completa si hace falta.

**Criterios de aceptación:**

- [ ] AGENTS y guías describen la integración activa y distinguen rutas compatibles.
- [ ] La documentación del esquema indica el punto de entrada efectivo sin sugerir imports incompletos.
- [ ] Este cambio no altera proveedores ni mueve tablas; una migración estructural requiere inventario y tarea propia.

**Verificación:** Validar enlaces y imports mencionados contra el código; V0 si se modifica un import real.

**Archivos probables:**

- `AGENTS.md`
- `lib/db/schema.ts`
- `docs/admin-guide.md`
- `docs/user-guide.md`
- `docs/backend-module-inventory.md (nuevo)`

<a id="c40"></a>

### C40 — Cerrar la auditoría con evidencia de recorridos

**Hallazgos:** H01, H02, H03, H04, H05, H06, H07, H08, H09, H10, H11, H12. **Dependencias:** todas las tareas C00–C39. **Tamaño:** M.

Actualizar cada hallazgo con pruebas, decisiones de alcance y límites restantes; registrar una comprobación completa en entorno aislado.

**Criterios de aceptación:**

- [ ] Los doce hallazgos tienen estado y evidencia; una clasificación descriptiva se distingue de una política implementada.
- [ ] Los recorridos de turnos, configuración, workflow, finanzas y notificación se verifican con dos empresas y roles distintos.
- [ ] Build, lint y pruebas requeridas tienen resultados registrados; fallos preexistentes o bloqueos no se presentan como aprobados.

**Verificación:** V0 + suites afectadas + V2/V3 de aceptación; informe final de cambios y limitaciones.

**Archivos probables:**

- `docs/audits/2026-10-10-backend-frontend-wiring-audit.md`
- `tasks/todo-conexion-frontend-backend.md`
- `docs/backend-module-inventory.md (nuevo)`
- `docs/operating-policy-contracts.md (nuevo)`

#### Punto de control C39–C40

- [ ] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [ ] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

**Puerta de fase:** revisar build/lint y regresiones pertinentes; conservar evidencia de la entrega indicada al inicio.

## Cobertura de la auditoría

| Hallazgo | Tareas de resolución |
| --- | --- |
| H01 | [C01](#c01), [C02](#c02) |
| H02 | [C03](#c03), [C04](#c04), [C05](#c05), [C06](#c06), [C07](#c07) |
| H03 | [C08](#c08), [C10](#c10), [C11](#c11), [C12](#c12) |
| H04 | [C15](#c15), [C16](#c16), [C17](#c17), [C18](#c18), [C19](#c19), [C20](#c20), [C21](#c21), [C22](#c22), [C23](#c23) |
| H05 | [C13](#c13), [C14](#c14), [C31](#c31) |
| H06 | [C29](#c29), [C30](#c30), [C31](#c31) |
| H07 | [C25](#c25), [C26](#c26) |
| H08 | [C09](#c09), [C24](#c24) |
| H09 | [C32](#c32), [C33](#c33), [C34](#c34), [C35](#c35) |
| H10 | [C27](#c27), [C28](#c28) |
| H11 | [C36](#c36), [C37](#c37) |
| H12 | [C36](#c36), [C38](#c38), [C39](#c39) |

C00 establece contexto y C40 verifica el cierre de todos los hallazgos. No se cierra un hallazgo por la existencia de un campo, servicio o tabla sin verificar su recorrido.

## Decisiones de negocio que deben quedar explícitas

Estas decisiones se registran en C15. No se necesitan para guardar el plan ni para comenzar las correcciones P0; sí deben resolverse antes de activar sus efectos.

| Decisión | Entregable requerido | Qué puede avanzar mientras se define |
| --- | --- | --- |
| Efecto de cada dimensión del Modelo Operativo | Casos por valor, excepciones, alcance y clasificación aplicada/descriptiva | Permisos, turnos, formularios y validación de políticas existentes. |
| Autonomía del gerente | Relación entre rol, monto, nivel y escalada | C13 y los límites monetarios ya consumidos. |
| Tesorería y pago a proveedores | Quién solicita, aprueba y ejecuta por modalidad | Contratos y controles de acceso. |
| Producción centralizada | Recorrido y movimientos que realmente soporta el producto | Validación e idempotencia del motor actual. |
| Dispersión de nómina | Descripción, exportación o ejecución real; responsables | Aislamiento y datos de RH. |
| Empresa propia, franquicia o mixta | Atributo de sucursal y criterio de agregación | Seguridad por empresa y fórmulas comunes. |
| Límite de caja chica | Fondo máximo, límite por gasto, reposición y excepción | Flujo actual de gastos y aprobaciones. |
| Parámetros fiscales/laborales | Valores permitidos, responsable, vigencia y periodos cerrados | Preservación de valores y exposición del contrato. |
| Horarios y urgencias de notificaciones | Zona horaria, qué se difiere y excepciones a preferencias | C32 y resultados por canal. |
| Executor/rutas anteriores | Consumidores externos, eventos pendientes y transición | Inventario C36 y garantías del executor actual. |

## Riesgos y mitigaciones

| Riesgo concreto | Mitigación |
| --- | --- |
| Proteger una ruta y dejar abierta la acción equivalente | Inventario por recorrido y pruebas de todas las entradas, no solo del frontend. |
| Doble ejecución durante transición | Claves idempotentes, transición única y pruebas de entrega duplicada. |
| Recalcular historia al cambiar IVA/carga laboral | Definir vigencia y política de periodos cerrados antes de activar efectos. |
| Fusión de servicios que representan hechos distintos | Clasificar responsabilidad y conciliar cifras antes de consolidar. |
| Eliminación de una ruta con consumidor externo | Inventario, compatibilidad temporal y evidencia de retirada. |
| Planes antiguos que declaran trabajo completo sin recorrido actual | Vincular cada tarea a evidencia actual y conservar la historia sin duplicar trackers. |
| Crecimiento de una tarea por necesidades de esquema o UI | Separar migración/contrato/recorrido en subtareas de hasta cinco archivos antes de comenzar. |
| Pruebas mezcladas con una base compartida | Fixtures de dos empresas en entorno aislado y adaptadores sin entregas reales. |

## Definición de terminado

- [ ] Las entradas relevantes autorizan identidad, empresa, sucursal y operación en servidor.
- [ ] Los recorridos activos usan datos reales dentro de su alcance y muestran carga, vacío, error y éxito.
- [ ] Cada ajuste expuesto tiene un consumidor verificable o una clasificación descriptiva clara.
- [ ] Todas las escrituras relevantes aplican validación común, independientemente de su origen.
- [ ] Los indicadores comparten definiciones y explican procedencia/ausencia del dato.
- [ ] Los efectos de workflows y notificaciones son idempotentes, trazables y recuperables.
- [ ] La implementación anterior retirada tiene evidencia de consumidores y transición.
- [ ] Las tareas y los hallazgos tienen resultados de verificación registrados, incluyendo límites pendientes.

## Primer bloque de ejecución

Empezar por C00, C01 y C02: documentar la línea base y asegurar lectura/escritura de turnos con dos empresas. La primera entrega debe demostrar que un usuario autorizado opera sobre sus turnos y que un usuario de otra empresa o sin permiso no puede hacerlo. Después seguir C03–C07 antes de ampliar funcionalidad.
