# Plan de conexión entre frontend y backend — Pulso HORECA

Fecha: 10 de octubre de 2026. Actualización: 16 de octubre de 2026. Estado: C00–C33 implementadas con límites registrados en el seguimiento; C12 se cierra con la entrega de C11. C34–C40 pendientes.

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

- [x] Los cuatro parámetros se pueden consultar, editar y recargar con unidades y rangos explícitos.
- [x] Solo el rol definido puede modificarlos y queda historial de actor y cambio.
- [x] Un caso controlado demuestra el efecto de cada parámetro; se define vigencia y tratamiento de periodos cerrados antes de habilitar efectos históricos.

**Verificación:** V1 de contrato y efectos en consumidores; V2 de edición/recarga. Si la vigencia requiere migración, separarla antes de ampliar esta tarea.

**Evidencia (12-10-2026):** [C14 — Parámetros consumidos sin editor](../docs/audits/2026-10-12-parametros-consumidos.md). 38 casos unitarios de las tres subtareas (14 de efecto por parámetro sobre su consumidor real, 14 de historial, 10 de contrato) y 4 pruebas de navegador nuevas; suite unitaria 962 aprobadas (una omitida y un TODO), 34/34 en Chromium, build y tsc limpios. Límites: el navegador usa respuestas simuladas, el historial es de mejor esfuerzo y no tiene pantalla, y la vigencia quedó **definida y no resuelta** —los KPIs recalculan en vivo y `getPnLSnapshots` no tiene consumidores, así que los efectos históricos esperan a C29–C31.

**Desglose ejecutado (12-10-2026):** C14.1 contrato y formulario (`17c1436`); C14.2 historial de actor y cambio, con migración aditiva 0093 aplicada y comprobada en la base (`a3dd639`); C14.3 efectos y vigencia (`1ec2c81`).

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

**Subtareas de implementación (13-10-2026):** el borrador local ya abarca más de cinco archivos y se completa en tres cortes antes de ampliar su alcance:

- **C15.1 — Catálogo y consumidores:** revisar `lib/company/operating-policy-catalog.ts`, sus pruebas, `lib/services/tenant-config-service.ts` y el contrato en `docs/operating-policy-contracts.md`. Registrar decisiones por dimensión y los límites reales de los cuatro umbrales aplicados.
- **C15.2 — Promesas de la interfaz:** completar las secciones de dimensiones y umbrales, y verificar sus estados y guardado/recarga en `tests/e2e/operating-config.spec.ts`. Cargar los estilos reales en `tests/support/shifts-browser-server.ts` para comprobar el diseño adaptable, además del DOM. Los valores descriptivos conservan su contrato de persistencia (cuatro archivos en este corte).
- **C15.3 — Evidencia y seguimiento:** registrar resultados y límites en la auditoría de C15, este plan, el seguimiento y el handoff. C16–C23 conservan sus decisiones de negocio pendientes.

**Criterios de aceptación:**

- [x] Cada valor tiene un caso dado/cuando/entonces o queda clasificado como descriptivo.
- [x] La UI distingue aplicada, descriptiva y pendiente sin prometer restricciones inexistentes.
- [x] Las decisiones de negocio pendientes se identifican por dimensión y no bloquean las políticas ya definidas.

**Verificación:** Revisión de catálogo contra UI y servicios; no inferir reglas solo del nombre del campo.

**Corte de implementación (13-10-2026):** C15 no cambia comportamiento —es catálogo y promesas de interfaz—. El catálogo `lib/company/operating-policy-catalog.ts` clasifica trece entradas —siete dimensiones, cinco umbrales y el de caja chica— y la prueba lo ata al árbol de código: cada `aplicada` nombra un consumidor cuyo símbolo está declarado, y cada `descriptiva` no aparece fuera de esquema, API, formulario y semillas. Resultado: cuatro `aplicada` (los dos de autorización de gastos, el de emergencias y el de merma de cortesías), seis `descriptiva` (cinco dimensiones más caja chica) y dos `pendiente` (`managerAutonomy`, `tenantType`). Se corrigieron cuatro promesas falsas de la pantalla, entre ellas la doble firma que el producto no ejecuta y el «monto máximo» de caja chica que no limita nada.

**Evidencia (13-10-2026):** [C15 — Catálogo de políticas operativas](../docs/audits/2026-10-13-operating-policy-catalog.md). 23 casos unitarios del catálogo y 4 pruebas de Chromium; suite 1019 aprobadas (una omitida y un TODO), 42/42 en la configuración aislada, build y tsc limpios. Límites: el navegador intercepta `GET`/`PUT` sin Next ni autenticación, y el escáner del catálogo es textual —no demuestra efecto de ejecución, sólo que nadie declara el consumidor—.

**Desglose ejecutado (13-10-2026):** catálogo y contrato (`c153cc7`); C16.1, que reutiliza el catálogo para exponer la matriz de aprobadores OC y no altera ninguna dimensión, queda en `3b0742d` y se registra en la fila de C16.

**Archivos probables:**

- `docs/operating-policy-contracts.md (nuevo)`
- `components/company/operating-dimensions-section.tsx`
- `lib/services/tenant-config-service.ts`

#### Punto de control C13–C15

- [x] Criterios del bloque verificados con resultados registrados.
- [ ] Recorrido válido y rechazo autorizado comprobados cuando correspondan. La autorización de la pantalla sigue en pruebas unitarias sobre la ruta real: no hay recorrido con Next y Postgres para esta página.
- [x] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

<a id="c16"></a>

### C16 — Aplicar política de estructura de compras

**Hallazgos:** H04. **Dependencias:** C15. **Tamaño:** M.

Implementar el contrato de purchasingStructure en un recorrido de solicitud/aprobación de compra; si es descriptivo, ajustar su promesa en UI.

**Decisión de producto (13-10-2026):** el usuario pide que cada empresa elija sus responsables desde Configuración operativa; no necesita fijar una matriz universal durante esta sesión. Se reutiliza la matriz OC existente para roles aprobadores, rangos y niveles. La modalidad declarada no concede permisos por sí sola.

**Cortes antes de implementar:**

- **C16.1 — Aprobadores configurables:** integrar el editor OC existente en Configuración operativa con guardado propio, errores y recarga. Corregir la promesa sobre rangos sin cobertura; comprobar el recorrido con respuestas controladas. Cinco archivos: sección nueva, página, editor existente, soporte de navegador y spec.
- **C16.2 — Solicitud, emisión y delegación:** definir y conectar controles configurables por empresa para estas acciones y para sucursales/categorías; respetar RBAC, presupuestos, emergencias y entradas alternativas. No inferirlos de CENTRALIZADA/POR_SUCURSAL/HIBRIDO.
- **C16.3 — Verificación del recorrido:** comprobar la matriz guardada en la solicitud y aprobación reales con dos empresas y conservar las decisiones de órdenes ya enviadas. C16 permanece abierta hasta cerrar el recorrido completo.

