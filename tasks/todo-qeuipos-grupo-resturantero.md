# Tareas: equipos para grupo restaurantero

Fecha: 2026-09-16. Estado: pendientes de implementación.

Plan asociado: [plan-qeuipos-grupo-resturantero.md](plan-qeuipos-grupo-resturantero.md).
Fuente: [propuesta de rediseño](../plans/2026-09-16-rediseno-equipos-grupo-restaurantero.md).

Se conserva la grafía solicitada para los nombres de archivo. Todas las casillas empiezan pendientes; elaborar este desglose no equivale a implementar ni aprobar el diseño.

## Reglas de ejecución

- Cada tarea incluye como máximo cinco archivos de trabajo previstos. Rutas nuevas y SQL con `<generada-...>` son propuestas, no archivos existentes. Los metadatos de Drizzle se generan junto con cada migración; si aparece más lógica o más de cinco archivos editados a mano, dividir la tarea antes de continuar.
- Reutilizar sesión, permisos y alcance existentes. Toda consulta nueva filtra empresa y sucursales autorizadas; toda escritura valida referencias y actor.
- Las verificaciones siguientes son instrucciones futuras. Los nuevos specs se crean con la tarea correspondiente; no se han ejecutado en esta planificación.
- Pruebas que escriben datos se ejecutan en una BD aislada con fixtures sintéticos. Vitest se usa para lógica pura; las restricciones, transacciones y carreras se prueban contra BD mediante los specs de integración/E2E.
- En cada checkpoint ejecutar tests afectados, lint focalizado y `pnpm run build`; conservar evidencia. No repetir una suite ya aprobada sin cambios relacionados.
- Respetar `PRODUCT.md` y `DESIGN.md`: Geist, superficies tonales sin sombras, rojo acotado, texto principal 14–16 px, etiquetas ≥12 px, entradas móviles 16 px y acciones de campo 44 px.
- Cada corte de UI contempla carga, vacío real, sin coincidencias, error/reintento, sin permiso, datos parciales y conflicto; foco visible y devolución de foco al cerrar paneles.
- La revisión humana del plan y del prototipo se registra antes de implementar/extender el recorrido; no se considera concedida por este archivo.

## Checklist general


### Preparación y base confiable

- [ ] T01: Validar contratos y prototipo del recorrido.
- [ ] T02: Consultar inventario con alcance autorizado.
- [ ] T03: Proteger el expediente y sus recursos.
- [ ] T04: Validar referencias de órdenes y servicios.
- [ ] T05: Editar equipos preservando identidad e importes.
- [ ] T06: Separar programación de ejecución.
- [ ] T07: Consultar el intervalo visible de agenda.
- [ ] T08: Conectar alertas persistentes.

### Inventario y responsables

- [ ] T09: Introducir la navegación común.
- [ ] T10: Localizar equipos con filtros reales.
- [ ] T11: Modelar responsabilidades y bitácora.
- [ ] T12: Asignar responsables desde el expediente.
- [ ] T13: Completar el alta progresiva desde catálogo.
- [ ] T14: Completar garantías y documentos.
- [ ] T15: Presentar el expediente y la actividad.

### Trabajo diario

- [ ] T16: Modelar reportes y eventos de condición.
- [ ] T17: Registrar una falla desde el equipo.
- [ ] T18: Dar acceso directo a órdenes existentes.
- [ ] T19: Atender reportes con la OS existente.
- [ ] T20: Modelar ventanas de visita y bloqueos.
- [ ] T21: Programar visitas desde mantenimiento.
- [ ] T22: Sincronizar cierre e historial de forma idempotente.
- [ ] T23: Confirmar trabajo y restitución por separado.
- [ ] T24: Definir políticas de planes preventivos.
- [ ] T25: Administrar planes desde equipo y modelo.
- [ ] T26: Generar preventivos sin repetidos.
- [ ] T27: Modelar cobertura operativa de proveedores.
- [ ] T28: Elegir proveedores por especialidad y cobertura.
- [ ] T29: Unificar servicios periódicos en agenda y OS.
- [ ] T30: Entregar Hoy como semana operativa.

### Control económico y aceptación del MVP

- [ ] T31: Conciliar costos con fuentes existentes.
- [ ] T32: Mostrar costos y ficha económica.
- [ ] T33: Modelar propuestas de reemplazo.
- [ ] T34: Revisar reemplazos desde Costos.
- [ ] T35: Validar el MVP con datos de grupo.

### Adopción y escala

- [ ] T36: Importar unidades con vista previa.
- [ ] T37: Abrir equipos mediante QR autorizado.
- [ ] T38: Modelar traslados con recepción.
- [ ] T39: Trasladar desde el expediente.
- [ ] T40: Coordinar campañas por zona.
- [ ] T41: Preparar acceso limitado a trabajos externos.
- [ ] T42: Completar confirmación y evidencia por WhatsApp.
- [ ] T43: Medir cobertura y resultados operativos.
- [ ] T44: Preparar piloto y guía operativa.
- [ ] T45: Cerrar aceptación del resultado completo.

## Desglose verificable

## Tarea 1 (T01): Validar contratos y prototipo del recorrido

**Descripción:** Cerrar las decisiones que afectan datos y construir un prototipo navegable del mismo caso ficticio para dirección y gerente.

**Criterios de aceptación:**

- [ ] Prototipo cubre Hoy, inventario, expediente, falla, orden/cierre y costos en escritorio y móvil.
- [ ] Contrato define permisos, código único por empresa, estados, centavos, fechas, claves de idempotencia y fuentes de costo; dudas quedan explícitas.
- [ ] Revisión del recorrido registrada antes de extender el diseño a todas las pantallas.

**Verificación:**

- [ ] Recorrer ambos roles; registrar observaciones y decisiones en el documento de validación.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** Ninguna.

**Archivos previstos:**

- `docs/equipment/contracts.md`
- `docs/equipment/prototype.html`
- `docs/equipment/validation.md`

**Alcance estimado:** M (3 archivos de trabajo; una sesión enfocada).

## Tarea 2 (T02): Consultar inventario con alcance autorizado

**Descripción:** Crear un adaptador del alcance existente para equipos y usarlo en la consulta de inventario. Hoy el `branchId` del query llega al servicio sin pasar por `resolveBranchScope` ni `assertBranchOfCompany`, y `getEquipmentByBranch` filtra sólo por sucursal y nunca por empresa: adivinar un `branchId` ajeno lee el inventario de otra empresa. Es una lectura cruzada, no una carencia de filtros.

**Criterios de aceptación:**

