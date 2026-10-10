# Seguimiento — conexión entre frontend y backend

Fecha: 10 de octubre de 2026. Estado inicial: todas las tareas pendientes.

Plan: [plan de implementación](plan-conexion-frontend-backend.md). Origen: [auditoría](../docs/audits/2026-10-10-backend-frontend-wiring-audit.md).

Marcar una tarea solo cuando cumpla sus criterios y tenga evidencia. Registrar por ID: estado, fecha, cambio/commit, pruebas, resultado y límites pendientes. Los criterios completos están en el plan. No usar un bloqueo de pruebas como evidencia de éxito.

## Fase 0 — Preparación y trazabilidad

- [x] [C00 — Establecer línea base y mapa de recorridos](plan-conexion-frontend-backend.md#c00) — depende de ninguna. Evidencia: [línea base](../docs/audits/2026-10-10-conexion-linea-base.md).

- [ ] Puerta de fase: aceptación y verificación registradas; build/lint y regresiones pertinentes revisados.

## Fase 1 — Permisos y aislamiento de empresa — P0

- [x] [C01 — Acotar la lectura de turnos](plan-conexion-frontend-backend.md#c01) — depende de C00.
- [x] [C02 — Autorizar las escrituras de turnos](plan-conexion-frontend-backend.md#c02) — depende de C01.
- [x] [C03 — Unificar autorización de plantillas](plan-conexion-frontend-backend.md#c03) — depende de C00.
- [ ] [C04 — Acotar creación y lectura de ejecuciones](plan-conexion-frontend-backend.md#c04) — depende de C03.
- [ ] [C05 — Autorizar actualización y revisión de pasos](plan-conexion-frontend-backend.md#c05) — depende de C04.
- [ ] [C06 — Acotar consultas de sesiones y descansos](plan-conexion-frontend-backend.md#c06) — depende de C00.
- [ ] [C07 — Verificar pertenencia al cambiar costeo](plan-conexion-frontend-backend.md#c07) — depende de C00.

- [ ] Puerta de fase: aceptación y verificación registradas; build/lint y regresiones pertinentes revisados.

## Fase 2 — Planificador de turnos con datos reales

- [ ] [C08 — Cargar empleados y sucursales reales en el planificador](plan-conexion-frontend-backend.md#c08) — depende de C01, C02.
- [ ] [C09 — Aplicar una política de validación de turnos](plan-conexion-frontend-backend.md#c09) — depende de C02, C08.
- [ ] [C10 — Completar exportación de turnos](plan-conexion-frontend-backend.md#c10) — depende de C08.
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

| ID | Estado | Fecha | Cambio/commit | Verificación y resultado | Pendientes/decisión |
| --- | --- | --- | --- | --- | --- |
| C00 | Completada | 2026-10-10 | `927c241` | V0: lint 0 errores (2422 warnings), build OK, test:unit 662/667 con 3 fallos preexistentes ya resueltos en `4240d44` y `28aa333` (hoy 719/719 en verde). Matriz de 12 hallazgos y de rol/empresa/sucursal, más `tests/fixtures/tenant-isolation.ts` | Sin V2 (todavía no hay cambios de comportamiento) |
| C01 | Completada | 2026-10-10 | `7305267` | `tests/unit/shifts/shift-access.test.ts` (16) + `read-scope.test.ts` (9), `pnpm exec vitest run tests/unit/shifts/`. WHERE revisado con `PgDialect.sqlToQuery` | Queda el camino HTTP `app/api/shifts/route.ts`, que tiene su propia validación: lo unifica C09 |
| C02 | Completada | 2026-10-10 | `4b49c8c` | `tests/unit/shifts/write-scope.test.ts` (16). Crear/editar/borrar/publicar/duplicar rechazan destino ajeno antes de escribir | El planificador (H03) manda empleados y sucursales ficticios: ahora la escritura se rechaza en vez de colarse. Lo resuelve C08 |
| C03 | Completada | 2026-10-10 | `f0c5499` | `tests/unit/workflows/template-access.test.ts` (13) sobre las funciones reales de la ruta corta y la política compartida | Falta V2 del borrado desde el administrador y el caso de plantillas globales; C36 inventaría consumidores antes de retirar la ruta corta |
| C03 | Pendiente | — | — | No ejecutada | — |
| C04 | Pendiente | — | — | No ejecutada | — |
| C05 | Pendiente | — | — | No ejecutada | — |
| C06 | Pendiente | — | — | No ejecutada | — |
| C07 | Pendiente | — | — | No ejecutada | — |
| C08 | Pendiente | — | — | No ejecutada | — |
| C09 | Pendiente | — | — | No ejecutada | — |
| C10 | Pendiente | — | — | No ejecutada | — |
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

## Cierre

- [ ] Cada hallazgo H01–H12 tiene estado y evidencia en la auditoría.
- [ ] Las funcionalidades descriptivas se distinguen de las reglas aplicadas.
- [ ] Recorridos con dos empresas y roles distintos verificados.
- [ ] Efectos posteriores y errores parciales verificados.
- [ ] Build, lint y pruebas requeridas registrados sin declarar aprobados los casos no ejecutados.