**Investigación de C16.2 (13-10-2026) — el recorrido y lo que le falta.** El camino es: solicitud (`POST /api/inventory/purchase-orders` con `type=requisition` → `createRequisition`, o `type=po` → `createPO` en borrador) → envío a aprobación (`submitForApproval`, que ya valida matriz, presupuesto y tope de emergencias) → aprobación por niveles → **emisión** (`action: "send"` → `sendPO`). El recorrido tiene tres huecos que hay que cerrar antes de poder aplicar cualquier política:

1. **Escrituras sin empresa verificada.** `sendPO` y las demás transiciones de estado buscan la orden por id sin comprobar de qué empresa es; el `PATCH` acepta `items` y cambios de detalle por el mismo camino. Crear una solicitud o una orden acepta un `branchId` del cuerpo sin comprobar que sea de la empresa, y un `requisitionId` de otra empresa que además se marca `CONVERTED`. Sin esto, una política de delegación decidiría sobre una sucursal u orden que el actor no controla.
2. **No hay control de responsable.** Sólo `inventory:create` para solicitar y `inventory:update` para emitir. La matriz OC decide quién *aprueba*, no quién *solicita* ni quién *emite*.
3. **Entrada alternativa.** `suggested-order-service.generatePurchaseOrders` crea borradores con `requestedBy: 'system'`. No alcanza al proveedor —para eso hay que pasar por matriz y emisión—, pero tiene que quedar nombrada como tal en la política, no saltársela.

**Semántica elegida (13-10-2026).** Los controles se configuran explícitamente por empresa y acción; la modalidad (`purchasingStructure`) **no** concede permisos ni los deduce. Es la continuación de la decisión de producto de C16.1 y de la clasificación `descriptiva` del catálogo de C15: la modalidad sigue siendo una descripción, y lo que gobierna es el control explícito.

- Sin reglas para la acción: **no hay control adicional** y el RBAC vigente sigue decidiendo (`basis: "sin_controles"`). No hay semilla perezosa como en la matriz: sembrar concedería permisos que nadie eligió.
- Con reglas: la operación necesita **al menos una regla activa que la cubra** y cuyo rol exigido alcance el rol del actor (`basis: "regla"`); si las reglas existen y ninguna cubre la sucursal o la categoría, se rechaza nombrando el hueco (`basis: "sin_cobertura"`). Coherente con la matriz: lo que no cubre una regla no se improvisa.
- Un actor de sistema (`role: null`) puede crear borradores —una sugerencia del PAR—, nunca emitir.
- Los montos **no** forman parte de estos controles: pertenecen a la matriz de la C16.1 y a la autonomía del gerente de C20. Se documenta para que nadie los busque aquí.

**Cortes de C16.2 antes de implementar (13-10-2026):** el recorrido completo toca esquema, política, servicio, dos rutas, la entrada alternativa, la interfaz y sus pruebas —más de cinco archivos—, así que se divide con los mismos criterios de aceptación de C16:

- **C16.2.1 — Contrato y almacenamiento:** tabla aditiva `purchase_delegation_rules` con su enum de acción y de alcance, `lib/purchasing/delegation-policy.ts` con la resolución pura y su cargador, `GET`/`PUT /api/purchase-delegation` con permiso `settings/update` y ADMIN+, y el contrato escrito. V1 de la política y de la ruta real. No cambia ningún camino de escritura todavía.
- **C16.2.2 — Solicitud y emisión con pertenencia verificada:** `purchase-order-service` verifica sucursal, proveedor y solicitud antes de escribir y acota por empresa las transiciones; aplica el control de delegación en solicitud y emisión; `suggested-order-service` declara su actor de sistema. V1 sobre los caminos reales, con rechazo sin escritura parcial.
- **C16.2.3 — Interfaz de los controles:** sección de solicitud y emisión en Configuración operativa con guardado, error y recarga, y V2 en Chromium con el efecto visible (qué pasa hoy sin controles y qué pasa con cada regla).

**Criterios de aceptación:**

- [x] La opción elegida determina exactamente las decisiones del recorrido definidas en C15. **Resuelto por decisión (13-10-2026):** la opción elegida no determina ninguna —la modalidad es `descriptiva`— y las decisiones las determinan los controles explícitos de C16.2.1, verificados en C16.3 contra la base real.
- [x] Las entradas alternativas de ese recorrido no evitan la política y el resultado llega a la UI. Las sugerencias del PAR declaran su rol y pasan por el mismo control; un actor de sistema puede dejar borrador pero no emitir. El 403 nombra el rol mínimo o el hueco, y la tarjeta de configuración lo muestra.
- [x] Hay casos para cada valor y excepción autorizada; no se alteran compras históricas implícitamente. Casos por acción, alcance y rol en unitarias, y en C16.3 contra la base real: endurecer el control después de emitir deja la orden enviada con su fecha intacta.

**Verificación:** V1 de decisiones y V2 de una compra bajo dos configuraciones; implementación supeditada al contrato de C15.

**Ejecutado (13-10-2026):** C16.1 (matriz OC en Configuración operativa), C16.2.1 (contrato, tabla y ruta), C16.2.2 (solicitud y emisión con pertenencia verificada), C16.2.3 (interfaz) y C16.3 (recorrido con dos empresas contra la base real). Evidencia: [C16 — Política de estructura de compras](../docs/audits/2026-10-13-estructura-compras.md) — 53 casos unitarios, 8 pruebas de Chromium, 22 comprobaciones en la base real, suite 1073 aprobadas, 50/50 en la configuración aislada, migración 0095 aplicada y comprobada.

**Archivos probables:**

- `lib/purchasing/delegation-policy.ts`
- `lib/services/purchase-order-service.ts`
- `app/api/purchase-delegation/route.ts`
- `components/company/purchasing-delegation-section.tsx`
- `tests/unit/purchasing/` y `tests/e2e/operating-config.spec.ts`

<a id="c17"></a>

### C17 — Aplicar política de producción de alimentos

**Hallazgos:** H04. **Dependencias:** C15. **Tamaño:** M.

Conectar foodProduction al recorrido de producción/abastecimiento definido o tratarla como descripción de la operación.

**Investigación de C17 (13-10-2026) — el recorrido existe y sus huecos también.** El producto ya tiene el recorrido que la dimensión describe, y no hace falta uno nuevo:

1. **Producción por sucursal.** `production_orders` lleva `branchId` y `recordProduction` descuenta los insumos de los lotes **de esa misma sucursal** (FEFO con `FOR UPDATE`). La receta es de la empresa (`recipes.companyId`) y se produce en el sucursal concreto donde se registra.
2. **Abastecimiento entre sucursales = transferencias.** `inventory_transfers` ya modela el envío de una cocina a otra: solicitud → aprobación → envío (`shipTransfer` descuenta por FEFO en el origen y registra `TRANSFER` negativo) → recepción (`receiveTransfer` crea el lote destino heredando folio/vencimiento y registra `TRANSFER` positivo). Mueve stock, no lo duplica; es el motor que usaría un comisariato, y el plan prohíbe crear un segundo.
3. **No existe «cocina central» como entidad.** Ninguna columna designa a una sucursal como comisariato; `IN_SITU`/`COCINA_CENTRAL`/`MIXTO` no gobierna ninguna de estas rutas. Aplicar la dimensión deduciendo reglas del nombre del valor sería repetir H04.
4. **El recorrido tiene huecos de alcance, los mismos que C16 cerró en compras.** `POST /api/inventory/transfers` no comprueba que `toBranchId` ni los artículos pertenezcan a la empresa; `PATCH /api/inventory/transfers/[id]` busca la transferencia sólo por id, sin empresa ni rol, así que cualquier usuario autenticado de otra empresa puede aprobar, enviar o recibir una transferencia ajena. En producción, `createOrder` acepta `recipeId` ajeno y `recordProduction` con ingredientes explícitos descuenta `batchId` sin comprobar sucursal ni empresa — puede descontar lotes de otra empresa. El catálogo lo dice desde C15: la política sólo puede aplicarse donde el servidor verifica de quién es lo que decide.