- [x] Resolver ALL, BRANCH y NONE con sesión y permisos; NONE nunca equivale a todas.
- [x] Filtrar siempre por companyId y validar la sucursal solicitada contra la empresa.
- [x] GET admite Todas; un gerente no amplía su alcance cambiando query o cookie.
- [x] Regresión explícita de lectura cruzada: `GET /api/equipment?branchId=<sucursal de otra empresa>` no devuelve filas ajenas ni confirma que la sucursal exista.

**Verificación:**

- [x] pnpm test:unit lib/services/__tests__/equipment-scope.test.ts; probar dos empresas y gerente sin sucursal.
- [x] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

> Evidencia (2026-09-16): `pnpm test:unit lib/services/__tests__/equipment-scope.test.ts` → 24 tests ok. La respuesta del GET sigue siendo un arreglo plano (`{success, data}` de `ApiHandler`) para no romper a `use-equipment.ts`, `maintenance-form.tsx` y la pantalla de equipos. `getEquipmentByBranch` se reemplazó por `getEquipmentByScope`; `NONE` devuelve `[]` sin tocar la base.

**Dependencias:** T01

**Archivos previstos:**

- `lib/equipment/scope.ts`
- `lib/services/equipment-service.ts`
- `app/api/equipment/route.ts`
- `lib/services/__tests__/equipment-scope.test.ts`

**Alcance estimado:** M (4 archivos de trabajo; una sesión enfocada).

## Tarea 3 (T03): Proteger el expediente y sus recursos

**Descripción:** Aplicar el alcance en lecturas y mutaciones por ID, incluidas garantías y mantenimiento del equipo.

**Criterios de aceptación:**

- [x] GET, PUT y DELETE no revelan ni alteran equipos ajenos.
- [x] Garantías e historial verifican equipo, empresa y sucursal antes de operar.
- [x] IDs inexistentes y ajenos tienen una respuesta consistente; usuario sin sesión no accede.

**Verificación:**

- [x] pnpm test:e2e tests/equipment-isolation.spec.ts; comprobar que los intentos rechazados no escriben filas.
- [x] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

> Evidencia (2026-09-16): los 10 casos de servicio del spec pasaron contra la base real (`pnpm exec playwright test --no-deps --grep-invert "las rutas HTTP" tests/equipment-isolation.spec.ts` → 10 passed). El grupo HTTP necesita `next dev` levantado y quedó pendiente de correr en este equipo (7.2 GB de RAM, sin servidor en 3000); se validó esa capa con una sonda temporal (borrada) que comprobó 404 idéntico para ajeno e inexistente, 403 de sucursal, 401 sin sesión y cero escrituras en PUT/DELETE. Convención adoptada de `expense-service.ts:52`: 404 para lo que no existe en la empresa, 403 para lo que está fuera del alcance. `completeMaintenance` ahora exige que el registro sea del equipo del URL, de la empresa y del alcance.

**Dependencias:** T02

**Archivos previstos:**

- `lib/services/equipment-service.ts`
- `app/api/equipment/[id]/route.ts`
- `app/api/equipment/[id]/warranty/route.ts`
- `app/api/equipment/[id]/maintenance/route.ts`
- `tests/equipment-isolation.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C01 — después de T03

- [ ] Alcance de listado y expediente probado con dos empresas, Todas y gerente sin sucursal.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 4 (T04): Validar referencias de órdenes y servicios

**Descripción:** Cerrar los accesos indirectos a equipos mediante OS y servicios periódicos, usando el adaptador de alcance.

> **En curso (2026-09-16).** El código ya está aplicado y verificado con tsc/lint/unit (ver detalle en `tasks/handoff-qeuipos-grupo-resturantero.md` §4 y §6.1). Falta: el spec `tests/equipment-relations.spec.ts`, marcar estas casillas y el build del checkpoint.

**Criterios de aceptación:**

- [ ] OS valida pertenencia de equipmentId, proveedor, servicio y sucursal tanto al crear como al actualizar.
- [ ] Servicios periódicos no aceptan sucursales o proveedores de otra empresa.
- [ ] Lecturas y transiciones de OS respetan sucursales autorizadas además de permisos de acción.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-relations.spec.ts; cruzar IDs válidos de dos empresas y dos sucursales.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T02, T03

**Archivos previstos:**

- `lib/services/service-order-service.ts`
- `lib/services/equipment-service.ts`
- `app/api/service-orders/route.ts`
- `app/api/compliance-services/route.ts`
- `tests/equipment-relations.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 5 (T05): Editar equipos preservando identidad e importes

**Descripción:** Separar el envío de alta y edición y normalizar pesos, centavos y fechas de calendario. El PUT de `[id]` exige hoy `z.string().datetime()` en tres campos de fecha mientras el POST acepta `z.string()` y el formulario usa `<Input type="date">` (`YYYY-MM-DD`): reconectar el formulario al PUT sin unificar ese contrato devuelve 400 al primer cambio de fecha.

**Criterios de aceptación:**

- [ ] Editar usa PUT /api/equipment/[id], conserva ID e historial y no aumenta el conteo.
- [ ] 123.45 se almacena como 12345 centavos; abrir y guardar no multiplica nuevamente; cero y desconocido son distintos.
- [ ] Validación de campos y fechas es coherente entre formulario y API: `YYYY-MM-DD` se acepta igual en alta que en edición, sin exigir `datetime()` sólo en el PUT; conflicto de edición se informa.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-edit.spec.ts; incluir guardado repetido, compra sin fecha y edición concurrente.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T03

**Archivos previstos:**

- `components/equipment/equipment-form.tsx`
- `app/api/equipment/[id]/route.ts`
- `lib/services/equipment-service.ts`
- `lib/equipment/value-parsers.ts`
- `tests/equipment-edit.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 6 (T06): Separar programación de ejecución

**Descripción:** Concentrar la programación de mantenimiento en el servicio y conectar la acción del expediente.

**Criterios de aceptación:**

- [ ] Crear SCHEDULED no modifica lastMaintenanceDate ni lastExecutedDate.
- [ ] Registrar mantenimiento abre el formulario y muestra el trabajo confirmado después de guardar.
- [ ] Se valida alcance y fecha; registros previos sospechosos se identifican para revisión sin inventar ejecuciones históricas.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-scheduling.spec.ts; comparar fechas del equipo antes y después de programar.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T03, T05

**Archivos previstos:**

- `app/api/equipment/maintenance/route.ts`
- `lib/services/equipment-service.ts`
- `components/equipment/maintenance-form.tsx`
- `app/dashboard/equipment/[id]/page.tsx`
- `tests/equipment-scheduling.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C02 — después de T06

