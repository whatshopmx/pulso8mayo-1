# Seguimiento — conexión entre frontend y backend

Fecha: 10 de octubre de 2026. Actualización: 11 de octubre de 2026. Estado: C00–C10 implementadas; C11–C40 pendientes. Los recorridos de navegador aún no comprobados se conservan explícitos en la evidencia.

Plan: [plan de implementación](plan-conexion-frontend-backend.md). Origen: [auditoría](../docs/audits/2026-10-10-backend-frontend-wiring-audit.md).

Marcar una tarea solo cuando cumpla sus criterios y tenga evidencia. Registrar por ID: estado, fecha, cambio/commit, pruebas, resultado y límites pendientes. Los criterios completos están en el plan. No usar un bloqueo de pruebas como evidencia de éxito.

## Fase 0 — Preparación y trazabilidad

- [x] [C00 — Establecer línea base y mapa de recorridos](plan-conexion-frontend-backend.md#c00) — depende de ninguna. Evidencia: [línea base](../docs/audits/2026-10-10-conexion-linea-base.md).

- [ ] Puerta de fase: aceptación y verificación registradas; build/lint y regresiones pertinentes revisados.

## Fase 1 — Permisos y aislamiento de empresa — P0

- [x] [C01 — Acotar la lectura de turnos](plan-conexion-frontend-backend.md#c01) — depende de C00.
- [x] [C02 — Autorizar las escrituras de turnos](plan-conexion-frontend-backend.md#c02) — depende de C01.
- [x] [C03 — Unificar autorización de plantillas](plan-conexion-frontend-backend.md#c03) — depende de C00.
- [x] [C04 — Acotar creación y lectura de ejecuciones](plan-conexion-frontend-backend.md#c04) — depende de C03.
- [x] [C05 — Autorizar actualización y revisión de pasos](plan-conexion-frontend-backend.md#c05) — depende de C04.
- [x] [C06 — Acotar consultas de sesiones y descansos](plan-conexion-frontend-backend.md#c06) — depende de C00.
- [x] [C07 — Verificar pertenencia al cambiar costeo](plan-conexion-frontend-backend.md#c07) — depende de C00.

- [x] Puerta de fase: aceptación y verificación registradas; build/lint y regresiones pertinentes revisados. `lint` 0 errores · `build` OK · `test:unit` 789/789 (61 archivos). Las siete entradas revisadas de la Fase 1 preguntas por empresa, alcance de sucursal y permiso; `workflow_instances`, `shift_sessions` y `workflow_instance_steps` no guardan empresa y se acotan por `branch_id`, lo cual queda fijado en pruebas.

## Fase 2 — Planificador de turnos con datos reales

- [x] [C08 — Cargar empleados y sucursales reales en el planificador](plan-conexion-frontend-backend.md#c08) — depende de C01, C02.
- [x] [C09 — Aplicar una política de validación de turnos](plan-conexion-frontend-backend.md#c09) — depende de C02, C08.
- [x] [C10 — Completar exportación de turnos](plan-conexion-frontend-backend.md#c10) — depende de C08. Evidencia: [exportación CSV](../docs/audits/2026-10-11-shifts-export.md).
- [ ] [C11 — Aplicar plantillas de turnos válidas](plan-conexion-frontend-backend.md#c11) — depende de C09.
- [ ] [C12 — Completar asignación masiva de turnos](plan-conexion-frontend-backend.md#c12) — depende de C11.

- [ ] Puerta de fase: aceptación y verificación registradas; build/lint y regresiones pertinentes revisados.

## Fase 3 — Configuración que produce efectos

- [ ] [C13 — Conservar valores y errores de configuración](plan-conexion-frontend-backend.md#c13) — depende de C00.
- [ ] [C14 — Exponer parámetros consumidos que faltan en la interfaz](plan-conexion-frontend-backend.md#c14) — depende de C13.
- [ ] [C15 — Definir el contrato de cada política operativa](plan-conexion-frontend-backend.md#c15) — depende de C13.
- [ ] [C16 — Aplicar política de estructura de compras](plan-conexion-frontend-backend.md#c16) — depende de C15.
- [ ] [C17 — Aplicar política de producción de alimentos](plan-conexion-frontend-backend.md#c17) — depende de C15.
- [ ] [C18 — Aplicar política de tesorería](plan-conexion-frontend-backend.md#c18) — depende de C15.
- [ ] [C19 — Aplicar política de pagos a proveedores](plan-conexion-frontend-backend.md#c19) — depende de C15.
- [ ] [C20 — Aplicar política de autonomía del gerente](plan-conexion-frontend-backend.md#c20) — depende de C15, C16.
- [ ] [C21 — Aplicar política de dispersión de nómina](plan-conexion-frontend-backend.md#c21) — depende de C15.
- [ ] [C22 — Aplicar política del tipo de empresa](plan-conexion-frontend-backend.md#c22) — depende de C15.
- [ ] [C23 — Resolver el límite de caja chica](plan-conexion-frontend-backend.md#c23) — depende de C15.

- [ ] Puerta de fase: aceptación y verificación registradas; build/lint y regresiones pertinentes revisados.

## Fase 4 — Workflows y verificación

- [ ] [C24 — Validar el contrato del paso en servidor](plan-conexion-frontend-backend.md#c24) — depende de C05.
- [ ] [C25 — Transmitir configuración de IA a la ejecución](plan-conexion-frontend-backend.md#c25) — depende de C24.
- [ ] [C26 — Conservar confianza mínima en el veredicto IA](plan-conexion-frontend-backend.md#c26) — depende de C25.
- [ ] [C27 — Hacer única la transición de finalización](plan-conexion-frontend-backend.md#c27) — depende de C24.
- [ ] [C28 — Garantizar entrega de eventos y mostrar efectos pendientes](plan-conexion-frontend-backend.md#c28) — depende de C27.

- [ ] Puerta de fase: aceptación y verificación registradas; build/lint y regresiones pertinentes revisados.

## Fase 5 — Métricas consistentes

- [ ] [C29 — Compartir definiciones financieras entre motores](plan-conexion-frontend-backend.md#c29) — depende de C14.
- [ ] [C30 — Distinguir dato real, estimado y ausente](plan-conexion-frontend-backend.md#c30) — depende de C29.
- [ ] [C31 — Verificar efecto financiero desde configuración hasta pantalla](plan-conexion-frontend-backend.md#c31) — depende de C30.

- [ ] Puerta de fase: aceptación y verificación registradas; build/lint y regresiones pertinentes revisados.

## Fase 6 — Notificaciones verificables

- [ ] [C32 — Unificar contrato de preferencias de notificación](plan-conexion-frontend-backend.md#c32) — depende de C00.
- [ ] [C33 — Aplicar una sola decisión de canal](plan-conexion-frontend-backend.md#c33) — depende de C32.
- [ ] [C34 — Registrar fallos y reintentar por canal](plan-conexion-frontend-backend.md#c34) — depende de C33.
- [ ] [C35 — Consolidar productores de notificaciones activos](plan-conexion-frontend-backend.md#c35) — depende de C34.

- [ ] Puerta de fase: aceptación y verificación registradas; build/lint y regresiones pertinentes revisados.

## Fase 7 — Consolidación y cierre

- [ ] [C36 — Clasificar implementación anterior y módulos sin uso](plan-conexion-frontend-backend.md#c36) — depende de C00.
- [ ] [C37 — Retirar el executor anterior confirmado sin consumidores](plan-conexion-frontend-backend.md#c37) — depende de C28, C36.
- [ ] [C38 — Resolver componentes y servicios huérfanos por lote](plan-conexion-frontend-backend.md#c38) — depende de C36.
- [ ] [C39 — Alinear documentación y punto de entrada del esquema](plan-conexion-frontend-backend.md#c39) — depende de C36.
- [ ] [C40 — Cerrar la auditoría con evidencia de recorridos](plan-conexion-frontend-backend.md#c40) — depende de C00–C39.

- [ ] Puerta de fase: aceptación y verificación registradas; build/lint y regresiones pertinentes revisados.

## Evidencia de ejecución

Las filas conservan la evidencia y los pendientes de cada corte histórico. C10 registra la validación del 11-10-2026; no sustituye las verificaciones anteriores que siguen sin ejecutarse. El estado vigente de tareas aparece en las listas de cada fase.

| ID | Estado | Fecha | Cambio/commit | Verificación y resultado | Pendientes/decisión |
| --- | --- | --- | --- | --- | --- |
| C00 | Completada | 2026-10-10 | `927c241` | V0: lint 0 errores (2422 warnings), build OK, test:unit 662/667 con 3 fallos preexistentes ya resueltos en `4240d44` y `28aa333` (hoy 719/719 en verde). Matriz de 12 hallazgos y de rol/empresa/sucursal, más `tests/fixtures/tenant-isolation.ts` | Sin V2 (todavía no hay cambios de comportamiento) |
| C01 | Completada | 2026-10-10 | `7305267` | `tests/unit/shifts/shift-access.test.ts` (16) + `read-scope.test.ts` (9), `pnpm exec vitest run tests/unit/shifts/`. WHERE revisado con `PgDialect.sqlToQuery` | Queda el camino HTTP `app/api/shifts/route.ts`, que tiene su propia validación: lo unifica C09 |
| C02 | Completada | 2026-10-10 | `4b49c8c` | `tests/unit/shifts/write-scope.test.ts` (16). Crear/editar/borrar/publicar/duplicar rechazan destino ajeno antes de escribir | El planificador (H03) manda empleados y sucursales ficticios: ahora la escritura se rechaza en vez de colarse. Lo resuelve C08 |
| C03 | Completada | 2026-10-10 | `f0c5499` | `tests/unit/workflows/template-access.test.ts` (13) sobre las funciones reales de la ruta corta y la política compartida | Falta V2 del borrado desde el administrador y el caso de plantillas globales; C36 inventaría consumidores antes de retirar la ruta corta |
| C04 | Completada | 2026-10-10 | `361a3b3` | `tests/unit/workflows/execution-access.test.ts` (27): puerta, alcance y status HTTP de las dos rutas | Falta V2 de inicio y consulta válidos en navegador. C05 sigue abierta: la actualización de pasos llega al servicio sin alcance |
| C05 | Completada | 2026-10-10 | `ceea6c7`, `f701068`, `f354519` | `tests/unit/workflows/step-access.test.ts` (26): paso por sesión vs por token, revisión por rol y sucursal, auto-revisión contra responsable y autoría, y la excepción que la abre | **Decisión pendiente:** qué roles revisan. Se implementó la lectura conservadora de "revisión del supervisor" (SUPERVISOR+); falta que el negocio la confirme en C15. La auto-revisión se cierra con excepción auditada (`policy_overrides`): **falta la pantalla** para concederla, la puerta de servidor ya existe. Falta V2 del recorrido ejecutar/revisar |
| C06 | Completada | 2026-10-10 | `a241f7b` | `tests/unit/labor/session-scope.test.ts` (16). SQL revisado con `PgDialect`; el filtro de empresa se comprueba dentro del subselect de `branches` | Sin V2: no se reprodujo en navegador |
| C07 | Completada | 2026-10-10 | `008b04f` | `tests/unit/inventory/costing-config-access.test.ts` (8) sobre el `PATCH` real, con `CostingService` simulado para observar si se llega a llamarlo | Sin V2. El `GET` ya filtraba por empresa y no se tocó |
| C08 | Completada | 2026-10-10 | `c93007b`, `6430cad` | `tests/unit/labor/scheduler-catalog.test.ts` (16) sobre la consulta real; tsc, build y `test:unit` 796/796 | **Sin V2**: falta el recorrido en navegador (crear, recargar y comprobar persistencia en dos empresas), que es lo único que verificaría que la pantalla y el servidor cuentan la misma historia. Los roles salen de `employee_profiles.position` + roles ya usados: si nadie tiene puesto capturado, el selector queda vacío a propósito |
| C09 | Completada | 2026-10-10 | `9a07d93`, `980002f`, `a449b16`, `6134b90`, `41232a4` | `tests/unit/labor/business-validation.test.ts` (29) para la política y los marcadores, 8 casos en `write-scope.test.ts` para el servicio autoritativo, `shift-overrides-action.test.ts` (10) para la puerta. tsc limpio, build OK, `test:unit` 861/863 | **Decisión tomada (10-10):** la jornada de 8 h bloquea y su salida es una excepción auditada, con acción, pantalla y reintento de guardado. **Sin verificar:** que el botón funcione en navegador (V2), igual que el resto de la Fase 2. Notado y fuera de alcance: `lft-conflict-detector.ts` y `labor-validation.ts` traen sus propios límites para asistencia |
| C10 | Completada | 2026-10-11 | C10.1–C10.3; [evidencia](../docs/audits/2026-10-11-shifts-export.md) | CSV conectado a semana/filtros; 9 casos unitarios de formato y 7 pruebas en Chromium de descarga, filtros, dos respuestas de empresa, vacío/error/reintento y respuestas tardías. Suite: 870 aprobadas, 1 omitida, 1 TODO; build OK; lint enfocado 0 errores/0 warnings | El navegador usa acciones simuladas; el alcance del servidor se respalda con las pruebas de C01/C08. No verifica creación/recarga de C08 ni excepciones de C09. C11 es el siguiente pendiente |
| C11 | Pendiente | — | — | No ejecutada | — |
| C12 | Pendiente | — | — | No ejecutada | — |
| C13 | Pendiente | — | — | No ejecutada | — |
| C14 | Pendiente | — | — | No ejecutada | — |
| C15 | Pendiente | — | — | No ejecutada | — |
| C16 | Pendiente | — | — | No ejecutada | — |
| C17 | Pendiente | — | — | No ejecutada | — |
| C18 | Pendiente | — | — | No ejecutada | — |
| C19 | Pendiente | — | — | No ejecutada | — |
| C20 | Pendiente | — | — | No ejecutada | — |
| C21 | Pendiente | — | — | No ejecutada | — |
| C22 | Pendiente | — | — | No ejecutada | — |
| C23 | Pendiente | — | — | No ejecutada | — |
| C24 | Pendiente | — | — | No ejecutada | — |
| C25 | Pendiente | — | — | No ejecutada | — |
| C26 | Pendiente | — | — | No ejecutada | — |
| C27 | Pendiente | — | — | No ejecutada | — |
| C28 | Pendiente | — | — | No ejecutada | — |
| C29 | Pendiente | — | — | No ejecutada | — |
| C30 | Pendiente | — | — | No ejecutada | — |
| C31 | Pendiente | — | — | No ejecutada | — |
| C32 | Pendiente | — | — | No ejecutada | — |
| C33 | Pendiente | — | — | No ejecutada | — |
| C34 | Pendiente | — | — | No ejecutada | — |
| C35 | Pendiente | — | — | No ejecutada | — |
| C36 | Pendiente | — | — | No ejecutada | — |
| C37 | Pendiente | — | — | No ejecutada | — |
| C38 | Pendiente | — | — | No ejecutada | — |
| C39 | Pendiente | — | — | No ejecutada | — |
| C40 | Pendiente | — | — | No ejecutada | — |

## Decisiones pendientes

- [ ] Contratos de las siete dimensiones y caja chica registrados en C15.
- [ ] Valores, vigencia y tratamiento de periodos cerrados de parámetros financieros/laborales definidos en C14.
- [ ] Política de horario, urgencias y zona horaria definida en C33.
- [ ] Consumidores externos y eventos pendientes del executor anterior verificados en C36/C37.
- [ ] **Quién revisa un workflow.** C05 implementó la lectura conservadora de la columna del esquema ("Revisión del supervisor"): `SUPERVISOR` y gerencia, excluyendo `EMPLEADO` y `READONLY`. La matriz `workflows` no distingue revisar de ejecutar, así que hace falta una decisión explícita del negocio; hasta entonces la regla vive en `requireReviewAccess` (`lib/workflows/execution-access.ts`). La auto-revisión (`f701068`) se cierra con una excepción auditada en `policy_overrides` (`f354519`), concedible sólo por `OWNER`/`SUPER_ADMIN` — `ADMIN` no, aunque administre la empresa, y esa exclusión también está por confirmar. Falta la pantalla que concede la excepción.
- [x] **Límites de turno: jornada diaria y excepciones.** **Decidido el 10-10-2026:** la jornada de 8 h bloquea y la salida es una excepción auditada (`policy_overrides`, `SHIFT_VALIDATION`/`MAX_DAILY_HOURS`), concedible sólo por `OWNER`/`SUPER_ADMIN` con motivo y caducidad opcional. Cerrado en `a449b16` (política), `6134b90` (acción) y `41232a4` (pantalla con reintento de guardado). Cada infracción lleva su `regla` porque cuatro fallos compartían `DAILY_HOURS`, y el mensaje de rechazo nombra la regla entre corchetes porque las propiedades de un `Error` no sobreviven a un server action.
- [ ] **Unificar los límites de asistencia con los de turnos.** `lft-conflict-detector.ts` y `labor-validation.ts` usan descanso mínimo de 12 h y turno de 12 h, mientras la política de turnos usa 8 h. Son dominios distintos —check-in contra planificado— y no se tocaron en C09; si deben coincidir, es una decisión que aplicar a ambos a la vez.

## Cierre

- [ ] Cada hallazgo H01–H12 tiene estado y evidencia en la auditoría.
- [ ] Las funcionalidades descriptivas se distinguen de las reglas aplicadas.
- [ ] Recorridos con dos empresas y roles distintos verificados.
- [ ] Efectos posteriores y errores parciales verificados.
- [ ] Build, lint y pruebas requeridas registrados sin declarar aprobados los casos no ejecutados.