**Decisión de producto (13-10-2026):** `foodProduction` sigue siendo `descriptiva` — nadie ha definido qué cocina abastece a cada sucursal ni quién autoriza, y deducirlo del nombre del valor sería el defecto que C15 clasificó. Lo que C17 sí hace es dejar el recorrido que la dimensión describe con empresa verificada en servidor (producción y transferencias), que es el criterio 2 de aceptación, y fijar en el catálogo qué faltaría para aplicarla.

**Cortes antes de implementar:**

- **C17.1 — Contrato honesto:** la entrada de `foodProduction` del catálogo queda escrita contra el recorrido real (producción por sucursal + transferencias como envío) y estrecha su decisión pendiente a lo que de verdad falta. Sin cambio de clasificación.
- **C17.2 — Producción con empresa verificada:** `createOrder` y `recordProduction` comprueban receta de la empresa y lote de la sucursal antes de escribir; rechazo sin descuento parcial.
- **C17.3 — Transferencias con empresa verificada:** creación acota destino, artículos y lotes a la empresa; listado y transiciones acotan la transferencia por empresa y exigen el lado coherente con lo que la interfaz muestra (el destino aprueba o rechaza, el origen envía, el destino recibe).
- **C17.4 — Recorrido controlado:** un caso con dos empresas demuestra el envío completo sin duplicar movimientos (un `TRANSFER` negativo en origen, un positivo en destino) y el rechazo de lo ajeno.

**Criterios de aceptación:**

- [x] Cada valor produce el comportamiento especificado o una etiqueta descriptiva honesta. `foodProduction` sigue `descriptiva` con el contrato escrito contra el recorrido real (C17.1) y la decisión pendiente reducida a lo que falta; evidencia en [C17](../docs/audits/2026-10-13-produccion-alimentos.md).
- [x] El alcance de cocina/sucursal se verifica en servidor y las excepciones están definidas. Producción y transferencias acotan empresa, sucursal, receta, artículos y lotes antes de escribir (C17.2, C17.3). Las excepciones que quedan: quien tenga `inventory:update` y vea toda la empresa opera en cualquier sucursal de su empresa; y un lote de otra sucursal se rechaza en vez de tratarse como faltante —el faltante sigue siendo merma por lote insuficiente—.
- [x] Un caso controlado demuestra el efecto sin duplicar movimientos de inventario. C17.4 contra la base real: dos empresas, envío completo con exactamente un `TRANSFER` negativo en origen y uno positivo en destino, un lote destino, y el rechazo de lo ajeno sin escribir.

**Verificación ejecutada (13-10-2026):** V1 — `tests/unit/inventory/transfer-scope.test.ts` (17) y `tests/unit/inventory/production-scope.test.ts` (11) sobre servicio y ruta reales. V2 — `tests/e2e/transfers-scope.spec.ts` (5) en Chromium con la pantalla real y la API interceptada; **el recorrido en navegador encontró un hueco que la V1 no podía ver**: una transferencia `APPROVED` no salía en ninguna pestaña, así que el origen no tenía cómo enviarla. Se añadió «Por Enviar» y hay prueba que lo fija. V3/base real — `scripts/verify-food-production-scope.ts`, 41/41. Suite completa 1101 unitarias, 55/55 en navegador, `tsc` y `build` limpios, `lint` 0 errores. Límites declarados en la [evidencia](../docs/audits/2026-10-13-produccion-alimentos.md): sin V2 de la pantalla de producción y sin responsabilidades configurables para transferencias.

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

**Investigación de C18 (13-10-2026) — la operación ya existe; el filtro, no.** La dimensión no gobierna nada hoy, pero la operación de tesorería que describe —la corrida de pago— está construida y es la única que mueve dinero del producto:

```
preparar   POST /api/finance/treasury                    → createPaymentRun + addItemToRun
autorizar  PATCH /api/finance/treasury/runs/[id]/status   → DRAFT → PENDING_APPROVAL → APPROVED
dispersar  idem                                        → APPROVED → PROCESSING → COMPLETED
liquidar   POST /api/finance/treasury/runs/[id]/items/[itemId]/settle → CONFIRMED / FAILED
descargar  GET  /api/finance/treasury/runs/[id]/layout    → archivo SPEI con las CLABEs en claro
```

Cuatro hallazgos, y ninguno es «falta la columna»:

1. **El filtro de rol vive en la ruta, no en la operación.** `updatePaymentRunStatus` y `settlePaymentRunItem` reciben `userId` y nada más: la comprobación de que sólo `ADMIN`/`OWNER`/`SUPER_ADMIN` mueven dinero está en `PATCH .../status`, en el cuerpo de la ruta. Quien llame al servicio por otra entrada —una acción de servidor, un script, un workflow— salta el filtro. `addItemToRun` sí lleva `companyId` desde la sesión (G1.2), pero el rol no viaja: es la mitad de una regla.
2. **La pantalla no sabe qué puede el operador.** `payment-run-detail.tsx` decide los botones por `run.status` y nada más: un `GERENTE` —que sí puede abrir la corrida porque tiene `reports:read`— ve «Aprobar Corrida (Firma)», «Iniciar Dispersión», «Cerrar y Liquidar» y el diálogo de liquidación, y cada clic vuelve con un 403. El botón existe porque el servidor lo va a rechazar. Éste es el criterio 2 de aceptación roto en la dirección segura: la restricción no está en la pantalla.
3. **El detalle de la corrida se lee sin empresa.** `getPaymentRunDetails(paymentRunId)` busca por id, trae partidas, facturas, nómina y gastos, y la ruta compara `details.run.companyId` **después**: la respuesta ajena ya se armó, y el rechazo es 403 en vez de 404, así que además confirma que el id existe.
4. **El criterio 3 no estaba escrito en ningún sitio.** La máquina de estados ya define qué transiciones existen (`assertPaymentRunTransition`), y los estados terminales son terminales. Lo que faltaba era decirlo: endurecer el filtro **no reescribe** una corrida ya autorizada ni reabre una cerrada —la política se aplica a la próxima acción, nunca al pasado—.

**Decisión (13-10-2026):** `treasuryModel` sigue `descriptiva`. C15 ya decided que deducir permisos de `CUENTA_UNICA`/`CUENTA_POR_SUCURSAL` sería repetir H04, y nadie ha definido qué cuenta puede disbursar cada sucursal. Lo que sí se aplica es el criterio 1 tal como C15 lo permite: **la configuración no concede permisos; la operación tiene un filtro propio, escrito, en el servicio y compartido con la pantalla.** La columna entra en el contrato como lo que queda por decidir.