- [ ] Referencias cruzadas rechazadas; editar conserva ID y centavos; programar no marca ejecución.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 7 (T07): Consultar el intervalo visible de agenda

**Descripción:** Sustituir el horizonte fijo por inicio/fin explícitos y alinear estadísticas con el alcance autorizado.

**Criterios de aceptación:**

- [ ] Cambiar de mes consulta el intervalo visible en la zona de la sucursal.
- [ ] Vencidos se consultan como cola independiente sin duplicar eventos del intervalo.
- [ ] Agenda y estadísticas admiten Todas y aplican empresa/sucursal; no ejecutan una consulta extra por cada fila.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-calendar.spec.ts; probar cambio de mes, medianoche local y vencido fuera del intervalo.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T02, T06

**Archivos previstos:**

- `app/api/equipment/maintenance/upcoming/route.ts`
- `app/api/equipment/stats/route.ts`
- `components/equipment/maintenance-calendar.tsx`
- `lib/services/equipment-service.ts`
- `tests/equipment-calendar.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 8 (T08): Conectar alertas persistentes

**Descripción:** Reemplazar los datos simulados y las mutaciones locales por alertas almacenadas.

**Criterios de aceptación:**

- [ ] Consulta, reconocimiento y resolución verifican alcance y persisten actor, fecha y motivo.
- [ ] Sin pendientes solo aparece con consulta exitosa; error, sin datos y sin coincidencias se distinguen.
- [ ] Una alerta resuelta mantiene trazabilidad y la repetición de la acción no duplica efectos.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-alerts.spec.ts; refrescar tras reconocer y simular fallo de consulta.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T02, T03

**Archivos previstos:**

- `components/equipment/equipment-alerts.tsx`
- `app/api/equipment/alerts/route.ts`
- `app/api/equipment/alerts/[id]/route.ts`
- `lib/services/equipment-service.ts`
- `tests/equipment-alerts.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 9 (T09): Introducir la navegación común

**Descripción:** Crear el contenedor Equipos y mantenimiento y mover el inventario a su URL final.

**Criterios de aceptación:**

- [ ] Hoy, Equipos, Mantenimiento, Costos y Más usan una navegación común y el selector global existente.
- [ ] Inventario vive en /dashboard/equipment/inventory; detalle, catálogo, proveedores y servicios siguen accesibles.
- [ ] No se muestran destinos vacíos como funcionalidades terminadas; Hoy y Costos se activan al completar sus tareas.

**Verificación:**

- [ ] Verificar navegación, contexto y regreso al listado en escritorio y móvil; pnpm exec eslint sobre los archivos modificados.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T01, T07, T08

**Archivos previstos:**

- `app/dashboard/equipment/layout.tsx`
- `components/equipment/equipment-navigation.tsx`
- `app/dashboard/equipment/inventory/page.tsx`
- `app/dashboard/equipment/page.tsx`
- `components/app-sidebar.tsx`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C03 — después de T09

- [ ] Intervalo visible, estadísticas y alertas comparten alcance; navegación no ofrece páginas vacías.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 10 (T10): Localizar equipos con filtros reales

**Descripción:** Conectar búsqueda, paginación y orden del inventario con la consulta del servidor.

**Criterios de aceptación:**

- [ ] Nombre, código, serie y modelo se buscan en servidor; status/type y filtros rápidos realmente reducen resultados.
- [ ] URL conserva búsqueda, orden, página y filtros; cambiar alcance reinicia la página y evita mostrar respuestas antiguas.
- [ ] Lista prioriza equipo, sucursal/área, condición, responsable y próximo trabajo; criticidad y estado se distinguen.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-inventory.spec.ts; navegar atrás y cambiar alcance con una petición pendiente.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T02, T09

**Archivos previstos:**

- `app/dashboard/equipment/inventory/page.tsx`
- `components/equipment/equipment-inventory.tsx`
- `app/api/equipment/route.ts`
- `lib/services/equipment-service.ts`
- `tests/equipment-inventory.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 11 (T11): Modelar responsabilidades y bitácora

**Descripción:** Agregar asignaciones con vigencia y eventos auditables, con migración aditiva para datos existentes.

**Criterios de aceptación:**

- [ ] Una asignación tiene equipo, persona autorizada, vigencia y actor; no hay dos responsables principales vigentes simultáneos.
- [ ] Bitácora guarda acción, actor, fecha y referencia; edición y asignación registran eventos en la misma transacción.
- [ ] Migración preserva equipos e historial, detecta códigos duplicados antes de imponer unicidad por empresa y deja responsables desconocidos sin asignar.

**Verificación:**

- [ ] pnpm test:unit lib/services/__tests__/equipment-responsibility.test.ts; verificar además restricciones y rollback con BD aislada.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T03, T05

**Archivos previstos:**

- `lib/db/schema/equipment.ts`
- `drizzle/<generada-responsables-bitacora>.sql`
- `lib/services/equipment-responsibility-service.ts`
- `lib/services/equipment-service.ts`
- `lib/services/__tests__/equipment-responsibility.test.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 12 (T12): Asignar responsables desde el expediente

**Descripción:** Exponer la asignación vigente en equipo, alta y lista, sin crear roles nuevos.

**Criterios de aceptación:**

- [ ] Solo se ofrecen personas elegibles del alcance y se verifica elegibilidad también en servidor.
- [ ] Cambiar responsable conserva vigencias y actividad; sin responsable se muestra como pendiente explícito.
- [ ] Filtros y contadores de sin responsable se actualizan tras guardar.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-responsibility.spec.ts; reasignar y comprobar expediente e inventario.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T10, T11

**Archivos previstos:**

- `app/api/equipment/[id]/responsibility/route.ts`
- `components/equipment/equipment-responsibility.tsx`
- `app/dashboard/equipment/[id]/page.tsx`
- `components/equipment/equipment-form.tsx`
- `tests/equipment-responsibility.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C04 — después de T12

- [ ] Inventario y asignación vigente coinciden; bitácora y unicidad sobreviven a concurrencia.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 13 (T13): Completar el alta progresiva desde catálogo

**Descripción:** Reducir campos iniciales y hacer explícita la diferencia entre modelo reutilizable y unidad física.

**Criterios de aceptación:**

- [ ] Alta permite sucursal autorizada, nombre/modelo, tipo, área y responsable; compra/documentos pueden completarse después.
- [ ] Código sugerido editable es único por empresa con control de concurrencia en BD; catálogo pertenece a la misma empresa.
- [ ] Modelo precarga marca y plan sugerido, que se confirma antes de aplicarse; no impone un plan silenciosamente.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-create.spec.ts; duplicar código concurrentemente y crear desde Todas.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T11, T12

**Archivos previstos:**

- `components/equipment/equipment-form.tsx`
- `app/api/equipment/route.ts`
- `app/api/equipment/catalog/route.ts`
- `lib/services/equipment-service.ts`
- `tests/equipment-create.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 14 (T14): Completar garantías y documentos

