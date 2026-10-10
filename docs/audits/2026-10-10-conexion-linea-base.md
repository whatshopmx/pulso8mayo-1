# Línea base y mapa de recorridos — conexión frontend/backend

Fecha: 10 de octubre de 2026. Tarea: [C00](../../tasks/plan-conexion-frontend-backend.md#c00).
Origen: [auditoría de conexiones](2026-10-10-backend-frontend-wiring-audit.md).
Seguimiento: [lista de tareas](../../tasks/todo-conexion-frontend-backend.md).

Este documento es la evidencia de C00. No corrige código: fija contra qué se mide
cada corrección posterior y deja por escrito qué estaba roto antes de tocar nada.
Un fallo que ya existía antes de este trabajo sigue siendo un fallo, pero no es
una regresión de la tarea que lo volvió a tocar.

## 1. Puertas de fase (V0) — ejecución del 10 de octubre de 2026

| Puerta | Comando | Resultado | Estado |
| --- | --- | --- | --- |
| Lint | `pnpm run lint` | 2422 problemas: **0 errores**, 2422 warnings | Verde con deuda de warnings |
| Build | `pnpm run build` | Compila y emite el árbol de rutas completo | Verde |
| Unitarias | `pnpm run test:unit` | 54 archivos: 51 pasan, 3 fallan. 667 pruebas: 662 pasan, 1 skip, 1 todo | **Rojo preexistente** |

### Fallos preexistentes (no tocar salvo tarea propia)

Ninguno tiene relación con turnos, workflows, configuración ni notificaciones:

| Archivo | Fallo | Dónde |
| --- | --- | --- |
| `lib/services/__tests__/tmp-probe-service-order-routes.test.ts` | No carga (0 tests) | Import del módulo bajo prueba |
| `lib/services/__tests__/group-exceptions-service.test.ts` | 2 pruebas: `TypeError` en la cadena `db…where()` simulada | `lib/services/group-exceptions-service.ts:417` |
| `lib/services/__tests__/live-command-service.test.ts` | 1 prueba: `.catch is not a function` sobre un thenable simulado | `lib/services/live-command-service.ts:213` |

Los tres son arneses de prueba desalineados con el código, no defectos de
dominio. Se anotan aquí para que una tarea posterior no los lea como regressions
suyas ni los "arregle" de paso.

**Nota de runner:** no hubo bloqueos del lanzador ni de la base de datos en esta
ejecución. La auditoría original sí los tuvo; esta línea base sí corrió, y por eso
las cifras son comparables entre increments.

## 2. Fixtures de aislamiento

`tests/fixtures/tenant-isolation.ts` fija el vocabulario de dos empresas que
comparten todas las pruebas de autorización:

- **Empresa A** (`EMPRESA_A`) con sucursales `SUCURSAL_A_1` y `SUCURSAL_A_2`;
  **Empresa B** (`EMPRESA_B`) con `SUCURSAL_B_1`.
- Usuarios simulados por rol: `OWNER`, `ADMIN`, `GERENTE` (acotado a sucursal),
  `SUPERVISOR` (acotado a otra sucursal), `GERENTE` sin sucursal —el estado que
  debe fallar cerrado—, `EMPLEADO`, `READONLY`, y los equivalentes de B.
- Constructores de turnos de cada empresa y de filas con fechas ya serializadas.

El módulo es puro: no importa `db`, `auth` ni cabeceras. Las ids son estables
para que dos suites no comparen empresas distintas, y las de sucursal tienen
forma de UUID porque varias guardas rechazan cualquier otra cosa antes de llegar
a Postgres.

## 3. Matriz de rol, empresa y sucursal

`lib/branch-scope.ts` fija el modelo ALL / BRANCH / NONE, y `lib/permissions.ts`
el matriz de permisos por recurso. La matriz efectiva para turnos:

| Rol | Empresa | Sucursal | Alcance | Turnos: leer | Turnos: crear/editar | Turnos: borrar | Turnos: publicar/duplicar |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `SUPER_ADMIN` | Suya | Sin límite | ALL (salvo acotado explícito) | Sí | Sí | Sí | Sí |
| `OWNER` | Suya | Sin límite | ALL | Sí | Sí | Sí | Sí |
| `ADMIN` | Suya | Sin límite | ALL | Sí | Sí | Sí | Sí |
| `GERENTE` | Suya | Asignada | BRANCH | Sólo su sucursal | Sólo su sucursal | Sólo su sucursal | Sólo su sucursal |
| `GERENTE` | Suya | **Sin asignar** | **NONE** | Cero filas | Rechazo | Rechazo | Rechazo |
| `SUPERVISOR` | Suya | Asignada | BRANCH | Sólo su sucursal | Sólo su sucursal | Sólo su sucursal | Sólo su sucursal |
| `EMPLEADO` | Suya | La suya | ALL en empresa, acotado por rol | Sin permiso de lectura de planificador | Rechazo | Rechazo | Rechazo |
| `READONLY` | Suya | Sin límite | ALL | Sin permiso de lectura de planificador | Rechazo | Rechazo | Rechazo |
| Cualquiera | Ajena | Cualquiera | — | Rechazo | Rechazo | Rechazo | Rechazo |

Dos reglas que la tabla no puede mostrar y que sí se aplican:

- **`companyId` siempre sale de la sesión.** Un `companyId` en el cuerpo de la
  petición no es una restricción: es un dato que se ignora.
- **`BRANCH` es más estrecho que `ALL` para el mismo rol.** Un `ADMIN` que pide
  una sucursal concreta ve esa sucursal; el mismo `ADMIN` sin pedirla ve la
  empresa. Un `GERENTE` nunca ve más que la suya, pida lo que pida.

Los recursos (turno, empleado, sucursal) se validan **contra** ese contexto, no
por el contexto: tener permiso de empresa no convierte en propio un turno ajeno.

## 4. Mapa de recorridos por hallazgo

Clasificación: **completo** = pantalla → servidor → tabla → efecto con
autorización y validación; **parcial** = existe pero falta una capa; **demo** =
la pantalla activa muestra datos ficticios sobre escrituras reales; **sin
consumidor** = la pieza existe y no tiene efecto en el negocio.

| Hallazgo | Pantalla | Entrada de servidor | Servicio | Tablas | Política | Efectos | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| H01 Turnos | `app/dashboard/labor/shifts/page.tsx` | `app/actions/shifts.ts` | `lib/services/shift-service-extended.ts` | `planned_shifts` | **Ninguna**: ni sesión, ni rol, ni empresa | Ninguno trazable | parcial (lectura sin filtro, escritura sin contexto) |
| H02 Plantillas | `app/dashboard/builder/templates/template-manager.tsx` | `app/api/templates/[id]` y `app/api/workflows/templates/[id]` | — | `workflow_templates` | Una de las dos rutas: permiso + empresa | Ninguno | parcial (dos rutas, una abierta) |
| H02 Ejecuciones | `app/dashboard/workflows/*/execute` | `app/api/workflows/execute`, `app/api/workflows/executions/[id]`, `.../steps/[stepId]` | `lib/services/workflow-execution-service.ts` | `workflow_executions`, pasos | Sesión, sin empresa/sucursal/asignación | Extractores vía Inngest | parcial (lectura por id) |
| H02 Sesiones/descansos | `app/dashboard/labor/*` | `app/api/shift-sessions`, `app/api/labor/breaks/status` | — | `shift_sessions` | Sin filtro obligatorio de empresa | Ninguno | parcial |
| H02 Costeo | `app/dashboard/inventory/*` | `app/api/inventory/costing/config` | `lib/services/costing-service.ts` | `branches` | Sin pertenencia al tenant | Actualiza sucursal | parcial |
| H03 Planificador | `components/labor/shifts/ShiftSchedulerContainer.tsx` | `hooks/use-shifts.ts` → acciones | Mismos de H01 | `planned_shifts` | Heredada de H01 | Ninguno | **demo sobre backend real** |
| H04 Dimensiones | `components/company/operating-dimensions-section.tsx` | `app/api/company/operating-config` | `lib/services/tenant-config-service.ts` | `companies` | Se guarda, no gobierna | **Ninguno** | **sin consumidor** |
| H04 Caja chica | `components/company/operating-config-form.tsx` | `app/api/company/operating-config` | — | `companies` | Se guarda | Ninguno | **sin consumidor** |
| H05 Parámetros financieros | `components/company/operating-config-form.tsx` | `app/api/company/operating-config` | `lib/services/sales-base.ts`, `labor-burden.ts` | `companies` | Consumidos por cálculo, sin editor ni vigencia | Cálculo en lectura | parcial (valores alterados al cargar) |
| H06 Vista de sucursales | `app/dashboard/branches/page.tsx` | — (lectura) | `lib/services/cross-branch-service.ts` vs `financial-kpi-service.ts` | Ventas, costos, asistencia | Dos motores, dos bases | Ninguno | parcial (porcentajes fijos y "VERIFIED" sin dato) |
| H07 IA | `components/builder/workflow-settings-modal.tsx` | `app/api/workflows/execute` | `verification-engine.ts`, `ai-service.ts` | `aiConfig` en plantilla | Se guarda, no se propaga | Verificación con defaults | parcial (y confianza sobrescribible) |
| H08 Validación de pasos | `components/workflow/workflow-executor.tsx` | `app/api/workflows/executions/[id]/steps/[stepId]` | `workflow-execution-service.ts` | Pasos | Obligatorio en cliente, opcional en servidor | Transición de paso | parcial |
| H08 Validación de turnos | `hooks/use-shift-validation.ts` | `app/api/shifts` | `shift-validation-service.ts` + `shift-service-extended.ts` | `planned_shifts` | **Dos juegos de límites distintos** | Rechazo o escritura | parcial |
| H09 Notificaciones | `components/profile/notification-preferences.tsx` | Tres APIs de preferencias | `notification-router.ts`, `notification-dispatcher.ts` | Preferencias | Router calcula, dispatcher redisige | Envío por canal | parcial (sin resultado por canal) |
| H10 Efectos de workflow | `app/dashboard/workflows/execute/[id]` | `app/api/workflows/executions/[id]` | `workflow-execution-service.ts`, `workflow-action-runner.ts` | Ejecución + acciones | — | `completionActions`, evento de extracción | parcial (sin barrera ni outbox) |
| H11 Executor anterior | Ninguna | `app/api/workflow` | `lib/inngest/functions/workflow-executor.ts` | Ejecuciones | Sesión | Marca completado con un evento | registrado sin productor conocido |
| H12 Huérfanos | `app/dashboard/workflow-test` (no activa) | Endpoints inexistentes | `lib/notifications/notification-dispatcher.ts`, `lib/whatsapp/notification-queue.ts` | — | — | — | sin consumidor interno |

### Lecturas de la matriz

- **Ningún recorrido activo tiene la cadena completa** de autorización +
  validación + efecto trazable. Los de inventario, ventas, gastos y equipos sí la
  tienen o la tuvieron, y son el patrón a imitar (`lib/services/__tests__/equipment-scope.test.ts`).
- **Cinco recorridos guardan configuración sin consumidor** (H04 ×2, H05 ×2,
  H07). Son el bloque más barato de cerrar: o se conecta o se deja de prometer.
- **El planificador de turnos es el caso más urgente de H03** porque no es una
  pantalla sin terminar: es una pantalla que puede mandar identificadores
  ficticios a una escritura real.

## 5. Desvío respecto al plan que hay que tener presente

El plan sitúa las pruebas nuevas de C01/C02 en `tests/shifts/read-scope.test.ts`.
`vitest.config.ts` sólo recoge `lib/**/*.test.ts` y `tests/unit/**/*.test.ts`, así
que un archivo en `tests/shifts/` no lo ejecutaría nadie. Las pruebas de esta
fase van a `tests/unit/shifts/*.test.ts` para que `pnpm run test:unit` las vea;
es el mismo alcance de pruebas, no una reducción.