**Cortes antes de implementar:**

- **C18.1 — Contrato honesto:** la entrada de `treasuryModel` del catálogo queda escrita contra la corrida real (los siete pasos y sus estados) y su decisión pendiente se reduce a lo que falta: qué cuenta puede disbursar cada sucursal y si la modalidad debe cambiar quién prepara, autoriza y liquida.
- **C18.2 — El filtro vive en la operación:** módulo puro `lib/treasury/disbursement-policy.ts` con los pasos y el rol que mueve dinero; el servicio lo aplica en estado, liquidación y layout, y las rutas pasan `actorRole`. Se retira la comprobación duplicada de la ruta, que pasa a ser la segunda red.
- **C18.3 — Pantalla y detalle acotado:** la pantalla usa el mismo módulo con el rol de la sesión y oculta o desactiva lo que el servidor va a rechazar, con el motivo; `getPaymentRunDetails` se acota por empresa y devuelve 404.
- **C18.4 — Recorrido controlado:** un caso con dos empresas demuestra la corrida completa con doble firma, el rechazo por rol en cada paso que mueve dinero, el 404 de lo ajeno y que endurecer el filtro no reescribe estados ya alcanzados.

**Criterios de aceptación:**

- [x] La configuración limita quién puede ejecutar la operación según C15. La política de C15 dice que la dimensión descriptiva no concede permisos; el límite de la operación queda escrito en `disbursement-policy.ts` (rol de tesorería + estado + segregación de funciones) y lo aplica el servicio, no la ruta.
- [x] Un intento por API o acción respeta la misma restricción que la pantalla. La pantalla calcula los mismos veredictos que el servidor con el mismo módulo; la API los aplica aunque se llame al servicio por otra entrada.
- [x] Los cambios de política no invalidan estados históricos sin una transición definida. Endurecer el filtro aplica a la próxima acción: una corrida ya autorizada sigue autorizada, una cerrada sigue cerrada y la máquina de transiciones no admite saltos ni retrocesos.

**Verificación:** V1 de autorización y V2 de operación de tesorería; los permisos de seguridad siguen siendo obligatorios.

**Verificación ejecutada (13-10-2026):** V1 — `tests/unit/finance/treasury-authorization.test.ts` sobre el módulo puro, el servicio y las rutas reales. V2 — `tests/e2e/treasury-authorization.spec.ts` en Chromium con la pantalla real y la API interceptada. V3/base real — `scripts/verify-treasury-authorization.ts` con dos empresas. Detalle y límites en la [evidencia](../docs/audits/2026-10-13-tesorería.md).

**Archivos probables:**

- `lib/services/tenant-config-service.ts`
- `Consumidor de tesorería identificado en C00`
- `Entrada del recorrido de tesorería`
- `components/company/operating-dimensions-section.tsx`
- `Prueba de política de tesorería (nueva)`

#### Punto de control C16–C18

- [x] Criterios del bloque verificados con resultados registrados.
- [x] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [x] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

<a id="c19"></a>

### C19 — Aplicar política de pagos a proveedores

**Hallazgos:** H04. **Dependencias:** C15. **Tamaño:** M.

Conectar supplierPayment al recorrido de programación/aprobación de pago definido, preservando separación con tesorería.

**Investigación de C19 (13-10-2026) — la pregunta del handoff, contestada: no hay máquina de estados del pago a proveedor.** El pago se decide dentro de la corrida de tesorería y en ningún otro sitio:

```
agendar   POST /api/finance/treasury/runs/[id]/items → assertCounterpartyPayable → payment_run_items
pagar     corrida APPROVED → PROCESSING → COMPLETED y saldarDocumentosDePartidas
estado    invoices.payment_status: PENDING | PAID | CANCELLED
```

La liquidación refleja el pago mediante `saldarDocumentosDePartidas`. C19 conserva la máquina de tesorería: `supplierPayment` describe una modalidad y no se convierte en un segundo motor de pagos.

**La lectura del código anterior identificó tres caminos sin guarda de duplicados.** `assertCounterpartyPayable` comprobaba factura, empresa, discrepancia y cuenta verificada, pero no estado pagable ni programación previa. La tabla describe el defecto de ese código, no acredita una ejecución anterior contra la base:

| intento | comportamiento permitido por el código anterior |
| --- | --- |
| La misma factura dos veces en la misma corrida | **se acepta**: dos partidas, el total de la corrida cuenta el importe dos veces y el layout SPEI trae dos renglones para una factura |
| La misma factura en dos corridas distintas (ambas `DRAFT`) | **se acepta**: dos archivos de dispersión distintos con la misma transferencia |
| Una factura ya `PAID` en una corrida nueva | **se acepta**: se programa un pago de algo que ya se pagó |

No es sólo un hueco de API: una factura agendada pero no liquidada sigue `PENDING`. El listado anterior podía ofrecerla en otra corrida. C19 excluye referencias retenidas y repite la decisión dentro del alta.

`payment_run_items` no tiene ninguna restricción de unicidad: la base no impide dos partidas iguales, así que la guarda tiene que vivir en el servicio (y bloquear la fila del documento para que dos altas simultáneas no se cuelen).

**Decisión (13-10-2026):** `supplierPayment` sigue `descriptiva`. Su decisión pendiente tiene tres partes y **una queda resuelta por el trabajo**: «cómo se evitan pagos duplicados». Las otras dos —quién programa y aprueba cada pago, y cómo se reparten las facturas entre corporativo y sucursal— siguen sin acuerdo, y deducirlas de `CENTRALIZADO`/`POR_SUCURSAL`/`HIBRIDO` sería repetir H04. Lo que C19 aplica es el criterio 3 tal como está escrito: la operación conserva trazabilidad y no duplica pagos.

**Cortes antes de implementar:**

- **C19.1 — Contrato honesto:** la entrada `supplierPayment` del catálogo queda escrita contra el recorrido real (la corrida decide, `saldarDocumentosDePartidas` es el único escritor del estado de pago) y su decisión pendiente pierde la parte que C19 resuelve. Sin cambio de clasificación.
- **C19.2 — Una obligación, una vez:** `addItemToRun` rechaza la partida si el documento ya no es pagable (factura pagada o cancelada, gasto pagado) o si el mismo par (tipo, referencia) ya es partida de esta corrida o de cualquier corrida que no esté cancelada. El rechazo nombra la corrida que la retiene, que es lo que hace falta para releasearla. El módulo puro `lib/treasury/scheduling-policy.ts` decide; el servicio pregunta a la base.
- **C19.3 — Sin carrera:** la comprobación y el alta ocurren en la misma transacción, con la fila del documento bloqueada (`FOR UPDATE`), de modo que dos altas simultáneas de la misma factura no puedan pasar las dos. El caso se prueba con un adaptador que emula la semántica del cerrojo, como en C11.
- **C19.4 — La pantalla deja de ofrecer lo ya programado:** los tres listados de «para pagar» excluyen lo que ya es partida de una corrida viva, y el de nómina deja de depender de partidas de **otras** empresas (hoy `attachedIds` no filtra por empresa). Con esto el doble pago deja de poder provocarse desde la interfaz.
- **C19.5 — Recorrido controlado:** un caso con dos empresas demuestra que la misma factura no entra dos veces, que una corrida cancelada sí libera la obligación, y que el archivo de dispersión de una corrida con la factura una sola vez trae un renglón.