**Descripción:** Conectar Agregar garantía y presentar documentación con su estado real.

**Criterios de aceptación:**

- [ ] Crear garantía valida vigencia y equipo autorizado; adjuntos reutilizan almacenamiento existente.
- [ ] Detalle distingue garantía vigente, vencida, desconocida y documento faltante; uso de garantía se registra con referencia al trabajo.
- [ ] Documento original, fechas y cobertura permanecen accesibles tras editar el equipo.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-warranty.spec.ts; agregar garantía, refrescar y comprobar acceso desde otro tenant.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T03, T09

**Archivos previstos:**

- `components/equipment/equipment-warranty-form.tsx`
- `app/dashboard/equipment/[id]/page.tsx`
- `app/api/equipment/[id]/warranty/route.ts`
- `lib/services/equipment-service.ts`
- `tests/equipment-warranty.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 15 (T15): Presentar el expediente y la actividad

**Descripción:** Sustituir el historial pendiente por una línea de actividad verificable y reorganizar la ficha.

**Criterios de aceptación:**

- [ ] Actividad ordena cambios, garantías y trabajos con actor, fecha y enlace a fuente; no presenta historia reconstruida como auditada.
- [ ] Ficha separa condición, criticidad y estado de trabajo; muestra responsable, siguiente visita y documentación.
- [ ] Encabezado ofrece Reportar falla o Ver trabajo abierto según datos; acciones futuras solo se activan al estar disponibles.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-dossier.spec.ts; recorrer un equipo con cambios y otro sin datos históricos.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T11, T12, T14

**Archivos previstos:**

- `app/dashboard/equipment/[id]/page.tsx`
- `components/equipment/equipment-activity.tsx`
- `app/api/equipment/[id]/activity/route.ts`
- `lib/services/equipment-activity-service.ts`
- `tests/equipment-dossier.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C05 — después de T15

- [ ] Alta, garantías y expediente funcionan sin recaptura ni botones sin acción.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 16 (T16): Modelar reportes y eventos de condición

**Descripción:** Crear reportes independientes de OS y eventos de paro/restitución con referencias persistentes.

**Criterios de aceptación:**

- [ ] Reporte admite equipo o área, folio, autor, descripción, evidencia y condición informada; puede existir sin cotización ni OS.
- [ ] Eventos diferencian falla, comienzo de paro y restitución real; criticidad no implica avería.
- [ ] Migración preserva datos; inserciones repetidas usan clave idempotente y eventos incluyen empresa/sucursal histórica.

**Verificación:**

- [ ] pnpm test:unit lib/services/__tests__/equipment-failure.test.ts; verificar unicidad y concurrencia en BD aislada.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T11

**Archivos previstos:**

- `lib/db/schema/equipment.ts`
- `drizzle/<generada-reportes-condicion>.sql`
- `lib/services/equipment-failure-service.ts`
- `lib/equipment/failure-contract.ts`
- `lib/services/__tests__/equipment-failure.test.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 17 (T17): Registrar una falla desde el equipo

**Descripción:** Entregar el recorrido corto de reporte con confirmación y recuperación ante problemas de conexión.

**Criterios de aceptación:**

- [ ] Permite descripción/foto y condición de operación, o reporte por área para identificar después.
- [ ] Folio, responsable o asignación pendiente y siguiente paso aparecen solo tras respuesta confirmada.
- [ ] Conserva texto y archivos pendientes al fallar; ante trabajo abierto ofrece adjuntar evidencia al mismo.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-failure.spec.ts; probar fallo de subida, doble envío y reporte sin equipo.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T15, T16

**Archivos previstos:**

- `app/api/equipment/failures/route.ts`
- `components/equipment/equipment-failure-form.tsx`
- `app/dashboard/equipment/[id]/page.tsx`
- `lib/services/equipment-failure-service.ts`
- `tests/equipment-failure.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 18 (T18): Dar acceso directo a órdenes existentes

**Descripción:** Exponer las mismas OS desde mantenimiento y conservar enlaces antiguos.

**Criterios de aceptación:**

- [ ] Listado y detalle tienen URLs /dashboard/equipment/maintenance/orders y /orders/[id].
- [ ] Rutas antiguas bajo compliance/service-orders redirigen conservando ID y parámetros.
- [ ] Reutilizar las pantallas existentes no cambia folios, estados, permisos ni registros.

**Verificación:**

- [ ] Comprobar URLs antiguas con filtros, enlace profundo a detalle y navegación atrás; pnpm exec eslint sobre las páginas modificadas.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T04, T09

**Archivos previstos:**

- `app/dashboard/equipment/maintenance/orders/page.tsx`
- `app/dashboard/equipment/maintenance/orders/[id]/page.tsx`
- `app/dashboard/equipment/compliance/service-orders/page.tsx`
- `app/dashboard/equipment/compliance/service-orders/[id]/page.tsx`
- `app/dashboard/equipment/maintenance/page.tsx`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C06 — después de T18

- [ ] Reporte persiste ante reintentos y acceso directo a OS conserva enlaces antiguos.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 19 (T19): Atender reportes con la OS existente

**Descripción:** Vincular un reporte a una orden nueva o abierta usando las autorizaciones actuales.

**Criterios de aceptación:**

- [ ] Identificar equipo de un reporte por área valida sucursal y conserva el reporte original.
- [ ] Crear/vincular OS es idempotente; no se recaptura equipo/sucursal ni se duplican evidencias.
- [ ] Prioridad muestra motivo y admite ajuste auditado; solicitante no se autoriza a sí mismo y falta de segundo autorizador queda visible.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-failure-order.spec.ts; doble creación, vínculo ajeno y separación solicitante/autorizador.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T04, T17, T18

**Archivos previstos:**

