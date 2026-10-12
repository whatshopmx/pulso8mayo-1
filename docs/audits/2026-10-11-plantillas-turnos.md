# C11 — Plantillas de turnos y asignación masiva

Fecha: 11 de octubre de 2026. Seguimiento: [C11](../../tasks/plan-conexion-frontend-backend.md#c11).

## Investigación y alcance

C11 continued el trabajo local que ya existía sin registrar en `shift-template-service.ts`, `app/actions/shifts.ts`, el planificador y pruebas nuevas. Ese trabajo estaba completo y no se descartó: se revisó, se corrigieron los huecos y se verificó.

La auditoría ([H03](../../docs/audits/2026-10-10-backend-frontend-wiring-audit.md)) encontró que el lote mandaba `branchId` y `role` vacíos a `createPlannedShift` y que las pestañas de plantillas y asignación masiva estaban deshabilitadas. C09 había dejado la puerta de destino rejecting esos envíos, de modo que la operación nunca escribía; ahora escribe con destino real.

## Comportamiento implementado

- **Contrato de destino.** `BulkShiftOperation` exige `branchId` y `role`. Un esquema Zod valida fechas (`AAAA-MM-DD` real), horas (`HH:mm`), periodo ordenado, días del patrón personalizado y las dos horas de un turno `CUSTOM` antes de cualquier consulta o escritura.
- **Alcance.** Cada acción comprueba que sucursal, rol y empleados siguen en el catálogo autorizado de la sesión antes de previsualizar o guardar, con el mismo mensaje para toda desviación. El servicio repite la comprobación con `assertShiftScopeCoversBranch`, y cada elemento pasa por la puerta de destino de C02.
- **Validación compartida.** `createPlannedShift` se dividió en `validatePlannedShift` (devuelve advertencias o lanza) más la escritura. La vista previa y el guardado llaman a la misma función; la única diferencia es el argumento `additional`, que sólo simula los elementos ya aceptados del lote para que los choques internos del propio lote se anticipen.
- **Vista previa.** Devuelve una fila por empleado y fecha, en orden cronológico, con `canApply`, `error` y `warnings`. No escribe: la prueba lo comprueba sobre el adaptador.
- **Resultado parcial.** Cada elemento se guarda en su propia transacción con `pg_advisory_xact_lock` por empresa y empleado. Los válidos persisten; los rechazados aparecen en `failed` con `date`, `employeeId` y el mensaje de rechazo. Un rechazo no revierte los válidos. Ésta es la atomicidad definida: **por elemento, no por lote**.
- **Duplicados.** El bloqueo por empleado serializa lotes concurrentes incluso entre procesos, y repetir una solicitud no duplica: los choques salen como rechazo con su regla.
- **Tamaños.** 31 días y 500 turnos por solicitud, verificados antes de consultar. Son límites de petición, no de jornada.
- **Pestañas.** Plantillas y Asignación Masiva pasan a usar el catálogo real de C08 (sucursal, rol, empleados del actor), con selección explícita, estado de carga, error con reintento, tabla de vista previa, confirmación y resultado por elemento con enlace a la Vista Semanal. Cambiar el destino descarta la vista previa anterior.
- Las plantillas ya no anuncian una plantilla «de 2 cocineros y 2 meseros»: describen el horario y el patrón, y el personal lo elige quien aplica.

## Decisiones

- **Atomicidad por elemento**, declarada antes de escribir. Todo-o-nada sobre 500 elementos dejaría el lote entero sin aplicar por un solo choque; el resultado por elemento con bloqueo advisory es lo que hace que reintentar sea seguro.
- **`MAX_DAILY_HOURS` no es una excepción del lote.** La jornada larga se rechaza elemento a elemento igual que en la creación manual. Conceder la excepción es una acción aparte de C09 con su motivo y su caducidad.
- **La vista previa no reserva cupos.** Entre la vista previa y la confirmación el estado puede cambiar; por eso el guardado vuelve a validar. La prueba lo cubre: un conflicto que aparece después de la vista previa evita la escritura.
- La asignación masiva reutiliza el mismo componente con horario y días editables en vez de un catálogo de plantillas, porque un lote libre no depende de que las plantillas carguen.

## Evidencia y límites

| Verificación | Resultado |
| --- | --- |
| `pnpm.cmd exec tsc --noEmit` | Sin salida. |
| `pnpm.cmd exec vitest run tests/unit/shifts/` | 5 archivos, 81/81 aprobadas. |
| `pnpm.cmd run test:unit` | 68 archivos; 903 aprobadas, 1 omitida y 1 TODO. Incluye 22 casos de `template-apply.test.ts` y 12 de `template-actions.test.ts`. |
| `pnpm.cmd exec playwright test --config tests/playwright-shifts.config.ts` | 19/19 aprobadas en Chromium: 7 de exportación (C10), 8 de plantillas y 4 de asignación masiva. |
| `pnpm.cmd run build` | Aprobado. |
| ESLint sobre los once archivos de TypeScript de C11 | 0 errores; 2 warnings por imports sin usar (`LFTViolation`, `LFTViolationType`) que ya existían en HEAD y no pertenecen a este bloque. |

Casos de `template-apply.test.ts`: solapamiento anticipado sin escritura y resultado parcial conservado; límite semanal simulado con los elementos anteriores del lote; días y horas de plantilla con cruce de medianoche; revalidación cuando el conflicto aparece tras la vista previa; `MAX_DAILY_HOURS` sin excepción y con excepción vigente; ocho contratos inválidos (sucursal o rol vacíos, sin empleados, `2026-02-30`, periodo invertido, periodo de un año, hora `25:00`, patrón sin días) rechazados antes de consultar; actor sin permiso y gerente sin sucursal; destino de otra sucursal y de otra empresa; duplicados por repetición, concurrencia y reintento del lote parcial; lote mayor de 500 elementos.

Casos de navegador: la vista previa identifica turnos y conflictos sin escribir; sin empleados el botón no se puede pedir; confirmar informa lo creado y lo rechazado, la Vista Semanal y la recarga reflejan lo persistido, y el CSV exporta sólo lo guardado; un fallo al aplicar conserva el aviso y no inventa resultado; un destino rechazado por el servidor se informa; cambiar el destino descarta la vista previa; la plantilla que no carga se avisa y se reintenta; la segunda empresa sólo ve y aplica su catálogo; en asignación masiva, destinos y días son obligatorios, el resultado parcial no se duplica al repetir, un error exige revisar antes de reintentar y el catálogo de la segunda empresa se usa al confirmar.

## Límites

El navegador ejecuta el contenedor, la pestaña y los hooks reales. El servidor aislado sustituye las acciones por respuestas controladas de dos empresas y prohíbe las escrituras no relacionadas. No ejecuta Next, autenticación ni Postgres: la autorización, la validación, la serialización y el comportamiento ante duplicados están cubiertos por las pruebas unitarias sobre el servicio y la política reales, no por el navegador. La prueba de concurrencia usa un adaptador que emula el bloqueo de PostgreSQL por clave; el `pg_advisory_xact_lock` en sí no se ejecutó contra una base real y queda sin comprobar en un entorno con dos procesos.

Las plantillas siguen siendo las cuatro constantes de `DEFAULT_TEMPLATES`: no hay persistencia de plantillas por empresa. Crear y editar plantillas guardadas queda fuera de C11 y de C12.

Las advertencias de la vista previa y el resultado se muestran, pero no tienen acción de reintento: reintentar es volver a pedir la vista previa, que es lo que hacen las pruebas. La excepción auditada de `MAX_DAILY_HOURS` concede su pantalla en la matriz semanal (C09), no en esta pestaña.

Los recorridos de creación, recarga y revisión de workflows de C04 y C05 siguen sin verificarse en navegador, igual que la excepción de C09 desde su propia pantalla.

## Continuidad

C12 queda cubierto en lo esencial por este mismo bloque: la asignación masiva tiene destino obligatorio, atomicidad por elemento declarada, rechazo de duplicados y resultado visible. Sus criterios se pueden dar por cumplidos con la evidencia anterior; conviene cerrarlo en el seguimiento con esa referencia en lugar de repetir el recorrido. C13 es el siguiente pendiente: conservar valores y errores de configuración.