**Criterios de aceptación:**

- [x] Cada valor tiene un efecto observable sobre el pago o se presenta como descriptivo. `supplierPayment` sigue `descriptiva` y el catálogo dice que el pago se decide en la corrida, no en la columna.
- [x] La regla se aplica en servidor con empresa y proveedor verificados. La empresa ya se comprobaba (G1.2) y el proveedor con CLABE verificada también; C19 añade que la obligación sea agendable y que no esté ya agendada, extendiendo la misma protección a contraparte y cuenta de gastos.
- [x] La operación y sus excepciones conservan trazabilidad y no duplican pagos. El rechazo nombra la corrida que retiene la obligación (o el estado pagado/cancelado), cancelar una corrida previa a dispersión libera los documentos pendientes y el alta concurrente contra Neon conserva una única partida con total consistente.

**Verificación:** V1 de decisiones e idempotencia y V2 del recorrido de pago.

**Verificación ejecutada (14-10-2026):** V1 — `tests/unit/finance/payment-scheduling.test.ts` (39) y `tests/unit/finance/` (56) sobre política, servicio y rutas reales con rollback, doble alta, contrapartes ajenas y contexto HTTP. V2 — `tests/e2e/payment-scheduling.spec.ts` (8) en Chromium con la pantalla real (modal de agregar facturas/gastos/nómina, lote parcial, cero éxitos y refresco de pestañas) y 68/68 en la suite aislada. V3/base real — `scripts/verify-payment-scheduling.ts` (21) contra Neon con dos empresas, carrera real de altas, liberación por cancelación, factura pagada y layout SPEI. `tsc --noEmit` limpio, `lint` 0 errores, suite 1157 aprobadas (87 archivos, 1 omitida, 1 TODO) y `build` exitoso. Límites documentados en la evidencia [C19](../docs/audits/2026-10-14-pago-proveedores.md).

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

- [x] Cada nivel de autonomía define qué puede decidir el gerente y cuándo escala.
- [x] Autonomía, permisos y límites monetarios se combinan de forma documentada en servidor.
- [x] Un intento equivalente por otra entrada no evita la escalada.

**Verificación:** V1 de matriz de niveles/montos/roles y V2 de autorización/escalada.

**Verificación ejecutada (14-10-2026):** V1 — `tests/unit/finance/manager-autonomy.test.ts` (26) de matriz pura (ALTA, MEDIA, BAJA, límites numéricos, bordes y segregación de funciones) y 24 en `operating-policy-catalog.test.ts` (6 aplicadas / 6 descriptivas / 1 pendiente). V2 — `tests/e2e/manager-autonomy.spec.ts` (4) y `tests/e2e/operating-config.spec.ts` (31) en Chromium con la pantalla real (badge «Se aplica hoy», textos de opciones, persistencia y evaluación cliente). V3/base real — `scripts/verify-manager-autonomy.ts` (17) contra Neon con dos empresas simultáneas, usuarios con roles GERENTE, ADMIN y OWNER, escalamiento forzado a OWNER en ALTA, auto-aprobación prohibida (A16), dinamismo de cambio en caliente y limpieza confirmada. `tsc --noEmit` limpio, `lint` 0 errores y suite de 88 archivos aprobada. Evidencia en [C20](../docs/audits/2026-10-14-autonomia-gerente.md).

**Archivos modificados:**

- `lib/expenses/approval-policy.ts`
- `lib/services/expense-service.ts`
- `lib/services/tenant-config-service.ts`
- `lib/company/operating-policy-catalog.ts`
- `components/company/operating-dimensions-section.tsx`
- `docs/operating-policy-contracts.md`
- `docs/audits/2026-10-14-autonomia-gerente.md`
- `tests/unit/finance/manager-autonomy.test.ts`
- `tests/e2e/manager-autonomy.spec.ts`
- `scripts/verify-manager-autonomy.ts`

<a id="c21"></a>

### C21 — Aplicar política de dispersión de nómina

**Hallazgos:** H04. **Dependencias:** C15. **Tamaño:** M.

Precisar y aplicar payrollDispersion al recorrido soportado de nómina/exportación, o etiquetarla como descripción si no hay ejecución de dispersión.

**Criterios de aceptación:**

- [x] La UI no promete pagos automatizados que el producto no ejecuta. Los textos de la sección describen cómo se **declara** la nómina (corrida consolidada, por razón social o mezcla), no transferencias; el catálogo dice que ningún módulo lee la columna para decidir nada.
- [x] El comportamiento definido respeta empresa, sucursal y permiso de nómina. La columna no gobierna ninguna operación, y el recorrido que describe —corrida, timbrado y programación en tesorería— se acota por `companyId` y permiso, verificado contra la base real con dos empresas.
- [x] Un caso de cada modalidad demuestra resultado o clasificación descriptiva sin enviar dinero real. Las tres modalidades persisten y releen por empresa; alternar la modalidad no altera corridas ni folios timbrados. El timbrado se ejercitó contra el sandbox de FiscalAPI con las personas de prueba del SAT (CFDI con UUID real), sin PAC de producción ni dinero real.

**Verificación:** V1 y V2 con fixtures de nómina y adaptadores simulados.

**Decisión (14-10-2026):** `payrollDispersion` permanece **descriptiva**. El producto no ejecuta dispersión bancaria autónoma —la corrida se calcula, se timbra y la tesorería genera un layout que un apoderado dispersa manualmente— y deducir agrupaciones o responsables de `CONSOLIDADA`/`POR_RAZON_SOCIAL`/`MIXTO` sería repetir H04. El contrato de la entrada del catálogo quedó escrito contra el recorrido real y su decisión pendiente se registró como resuelta.

**Verificación ejecutada (14-10-2026):** V1 — `tests/unit/finance/payroll-dispersion-policy.test.ts` (7) sobre el catálogo real, más las 24 del catálogo sin cambios de clasificación (6 aplicadas / 6 descriptivas / 1 pendiente). V3/base real + sandbox — `scripts/verify-payroll-dispersion.ts` (25) contra Neon con dos empresas y el sandbox de FiscalAPI: cálculo aislado, corrida por empresa, **timbrado real con UUID del PAC para ambas empresas** usando personas de prueba del SAT y el emisor EKU9003173C9, payslip que conserva el folio, tesorería sin fugas entre tenants e historial intacto tras cambiar la modalidad; limpieza confirmada. Suite 1190 aprobadas (89 archivos), lint 0 errores y build exitoso. Límites en la [evidencia](../docs/audits/2026-10-14-dispersion-nomina.md): sin V2 con Next/auth, sandbox (no producción) y sin dispersión bancaria que verificar porque no existe.

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