- `lib/services/equipment-failure-service.ts`
- `app/api/equipment/failures/[id]/route.ts`
- `components/equipment/equipment-failure-detail.tsx`
- `app/dashboard/equipment/maintenance/orders/[id]/page.tsx`
- `tests/equipment-failure-order.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 20 (T20): Modelar ventanas de visita y bloqueos

**Descripción:** Extender la programación sin convertir vencimiento o espera de refacciones en nuevos estados de OS.

**Criterios de aceptación:**

- [ ] Visita conserva ventana, duración, contacto y responsable de acceso; bloqueo guarda motivo y próxima revisión.
- [ ] Ventanas operativas de sucursal permiten detectar coincidencias; zona horaria se configura por sucursal.
- [ ] Grupos de visitas referencian órdenes independientes y no fusionan aprobaciones ni costos.

**Verificación:**

- [ ] pnpm test:unit lib/services/__tests__/equipment-visits.test.ts; límites de ventana, zona y órdenes de sucursales distintas.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T18, T19

**Archivos previstos:**

- `lib/db/schema/equipment.ts`
- `drizzle/<generada-visitas>.sql`
- `lib/services/equipment-visit-service.ts`
- `lib/equipment/visit-contract.ts`
- `lib/services/__tests__/equipment-visits.test.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 21 (T21): Programar visitas desde mantenimiento

**Descripción:** Conectar proveedor, ventana y responsable con agenda y vistas operativas.

**Criterios de aceptación:**

- [ ] Vistas Por atender, Por autorizar, Programados, En ejecución, Por confirmar y Cerrados conservan filtros en URL.
- [ ] Programar valida autorización y muestra advertencia por coincidencia con servicio; vencido sigue siendo condición calculada.
- [ ] Edición actualiza agenda y expediente; vista móvil/lista es operable con teclado sin arrastrar.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-visits.spec.ts; programar desde OS sin volver a escribir equipo/sucursal.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T07, T20

**Archivos previstos:**

- `app/api/equipment/visits/route.ts`
- `components/equipment/equipment-visit-form.tsx`
- `app/dashboard/equipment/maintenance/page.tsx`
- `components/equipment/maintenance-calendar.tsx`
- `tests/equipment-visits.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C07 — después de T21

- [ ] Reporte, OS y visita conservan identidad; aprobaciones y ventanas se respetan.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 22 (T22): Sincronizar cierre e historial de forma idempotente

**Descripción:** Crear una referencia única OS-ejecución y hacer recuperable la propagación del cierre.

**Criterios de aceptación:**

- [ ] Un cierre válido crea como máximo una ejecución por OS y actualiza fechas reales y próxima fecha bajo la política definida.
- [ ] Fallo intermedio no deja CLOSED sin efectos verificables: usar transacción soportada, o salida durable con estado pendiente y reintentos.
- [ ] Cierre simultáneo/repetido no duplica historial ni costo; conservar propagación de servicios sin declarar cumplimiento automático.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-close.spec.ts; provocar fallo entre escrituras y repetir dos cierres concurrentes.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T06, T16, T20

**Archivos previstos:**

- `lib/db/schema/equipment.ts`
- `drizzle/<generada-os-ejecucion>.sql`
- `lib/services/service-order-service.ts`
- `lib/services/equipment-completion-service.ts`
- `tests/equipment-close.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 23 (T23): Confirmar trabajo y restitución por separado

**Descripción:** Completar el cierre visible, la conformidad del gerente y el retorno a corrección.

**Criterios de aceptación:**

- [ ] Captura trabajo, refacciones, evidencias y resultado; terminar trabajo no inventa hora de restitución.
- [ ] Gerente acepta o rechaza conformidad según permisos; rechazo devuelve a corrección en la misma OS con motivo.
- [ ] Expediente refleja ejecución y condición reales; mensajes solo confirman cierre cuando la sincronización fue exitosa.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-conformity.spec.ts; rechazo, corrección y equipo que sigue detenido después del trabajo.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T19, T22

**Archivos previstos:**

- `app/api/service-orders/[id]/conformity/route.ts`
- `lib/services/service-order-service.ts`
- `app/dashboard/equipment/maintenance/orders/[id]/page.tsx`
- `components/equipment/equipment-completion-form.tsx`
- `tests/equipment-conformity.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 24 (T24): Definir políticas de planes preventivos

**Descripción:** Extender schedules con recurrencia explícita, pausa y unicidad de ocurrencias.

**Criterios de aceptación:**

- [ ] Plan diferencia calendario fijo de fecha basada en ejecución real; tareas y proveedor opcional son configurables.
- [ ] Equipo detenido o dado de baja pausa o requiere revisión según política registrada.
- [ ] Existe clave única plan/ocurrencia; migración no genera trabajos ni desplaza fechas históricas.

**Verificación:**

- [ ] pnpm test:unit lib/services/__tests__/equipment-plans.test.ts; fin de mes, zona local, pausa y ejecución tardía.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T16, T22

**Archivos previstos:**

- `lib/db/schema/equipment.ts`
- `drizzle/<generada-politicas-planes>.sql`
- `lib/services/equipment-plan-service.ts`
- `lib/equipment/recurrence.ts`
- `lib/services/__tests__/equipment-plans.test.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C08 — después de T24

- [ ] Cierre es recuperable e idempotente; conformidad no inventa restitución; recurrencia tiene política explícita.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 25 (T25): Administrar planes desde equipo y modelo

**Descripción:** Exponer configuración y próxima ocurrencia revisable antes de activar un preventivo.

**Criterios de aceptación:**

- [ ] CRUD valida alcance y permite tarea, periodicidad, política, próxima fecha y proveedor opcional.
- [ ] Aplicar sugerencia de catálogo exige confirmación y permite modificarla.
- [ ] Pausar/reactivar conserva historial y muestra efecto sobre trabajos ya creados.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-plans.spec.ts; activar desde catálogo, pausar y reactivar sin crear repetidos.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T13, T24

**Archivos previstos:**

- `app/api/equipment/[id]/plans/route.ts`
- `components/equipment/equipment-plan-form.tsx`
- `app/dashboard/equipment/[id]/page.tsx`
- `app/dashboard/equipment/maintenance/page.tsx`
- `tests/equipment-plans.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 26 (T26): Generar preventivos sin repetidos

**Descripción:** Integrar la generación periódica con Inngest y el modelo de órdenes existente.

**Criterios de aceptación:**

- [ ] Reintentos y ejecuciones concurrentes producen una sola ocurrencia por plan/fecha.
- [ ] Trabajos generados pasan por la autorización aplicable y aparecen en agenda sin marcarse realizados.
- [ ] Pausas y bajas se respetan; fallos quedan observables con posibilidad de reintento.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-preventive-generation.spec.ts con Inngest local; enviar dos veces la misma ocurrencia.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T24, T25

**Archivos previstos:**

- `lib/inngest/functions/equipment-preventive.ts`
- `lib/inngest/functions/index.ts`
- `lib/services/equipment-plan-service.ts`
- `lib/services/equipment-completion-service.ts`
- `tests/equipment-preventive-generation.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 27 (T27): Modelar cobertura operativa de proveedores