- [x] Se define cómo distinguir sucursales propias/franquiciadas antes de modificar agregaciones.
- [x] Las vistas del recorrido elegido cumplen la segmentación sin ampliar acceso a datos.
- [x] Cada valor tiene casos de inclusión/exclusión o queda expresamente descriptivo.

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

- [x] Se distingue límite del fondo, límite por gasto y límite de aprobación.
- [x] La operación definida aplica el límite en servidor o el ajuste se declara descriptivo.
- [x] Cero, null, excepciones y fondos existentes tienen comportamiento documentado y verificable.

**Verificación:** V1 de límites y V2 del recorrido de caja chica, sin duplicar su servicio.

**Archivos probables:**

- `lib/services/tenant-config-service.ts`
- `Consumidor de caja chica identificado en C00`
- `app/api/company/operating-config/route.ts`
- `components/company/operating-config-form.tsx`
- `Prueba de límite de caja chica (nueva)`

#### Punto de control C22–C23

- [x] Criterios del bloque verificados con resultados registrados.
- [x] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [x] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

**Puerta de fase:** revisar build/lint y regresiones pertinentes; conservar evidencia de la entrega indicada al inicio. Cerrada el 15-10-2026.

## Fase 4 — Workflows y verificación

**Entrega:** Las escrituras respetan el contrato del paso y sus efectos son recuperables.

<a id="c24"></a>

### C24 — Validar el contrato del paso en servidor

**Hallazgos:** H08. **Dependencias:** C05. **Tamaño:** M.

Validar estado, requerido, tipo, límites y evidencia usando la definición aplicable a la instancia antes de persistir.

**Criterios de aceptación:**

- [x] No se completa un paso requerido con un payload vacío, inválido o sin evidencia exigida.
- [x] La misma regla protege API, acciones e integraciones internas que actualicen pasos.
- [x] La UI recibe un error corregible; SKIPPED y transiciones permitidas tienen autorización explícita.

**Verificación:** V1 con payloads malformados y llamada directa al servidor; V2 de rechazo/corrección/completado.

**Verificación ejecutada (15-10-2026):** V1 — `tests/unit/workflows/step-contract.test.ts` (22) y `tests/unit/workflows/step-contract-service.test.ts` (10) sobre la política pura (`validarContratoDePaso`), tipos de campos (number, boolean, text, select, photo, signature), rango numérico, opciones permitidas, evidencia requerida, omisión autorizada (SKIPPED solo supervisor/admin/owner con justificación obligatoria) y transiciones protegidas (409 en instancias terminales); suite de workflows 119/119 aprobadas (12 archivos). V2 — `tests/e2e/workflow-step-contract.spec.ts` (3) en Chromium con la UI de `WorkflowExecutor` (rechazo out-of-bounds con toast corregible, modal de justificación de omisión para supervisor y rechazo 403 para empleado común). V3/base real — `scripts/verify-workflow-step-contract.ts` (7) contra Neon Postgres con dos sucursales, instancia real, bloqueo de paso sin evidencia (400), rechazo numérico (400), omisión no autorizada (403), omisión autorizada persistida como SKIPPED con justificación y usuario, y bloqueo atómico de modificación en instancia completada (`WORKFLOW_TERMINAL` 409). `tsc --noEmit` limpio, `lint` 0 errores. Evidencia en [C24](../docs/audits/2026-10-15-workflow-step-contract.md).

**Archivos modificados:**

- `lib/workflows/step-contract-policy.ts` (nuevo)
- `lib/services/workflow-execution-service.ts`
- `app/api/workflows/executions/[id]/steps/[stepId]/route.ts`
- `components/workflow/workflow-executor.tsx`
- `tests/unit/workflows/step-contract.test.ts` (nuevo)
- `tests/unit/workflows/step-contract-service.test.ts` (nuevo)
- `tests/e2e/workflow-step-contract.spec.ts` (nuevo)
- `scripts/verify-workflow-step-contract.ts` (nuevo)
- `docs/audits/2026-10-15-workflow-step-contract.md` (nuevo)

<a id="c25"></a>

### C25 — Transmitir configuración de IA a la ejecución

**Hallazgos:** H07. **Dependencias:** C24. **Tamaño:** M.

Pasar aiConfig de la plantilla/instancia al adaptador y definir defaults, proveedor alternativo y límite efectivo de reintentos.

**Criterios de aceptación:**

- [x] El proveedor configurado se utiliza en ambas vías de verificación actuales (`VerificationEngine.evaluate` y `AIService.verifyPhoto`).
- [x] Proveedor alternativo (fallback simétrico Moondream <-> Cloudflare <-> OpenAI) y reintentos (acotados a 0–5) tienen una semántica efectiva y no multiplican los reintentos de Inngest.
- [x] Una configuración inválida falla de forma explícita (`InvalidAIConfigError`); las credenciales permanecen en servidor (`sanitizeAIConfig`).

**Verificación ejecutada (15-10-2026):** V1 — `tests/unit/workflows/ai-config-policy.test.ts` (13) y `tests/unit/workflows/ai-config-service.test.ts` (7) con adaptadores mockeados, conteo estricto de llamadas en primario y fallback, validación de jerarquía (Paso > Instancia > Plantilla > Defaults), descarte de proveedores no soportados (`gemini`) y saneamiento de credenciales; suite completa de workflows 139/139 aprobadas (14 archivos). V2 — `tests/e2e/workflow-ai-config.spec.ts` (2) en Chromium aislado (`playwright-shifts.config.ts`) con modal real del Builder configurando Cloudflare Workers AI como primario, OpenAI como respaldo, maxRetries a 3, persistencia en API y verificación de bloqueo en roles no privilegiados (`canEditPrivileged = false`). V3/base real — `scripts/verify-workflow-ai-config.ts` (5) contra Neon Postgres viva con siembra y limpieza, persistencia real de `aiConfig` en `workflow_templates`, resolución en ejecución real, persistencia de análisis de IA con fallback y verificación forense de cero filtración de secretos. `tsc --noEmit` limpio, `lint` 0 errores. Evidencia en [C25](../docs/audits/2026-10-15-workflow-ai-config.md).

**Archivos modificados y creados:**

- `lib/workflows/ai-config-policy.ts` (nuevo)
- `lib/ai/providers/cloudflare.ts` (nuevo)
- `lib/services/ai-service.ts`
- `lib/services/verification-engine.ts`
- `lib/services/workflow-execution-service.ts`
- `app/api/templates/[id]/settings/route.ts`
- `app/api/ai/verify/route.ts`
- `components/builder/workflow-settings-modal.tsx`
- `templates/compliance/ley-silla-inspection-v1.json`
- `tests/unit/workflows/ai-config-policy.test.ts` (nuevo)
- `tests/unit/workflows/ai-config-service.test.ts` (nuevo)
- `tests/e2e/workflow-ai-config.spec.ts` (nuevo)
- `tests/support/shifts-browser-server.ts`
- `tests/playwright-shifts.config.ts`
- `scripts/verify-workflow-ai-config.ts` (nuevo)

<a id="c26"></a>