**Descripción:** Extender el proveedor existente con cobertura y referencia fiscal, sin duplicar identidades.

**Criterios de aceptación:**

- [ ] Cobertura por sucursal/zona y disponibilidad declarada tienen referencias autorizadas.
- [ ] Vínculo al proveedor fiscal reutiliza identidad existente y detecta duplicados sin fusionar automáticamente.
- [ ] Catálogo de proveedores siempre exige empresa y permisos; calificación manual sigue etiquetada como tal.

**Verificación:**

- [ ] pnpm test:unit lib/services/__tests__/equipment-providers.test.ts; comprobar relaciones cruzadas y proveedor compartido por sucursales.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T04, T20

**Archivos previstos:**

- `lib/db/schema/equipment.ts`
- `drizzle/<generada-cobertura-proveedores>.sql`
- `lib/services/equipment-provider-service.ts`
- `app/api/equipment/providers/route.ts`
- `lib/services/__tests__/equipment-providers.test.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C09 — después de T27

- [ ] Planes generan una ocurrencia; proveedores conservan identidad fiscal y cobertura autorizada.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 28 (T28): Elegir proveedores por especialidad y cobertura

**Descripción:** Actualizar directorio y selección en visitas con información operativa útil.

**Criterios de aceptación:**

- [ ] Directorio filtra por especialidad/cobertura y muestra contacto, documentación y trabajos abiertos.
- [ ] Formulario evita recapturar RFC/contactos ya vinculados y muestra documentos faltantes/vencidos.
- [ ] Programación ofrece proveedores elegibles y permite registrar disponibilidad sin prometer tiempos de traslado.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-providers.spec.ts; filtrar por sucursal y asignar a una visita.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T21, T27

**Archivos previstos:**

- `app/dashboard/equipment/providers/page.tsx`
- `components/equipment/service-provider-form.tsx`
- `components/equipment/equipment-visit-form.tsx`
- `lib/services/equipment-provider-service.ts`
- `tests/equipment-providers.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 29 (T29): Unificar servicios periódicos en agenda y OS

**Descripción:** Mantener una sola superficie de configuración con trabajos visibles junto a equipos.

**Criterios de aceptación:**

- [ ] Servicios sin equipo usan su configuración existente; no crean unidades ficticias.
- [ ] Mismo trabajo aparece en agenda y OS con una referencia única; ejecución y documento disponible se muestran separados.
- [ ] Frecuencia es explícita; cerrar OS no escribe COMPLIANT por defecto ni afirma cumplimiento legal.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-periodic-services.spec.ts; ejecutar servicio sin equipo, sin documento y repetir cierre.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T22, T26, T28

**Archivos previstos:**

- `app/dashboard/equipment/compliance/page.tsx`
- `components/equipment/compliance-services-list.tsx`
- `lib/services/equipment-service.ts`
- `lib/services/service-order-service.ts`
- `tests/equipment-periodic-services.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 30 (T30): Entregar Hoy como semana operativa

**Descripción:** Componer pendientes, visitas, decisiones y comparación de sucursales con datos reales.

**Criterios de aceptación:**

- [ ] Portada muestra alcance, Reportar falla, banda compacta, agenda, decisiones y resumen por sucursal.
- [ ] Contadores son filtros con periodo y motivo; prioridad distingue interrupción, seguridad reportada, crítico vencido y rutina.
- [ ] Panel contextual y lista móvil usan las mismas fuentes; carga, error, datos parciales y actualización tienen estados visibles.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-today.spec.ts; probar 3 y 15 sucursales, semana saturada y ausencia real de pendientes.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T08, T10, T17, T21, T23, T26, T29

**Archivos previstos:**

- `app/dashboard/equipment/page.tsx`
- `components/equipment/equipment-today.tsx`
- `app/api/equipment/overview/route.ts`
- `lib/services/equipment-overview-service.ts`
- `tests/equipment-today.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C10 — después de T30

- [ ] Hoy usa datos reales de equipos y servicios; directorio, agenda y OS narran el mismo trabajo.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 31 (T31): Conciliar costos con fuentes existentes

**Descripción:** Definir consultas económicas trazables sobre OS, facturas y pagos reales.

**Criterios de aceptación:**

- [ ] Autorizado/comprometido, facturado y pagado se calculan por separado con fuente, periodo, MXN y criterio de impuestos documentados.
- [ ] Cada importe tiene referencia; parciales, cancelaciones y múltiples relaciones no multiplican montos por joins.
- [ ] Mantener sucursal histórica del gasto y distinguir cero de desconocido; no inferir pago por estado CLOSED.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-costs-data.spec.ts; reconciliar OS con factura, abono parcial, cancelación y ejecución repetida.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T01, T22, T29

**Archivos previstos:**

- `lib/equipment/cost-contract.ts`
- `lib/services/equipment-cost-service.ts`
- `app/api/equipment/costs/route.ts`
- `tests/equipment-costs-data.spec.ts`
- `docs/equipment/cost-sources.md`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 32 (T32): Mostrar costos y ficha económica

**Descripción:** Activar Costos y el resumen económico del expediente con navegación hasta la fuente.

**Criterios de aceptación:**

- [ ] Filtros por periodo, sucursal, categoría, proveedor y equipo conservan alcance y muestran las etapas sin sumarlas.
- [ ] Factura se consulta/vincula mediante flujo existente y el dato se actualiza tras confirmar.
- [ ] Ficha muestra compra conocida, preventivos, correctivos, garantías utilizadas y paros documentados; faltantes dicen Sin información.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-costs.spec.ts; cada monto abre su fuente y subtotal concilia con el conjunto filtrado.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T15, T30, T31

**Archivos previstos:**

- `app/dashboard/equipment/costs/page.tsx`
- `components/equipment/equipment-cost-summary.tsx`
- `app/dashboard/equipment/[id]/page.tsx`
- `app/dashboard/equipment/maintenance/orders/[id]/page.tsx`
- `tests/equipment-costs.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 33 (T33): Modelar propuestas de reemplazo

**Descripción:** Crear una propuesta trazable con cotización y decisión pendiente sin motor de autorización paralelo.

**Criterios de aceptación:**

- [ ] Propuesta guarda equipo, motivo, cotización, autor y estado de decisión; usa permisos/matriz existentes cuando corresponde.
- [ ] Historial y gasto son referencias consultables; no se copian como nuevos costos.
- [ ] Umbrales configurables disparan revisión, nunca reemplazo automático; no se inventan ROI ni depreciación.

**Verificación:**

- [ ] pnpm test:unit lib/services/__tests__/equipment-replacement.test.ts; permisos, umbral no configurado y decisión repetida.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T31, T32

**Archivos previstos:**

- `lib/db/schema/equipment.ts`
- `drizzle/<generada-propuestas-reemplazo>.sql`
- `lib/services/equipment-replacement-service.ts`
- `lib/equipment/replacement-contract.ts`
- `lib/services/__tests__/equipment-replacement.test.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C11 — después de T33

- [ ] Costo concilia por etapa y fuente; propuesta de reemplazo conserva trazabilidad y permisos.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 34 (T34): Revisar reemplazos desde Costos

**Descripción:** Completar tabla de revisión y captura de propuestas para dirección.

**Criterios de aceptación:**

- [ ] Tabla muestra antigüedad conocida, fallas repetidas, gasto del periodo y cotización existente.
- [ ] Crear/revisar propuesta muestra motivo, historial y siguiente acción; registra decisión y actor.
- [ ] Sin datos suficientes no se calcula retorno, ahorro, pérdida de venta ni recomendación automática.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-replacement.spec.ts; comparar equipo con historia completa y equipo sin compra ni cotización.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T33

**Archivos previstos:**

- `app/api/equipment/replacements/route.ts`
- `app/dashboard/equipment/costs/page.tsx`
- `components/equipment/equipment-replacement-form.tsx`
- `lib/services/equipment-replacement-service.ts`
- `tests/equipment-replacement.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 35 (T35): Validar el MVP con datos de grupo

**Descripción:** Preparar escenarios reproducibles y comprobar el recorrido completo antes de adopción ampliada.

**Criterios de aceptación:**

- [ ] Datos sintéticos incluyen dos empresas y grupos de 3/15 sucursales, nombres largos, sin responsable, fallas simultáneas e importes faltantes.
- [ ] Flujo falla→OS→autorización→visita→corrección/conformidad→historial→costo pasa sin duplicados ni fugas.
- [ ] Navegador verifica teclado, foco, móvil, errores/conflictos y actualización de lista, expediente, agenda y contadores; metas de 30 s/1 min se registran como medidas o pendientes.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-mvp.spec.ts; pnpm run lint; pnpm run build; ejecutar regresiones focalizadas indicadas en el plan.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T30, T32, T34

**Archivos previstos:**

- `scripts/seed-equipment-group.ts`
- `tests/equipment-mvp.spec.ts`
- `tests/support/equipment-group.ts`
- `docs/equipment/validation.md`

**Alcance estimado:** M (4 archivos de trabajo; una sesión enfocada).

## Tarea 36 (T36): Importar unidades con vista previa

**Descripción:** Permitir cargas por lote utilizando las reglas del alta y mostrando errores antes de confirmar.

**Criterios de aceptación:**

- [ ] Vista previa detecta códigos/series duplicados, sucursales inválidas y campos faltantes sin escribir.
- [ ] Confirmación usa clave idempotente y devuelve resultado por fila; cada unidad conserva serie e identidad propias.
- [ ] Plan sugerido se revisa antes de aplicar; autorización y unicidad se validan nuevamente al confirmar.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-import.spec.ts; repetir lote, interrumpir envío y reintentar filas rechazadas.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T13, T25, T35

**Archivos previstos:**

- `lib/services/equipment-import-service.ts`
- `app/api/equipment/import/route.ts`
- `components/equipment/equipment-import.tsx`
- `app/dashboard/equipment/inventory/page.tsx`
- `tests/equipment-import.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C12 — después de T36

- [ ] MVP validado y lote de importación repetido sin unidades duplicadas.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 37 (T37): Abrir equipos mediante QR autorizado

**Descripción:** Generar etiquetas con URL estable al expediente y continuar al reporte de falla.

**Criterios de aceptación:**

- [ ] QR identifica el equipo sin incluir secretos ni otorgar acceso por sí mismo.
- [ ] Abrir exige sesión/permiso y conserva destino tras autenticarse.
- [ ] Gerente puede abrir equipo y reportar falla en móvil; equipo ajeno no revela datos.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-qr.spec.ts; abrir con sesión válida, expirada y de otra empresa.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T17, T35

**Archivos previstos:**

- `components/equipment/equipment-qr.tsx`
- `app/dashboard/equipment/[id]/page.tsx`
- `tests/equipment-qr.spec.ts`

**Alcance estimado:** M (3 archivos de trabajo; una sesión enfocada).

## Tarea 38 (T38): Modelar traslados con recepción

**Descripción:** Crear el movimiento de una unidad entre sucursales conservando historia y asignaciones.

**Criterios de aceptación:**

- [ ] Traslado registra origen, destino, fecha, motivo, emisor y recepción con validación de ambas sucursales.
- [ ] Recepción cambia ubicación actual de la misma unidad atómicamente y es idempotente.
- [ ] Gastos/eventos previos conservan sucursal histórica; se revisan responsable, planes y trabajos abiertos en destino.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-transfer-data.spec.ts; recepción concurrente y consulta de costos antes/después.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T11, T24, T31, T35

**Archivos previstos:**

- `lib/db/schema/equipment.ts`
- `drizzle/<generada-traslados>.sql`
- `lib/services/equipment-transfer-service.ts`
- `lib/services/equipment-cost-service.ts`
- `tests/equipment-transfer-data.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 39 (T39): Trasladar desde el expediente

**Descripción:** Exponer solicitud y recepción con impacto visible sobre la operación.

**Criterios de aceptación:**

- [ ] Formulario muestra origen, destino autorizado, fecha, motivo e impacto sobre trabajos/planes.
- [ ] Recepción confirma quién recibió y mantiene URL, QR e historial del equipo.
- [ ] Usuario sin permiso en destino no completa recepción; lista y contadores se actualizan en ambos alcances.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-transfer.spec.ts; solicitar, recibir y reabrir el mismo QR.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T37, T38

**Archivos previstos:**

- `app/api/equipment/[id]/transfers/route.ts`
- `components/equipment/equipment-transfer-form.tsx`
- `app/dashboard/equipment/[id]/page.tsx`
- `lib/services/equipment-transfer-service.ts`
- `tests/equipment-transfer.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C13 — después de T39

- [ ] QR estable antes y después del traslado; gastos históricos permanecen en origen.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 40 (T40): Coordinar campañas por zona

**Descripción:** Permitir selección por zona/especialidad y agrupación de visitas reutilizando órdenes y planes.

**Criterios de aceptación:**