### C26 — Conservar confianza mínima en el veredicto IA

**Hallazgos:** H07. **Dependencias:** C25. **Tamaño:** M.

Combinar confianza, resultado específico y autoaprobación como condiciones explícitas para impedir que una rama sobrescriba un rechazo obligatorio.

**Criterios de aceptación:**

- [x] Calidad o seguridad favorables no autoaprueban cuando no se cumple la confianza requerida.
- [x] Cada resultado conserva motivo, proveedor, confianza y necesidad de revisión.
- [x] Los casos frontera de confianza y autoApprove tienen resultado determinista.

**Verificación:** V1 con resultados de calidad/seguridad y confianza debajo/igual/encima del mínimo.

**Archivos probables:**

- `lib/services/verification-engine.ts`
- `lib/types/ai-verification.ts`
- `tests/workflows/verification-verdict.test.ts (nuevo)`

#### Punto de control C24–C26

- [x] Criterios del bloque verificados con resultados registrados.
- [x] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [x] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

<a id="c27"></a>

### C27 — Hacer única la transición de finalización

**Hallazgos:** H10. **Dependencias:** C24. **Tamaño:** M.

Establecer una transición atómica al completar y claves de idempotencia para completionActions, evitando repetir efectos frente a concurrencia.

**Criterios de aceptación:**

- [x] Dos solicitudes concurrentes producen una sola transición lógica a completado.
- [x] Cada acción con efectos tiene una clave estable y repetir la evaluación no duplica el efecto.
- [x] Un error de acción queda registrado con estado recuperable en vez de desaparecer en un log.

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

- [x] Un fallo entre commit y envío no pierde el evento: la entrega puede recuperarse mediante outbox o mecanismo durable equivalente.
- [x] Entrega repetida no duplica movimientos/documentos y un fallo terminal tiene estado visible.
- [x] El usuario distingue pasos completados, efectos pendientes y efectos fallidos con una vía autorizada de recuperación.

**Verificación:** V3 de caída antes/después del envío y entrega duplicada; V2 del estado de procesamiento. Si backend y UI exceden cinco archivos, dividir entrega y presentación antes de ejecutar.

**Desglose de continuación (15-10-2026), antes de modificar el trabajo C28 existente:**

- C28.1a — Esquema del outbox: esquema, migración, journal y snapshot (cuatro archivos).
- C28.1b — Transición y outbox atómicos: servicio y pruebas de finalización. Un error al insertar la intención revierte el cierre; no se oculta.
- C28.2 — Publicación recuperable: consumidor cron, servicio de entrega, registro y pruebas. Separar entrega al proveedor de procesamiento de extractores; limitar lote e intentos y conservar el error.
- C28.3 — Resultado durable de extractores: consumidor, servicio de entrega y pruebas. Serializar por instancia, conservar éxitos por extractor y reflejar fallos sin repetir los exitosos.
- C28.4 — Recuperación autorizada: acción, contrato de lectura y pruebas. Reutilizar permiso de escritura y alcance de empresa/sucursal/responsable; reintentar con una nueva generación de evento.
- C28.5 — Presentación: executor, página y pruebas de navegador. Mostrar pasos completos por separado de efectos pendientes/fallidos/completados, conservar el error de recuperación y refrescar mientras se procesa.
- C28.6 — Verificación y evidencia: regresiones, lint/build y documentación. Los efectos síncronos anteriores (acciones de plantilla, cierre de conteo y smart links) conservan su recorrido; cualquier límite de esas acciones se declara y no se confunde con entrega de extractores.
- C28.7a — Preparación transaccional del conteo: servicio de conteo, runner y prueba del servicio (tres archivos). Compartir la transacción del motor y diferir extracción/alertas hasta después del commit.
- C28.7b — Integración del cierre: motor, regresión de idempotencia y prueba conteo/outbox (tres archivos). El motor confirma COMPLETED; reproducir rollback del outbox y la finalización de la cuadrícula real.
- C28.7c — Verificación Postgres: script de fixtures con UUID propios y evidencia. No publicar eventos ni enviar mensajes.
- C28.8a — Puerta de compilación: excluir `.worktrees` y `.tmp` del proyecto TypeScript (un archivo).
- C28.8b — Resolver bloqueos previos de C26 al compilar: validar campos desconocidos de JSON de IA y probar respuestas malformadas (dos archivos).
- C28.8c — Alinear fixtures previas C25–C27 con el esquema vigente de plantillas (tres scripts; `active` en lugar de la columna inexistente `status`).

**Archivos probables:**

- `lib/services/workflow-execution-service.ts`
- `lib/inngest/functions/workflow-extractors.ts`
- `lib/db/schema.ts`
- `Vista de ejecución identificada en C00`
- `tests/workflows/completion-delivery.test.ts (nuevo)`

#### Punto de control C27–C28

- [x] Criterios del bloque verificados con resultados registrados.
- [x] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [x] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

**Puerta de fase:** revisar build/lint y regresiones pertinentes; conservar evidencia de la entrega indicada al inicio.

## Fase 5 — Métricas consistentes

**Entrega:** Las pantallas comparten definiciones y distinguen datos reales, estimados y ausentes.

<a id="c29"></a>

### C29 — Compartir definiciones financieras entre motores

**Hallazgos:** H06. **Dependencias:** C14. **Tamaño:** M.

Reutilizar base de ventas, carga laboral y objetivos en la vista de sucursales, preservando procedencia y conceptos distintos.

**Criterios de aceptación:**

- [x] Mismo periodo, sucursal y datos producen métricas comparables con la misma base y fórmula.
- [x] IVA, carga laboral y objetivos configurados afectan ambas vistas coherentemente.
- [x] Las diferencias legítimas de concepto se nombran en la interfaz en lugar de ocultarse bajo el mismo indicador.

**Verificación:** V1 con fixtures de ventas/costos y conciliación entre motores; considerar duplicación de merma al elegir numeradores.

**Desglose antes de implementar (más de cinco archivos):**

- C29.1 — Definición compartida de porcentajes: módulo puro `lib/services/branch-cost-metrics.ts` con el mapeo de procedencia, la degradación por base, la aplicación de carga laboral y el cálculo de porcentajes/estados; `financial-kpi-service` lo consume sin cambiar su salida; pruebas puras.
- C29.2 — El motor QSR mide con la base y la carga compartidas: `getBranchQSRRanking` usa `getFoodCostByBranch`/`getLaborCostByBranch` + `resolveSalesBase` por sucursal + `getLaborBurden` + `getFinancialTargets`; deja de inventar 31.5/24.5 y deriva `dataQuality` de la procedencia.
- C29.3 — La vista nombra procedencia y diferencia de concepto: `BranchQSRScore` expone fuente y nota por renglón; scorecard y CSV muestran base neta, merma incluida y carga, con los objetivos del tenant.
- C29.4 — Conciliación V1 entre motores: `tests/unit/finance/branch-kpi-consistency.test.ts` con fixtures compartidos; ajuste de `tests/e2e/group-network.spec.ts` si cambia la forma.

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

**Dividida en C30.1–C30.3 antes de implementar.** La calidad de dato viaja en el tipo compartido `BranchQSRScore`, así que el servicio va primero y la representación después; separar el servicio de su pantalla y de los consumidores ejecutivos mantiene cada corte por debajo de cinco archivos. Los tres cortes se commitean por separado y cada uno conserva el build verde.

- [x] C30.1 — Servicio: `MetricQuality`, métricas nullable y sin sustituciones inventadas (`cross-branch-service.ts` + pruebas).
- [x] C30.2 — Liga de Sucursales: la pantalla, la tabla y el CSV nombran la ausencia y la procedencia.
- [x] C30.3 — Consumidores ejecutivos: el cockpit deja de inventar 57.8/29.4/28.4 cuando la red no tiene dato.

**Criterios de aceptación:**

- [x] Ausencia de ventas/costos nunca se presenta como VERIFIED ni con un porcentaje operativo inventado.
- [x] Toda estimación muestra fuente y metodología; dato real y cero real se distinguen de ausencia.
- [x] Indicadores de cumplimiento sin evidencias muestran ausencia de datos en lugar de 100 por defecto.

**Verificación:** V1 con conjunto vacío, ventas sin costos, cero real y datos completos; V2 de representación.

**Archivos probables:**

- `lib/services/cross-branch-service.ts` (C30.1)
- `lib/services/__tests__/cross-branch-qsr.test.ts` (C30.1) · `tests/unit/finance/data-quality.test.ts (nuevo, C30.1)`
- `components/analytics/branch-qsr-scorecard.tsx` · `components/analytics/branch-ranking-table.tsx` · `app/dashboard/branches/page.tsx` (C30.2)
- `app/dashboard/executive/page.tsx` · `components/dashboard/executive/prime-cost-stack-card.tsx` · `components/dashboard/executive/executive-cockpit-header.tsx` · `components/dashboard/executive/pnl-executive-waterfall.tsx` (C30.3)
- `tests/e2e/group-network.spec.ts` (V2 de representación, C30.2)

<a id="c31"></a>

### C31 — Verificar efecto financiero desde configuración hasta pantalla

**Hallazgos:** H05, H06. **Dependencias:** C30. **Tamaño:** S.

Cerrar un recorrido controlado de cambio de parámetro y consulta de métricas, sin reinterpretar periodos cerrados de forma implícita.

**Criterios de aceptación:**

- [x] Cambiar un parámetro permitido modifica las métricas que su contrato declara.
- [x] La recarga conserva configuración, procedencia y unidad del indicador.
- [x] Un usuario no autorizado no cambia parámetros y el historial permite explicar el resultado.

**Verificación:** V2 desde configuración a vista financiera/sucursales con datos conocidos.

**Archivos probables:**

- `tests/e2e/financial-policy-effect.spec.ts (nuevo)`
- `docs/operating-policy-contracts.md` (ya existía desde C14/C15; C31 amplía «Cómo se verifica un parámetro» y corrige el límite de `getPnLSnapshots`)

#### Punto de control C29–C31

- [x] Criterios del bloque verificados con resultados registrados.
- [x] Recorrido válido y rechazo autorizado comprobados cuando correspondan.
- [x] Errores, decisiones pendientes y cambios de contrato documentados antes del siguiente bloque.

**Puerta de fase:** revisar build/lint y regresiones pertinentes; conservar evidencia de la entrega indicada al inicio.

## Fase 6 — Notificaciones verificables

**Entrega:** Las preferencias gobiernan el envío y cada canal tiene un resultado trazable.

<a id="c32"></a>

### C32 — Unificar contrato de preferencias de notificación

**Hallazgos:** H09. **Dependencias:** C00. **Tamaño:** M.

Elegir un contrato canónico, hacer compatibles las tres APIs y cargar preferencias persistidas antes de editar.

**Criterios de aceptación:**

- [x] Las tres entradas autorizan al mismo usuario y usan la misma semántica de campos. `lib/notifications/preferences-contract.ts` es la única definición; las tres rutas derivan el usuario de la sesión, normalizan el cuerpo con el contrato y responden la misma forma (`inventoryAlerts` canónico, `stockAlerts` sólo como alias de entrada).
- [x] Guardar/recargar conserva canales y preferencias por tipo, incluidos stock y turnos. La migración aditiva 0097 añade `shift_reminders` y `schedule_changes`; el guardado combina con lo existente en lugar de resetear campos omitidos.
- [x] Un error de carga no muestra defaults como si fueran las preferencias guardadas. La pantalla distingue `loading`/`ready`/`error`: en error muestra un aviso con reintento y ningún interruptor.

**Verificación:** V1 de contratos compatibles y V2 de desactivar/guardar/recargar.

**Verificación ejecutada (16-10-2026):** V1 — `tests/unit/notifications/preferences-contract.test.ts` (13) y `tests/unit/notifications/preferences-routes.test.ts` (11) sobre el contrato puro y las tres rutas reales con base simulada. V2 — `tests/e2e/notification-preferences.spec.ts` (4) en Chromium aislado con el componente real y `fetch` interceptado. Base real — migración 0097 aplicada a Neon y verificada contra `information_schema.columns`. Suite 1394 aprobadas (109 archivos, 1 omitida, 1 TODO), 94/94 navegador aislado, `tsc` y `lint` limpios. Evidencia en [C32](../docs/audits/2026-10-16-preferencias-notificacion.md).

**Desglose ejecutado (16-10-2026):** C32.1 contrato canónico y persistencia (`7fec4e2`); C32.2 las tres APIs comparten el contrato (`4df495b`); C32.3 la pantalla carga antes de editar (`835026e`).

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

- [x] Los canales calculados por el router son exactamente los intentados por el dispatcher. `NotificationRouter.route` delega en `NotificationDispatcher.decideChannels`, y `sendNotification` intenta exactamente `decision.channels`; ambos usan la política pura `routing-policy.ts`.
- [x] Stock y recordatorios de turnos respetan preferencias por tipo; las excepciones están documentadas. `eventTypeEnabled` mapea stock/conteo → `inventoryAlerts`, turno → `shiftReminders`, cambio de horario → `scheduleChanges`. La única excepción a los canales de la regla es el diferido fuera de horario (sólo in-app); no hay excepción a las preferencias, tampoco para eventos críticos.
- [x] Fuera de horario se aplica la política definida usando zona horaria del contexto, sin depender de la del proceso. La zona sale de `metadata.timezone` o de `branches.timezone`, con `America/Mexico_City` de último recurso; el horario se evalúa con `Intl` sobre esa zona.

**Verificación:** V1 por tipo/canal/horario con adaptadores simulados y reloj controlado.

**Verificación ejecutada (16-10-2026):** V1 — `tests/unit/notifications/routing-policy.test.ts` (20) con reloj y zona controlados: horario por zona, bordes 09/18, fin de semana, preferencias por tipo y canal, evento crítico no diferido, y el dispatcher intentando exactamente los canales decididos. Suite 1414 aprobadas (110 archivos, 1 omitida, 1 TODO), `tsc` y `lint` limpios. Evidencia en [C33](../docs/audits/2026-10-16-decision-canal-notificaciones.md).

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