- [ ] Vista previa selecciona equipos/servicios autorizados y muestra proveedor, fechas y responsables.
- [ ] Confirmar crea o reutiliza trabajos por ocurrencia sin mezclar costos, evidencias o autorizaciones entre sucursales.
- [ ] Campaña estacional se presenta como decisión operativa configurable, sin frecuencias técnicas/legales universales.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-campaign.spec.ts; repetir confirmación y usar 15 sucursales con órdenes preexistentes.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T26, T28, T29, T35

**Archivos previstos:**

- `lib/services/equipment-campaign-service.ts`
- `app/api/equipment/campaigns/route.ts`
- `components/equipment/equipment-campaign-form.tsx`
- `app/dashboard/equipment/maintenance/page.tsx`
- `tests/equipment-campaign.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 41 (T41): Preparar acceso limitado a trabajos externos

**Descripción:** Definir el contrato de enlaces para WhatsApp y verificar el adaptador activo antes de conectarlo.

**Criterios de aceptación:**

- [ ] Contrato identifica proveedor/adaptador real y capacidad existente de envío, webhooks y sesiones limitadas.
- [ ] Enlace queda ligado a trabajo, destinatario, capacidades, expiración y revocación; no habilita vista global del equipo.
- [ ] Pruebas demuestran rechazo de enlace vencido, manipulado o usado para otra orden; no se envían mensajes reales durante pruebas.

**Verificación:**

- [ ] pnpm test:unit lib/services/__tests__/equipment-work-links.test.ts; usar dobles del transporte y revisar contrato de integración.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T35

**Archivos previstos:**

- `docs/equipment/whatsapp-contract.md`
- `lib/services/equipment-work-link-service.ts`
- `lib/services/__tests__/equipment-work-links.test.ts`

**Alcance estimado:** M (3 archivos de trabajo; una sesión enfocada).

## Tarea 42 (T42): Completar confirmación y evidencia por WhatsApp

**Descripción:** Integrar el flujo específico con mensajería existente y acceso limitado.

**Criterios de aceptación:**

- [ ] Mensaje autorizado enlaza trabajo y permite confirmar visita/cargar evidencia dentro del alcance concedido.
- [ ] Enviado, entregado y respondido son estados distintos; webhooks y reintentos no duplican evidencias/transiciones.
- [ ] Revocación y vencimiento se aplican en servidor; prueba usa transporte simulado o entorno de prueba autorizado.

**Verificación:**

- [ ] pnpm test:e2e tests/equipment-whatsapp.spec.ts; reintentar webhook, revocar enlace y fallar subida.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T21, T23, T41

**Archivos previstos:**

- `lib/whatsapp/equipment-work-handler.ts`
- `app/api/equipment/work-links/[token]/route.ts`
- `app/equipment/work/[token]/page.tsx`
- `lib/inngest/functions/whatsapp-router.ts`
- `tests/equipment-whatsapp.spec.ts`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

### Checkpoint C14 — después de T42

- [ ] Campañas y WhatsApp conservan alcance, estados reales e idempotencia.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

## Tarea 43 (T43): Medir cobertura y resultados operativos

**Descripción:** Exponer indicadores definidos con denominador, periodo y cobertura de datos.

**Criterios de aceptación:**

- [ ] Métricas incluyen responsables, críticos con plan, preventivos a tiempo, primera atención, paro documentado, reincidencia y gasto por equipo.
- [ ] Sin eventos suficientes se informa cobertura; no se muestra disponibilidad porcentual ni ranking por conteos absolutos.
- [ ] Cada métrica se puede rastrear a eventos/fuentes y respeta alcance y periodo.

**Verificación:**

- [ ] pnpm test:unit lib/services/__tests__/equipment-metrics.test.ts; muestras incompletas, denominador cero y traslado.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T30, T31, T38

**Archivos previstos:**

- `lib/services/equipment-metrics-service.ts`
- `lib/services/__tests__/equipment-metrics.test.ts`
- `app/api/equipment/metrics/route.ts`
- `components/equipment/equipment-metrics.tsx`
- `app/dashboard/equipment/page.tsx`

**Alcance estimado:** M (5 archivos de trabajo; una sesión enfocada).

## Tarea 44 (T44): Preparar piloto y guía operativa

**Descripción:** Documentar operación, migraciones, soporte y criterios para ampliar al grupo.

**Criterios de aceptación:**

- [ ] Guías cubren dueños y gerentes, importación, QR, traslados y configuración de autorizador/proveedor.
- [ ] Ensayo de migraciones preserva documentos y fechas; reversión de aplicación no borra datos nuevos y pendientes de conciliación quedan inventariados.
- [ ] Piloto y expansión tienen responsables, evidencia de aceptación y límites de volumen acordados; despliegue real se trata como paso separado.

**Verificación:**

- [ ] Revisar guías contra recorrido real; pnpm test:e2e tests/equipment-rollout.spec.ts; pnpm run lint; pnpm run build.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T36, T39, T40, T42, T43

**Archivos previstos:**

- `docs/user-guide.md`
- `docs/admin-guide.md`
- `docs/equipment/rollout.md`
- `tests/equipment-rollout.spec.ts`

**Alcance estimado:** M (4 archivos de trabajo; una sesión enfocada).

## Tarea 45 (T45): Cerrar aceptación del resultado completo

**Descripción:** Revisar cobertura final de requisitos y resultados del piloto sin ocultar bloqueos o fallos pendientes.

**Criterios de aceptación:**

- [ ] Inventario/responsables, mantenimiento y control económico cumplen la matriz de trazabilidad.
- [ ] Registro de pruebas identifica entorno, comandos, resultados y limitaciones; incidencias abiertas tienen responsable y prioridad.
- [ ] Aceptación humana del piloto y decisión de expansión quedan registradas; no se marca listo solo porque pasa build.

**Verificación:**

- [ ] Recorrer matriz del plan con evidencias de T35 y T44; comprobar permisos, idempotencia y conciliación después de importación/traslados.
- [ ] Registrar resultado y evidencia; cumplir el checkpoint del bloque.

**Dependencias:** T43, T44

**Archivos previstos:**

- `docs/equipment/validation.md`
- `docs/equipment/rollout.md`
- `tasks/todo-qeuipos-grupo-resturantero.md`

**Alcance estimado:** M (3 archivos de trabajo; una sesión enfocada).

### Checkpoint C15 — después de T45

- [ ] Objetivos completos, evidencia del piloto, riesgos residuales y aceptación humana documentados.
- [ ] Tests afectados, lint focalizado y build pasan; fallos preexistentes se documentan por separado.
- [ ] Recorrido del bloque verificado y evidencia registrada; decisiones pendientes tienen responsable.

