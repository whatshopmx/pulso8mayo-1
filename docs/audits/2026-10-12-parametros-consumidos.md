# C14 — Exponer parámetros consumidos que faltan en la interfaz

Fecha: 12 de octubre de 2026. Seguimiento: [C14](../tasks/plan-conexion-frontend-backend.md#c14).

## Investigación y alcance

C14 abre la Fase 3 (configuración que produce efectos) con H05: IVA, factor de carga patronal, impuesto estatal y umbral de merma los leían los motores, pero no existían en el contrato del PUT ni en el formulario. Salvo `mermaVarianceThresholdPct`, que la API ya admitía sin que nadie lo pudiera editar.

El recorrido tocaba ruta PUT, mapeo ida y vuelta, formulario, sección nueva, migración aditiva y pruebas — más de cinco archivos — así que se dividió en C14.1 (contrato y formulario), C14.2 (historial) y C14.3 (efectos y vigencia) antes de implementar, con los criterios de aceptación de C14 repartidos entre las tres.

**Hallazgo colateral (C09):** la migración `0092` de `policy_overrides` —la excepción auditada que concede la pantalla de `MAX_DAILY_HOURS` de C09 y la auto-revisión de C05— estaba generada en el repositorio pero **nunca aplicada en la base**: `to_regclass('public.policy_overrides')` devolvía nulo. Las pruebas unitarias pasaban porque simulan `db`, así que la excepción habría fallado en runtime con *relation does not exist*. Se aplicó `pnpm db:migrate`, que en esta base sólo tenía pendiente esa migración; verificado después con `to_regclass` y sus 14 columnas.

## Comportamiento implementado

- **Contrato (C14.1).** El PUT acepta `vatRatePercent`, `laborBurdenFactorPercent` y `payrollStateTaxPercent` con `null` explícito, junto a `mermaVarianceThresholdPct` que pasa a admitirlo. `null` es un estado con efecto propio —apagar la estimación, no capturar el factor, usar el 5% del sistema— y se persiste como `null`, nunca como cero. Los porcentajes que no son semáforo salieron de la validación de pares, que ahora nombra explícitamente sus seis campos en vez de derivarlos por exclusión.
- **Formulario (C14.1).** Una sección nueva expone los cuatro con unidad, rango y una frase que nombra a su consumidor y qué significa el vacío. Los errores del servidor llegan a su campo con `aria-invalid`, `aria-describedby` y `role="alert"`.
- **Historial (C14.2).** Tabla `config_change_logs` con una fila por campo modificado: actor, columna, valor anterior y nuevo. El diff es una parte pura (`lib/company/config-change-log.ts`) que normaliza antes de comparar, porque los porcentajes se guardan como `"16.00"` y viajan como `16`: sin normalizar, guardar lo mismo parecería un cambio. Un guardado que no cambia nada no escribe historial.
- **Efectos (C14.3).** Cada parámetro se prueba pasándolo por la función que lo consume: `resolveSalesBase`, `buildLaborBurden`, `getLaborBurden` y `excedeUmbralMerma`. La regla de umbral del conteo se extrajo a dos funciones puras para poder comprobarla sin base de datos, y `null` dejó de significar "5" por sorpresa: ahora dice lo mismo que la interfaz.

## Evidencia y límites

| Verificación | Resultado |
| --- | --- |
| `pnpm run test:unit` | 73 archivos; **973** pruebas aprobadas, 1 omitida y 1 TODO. Incluye 11 casos de vigencia (`operational-params-vigencia.test.ts`), 14 de efecto por parámetro (`financial-config.test.ts`), 14 de historial (`config-history.test.ts`), 10 de contrato fiscal (`fiscal-params.test.ts`) y los 21 de C13. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts` | **34/34** en Chromium: 15 de configuración (11 de C13 + 4 de C14.1: valores guardados, edición con recarga, vacío como `null` y error por campo) y 19 de turnos. |
| Comprobación contra la base real | `config_change_logs` creada por `db:generate`/`db:migrate` (0093, aditiva: tabla + FK + índice) e indexada para vigencia (0094). Verificado dos veces: inserción y lectura de filas con `jsonb` escalar y `null`, y resolución de vigencia con dos cambios sembrados —marzo ve 10, hoy ve 8—. Filas de prueba eliminadas. |
| `pnpm run lint` | 0 errores, 2386 warnings (los de los archivos tocados son preexistentes: `_c` en la ruta y los imports del esquema). |
| `npx tsc --noEmit` y `pnpm run build` | Limpios. |

Límites, declarados:

- **El navegador no ejecuta Next, autenticación ni Postgres.** El V2 intercepta `GET`/`PUT` con respuestas controladas; la autorización (sesión, `requireTenant`, permiso `settings/update` y el rechazo 403) queda en las pruebas unitarias sobre la ruta real.
- **El historial es de mejor esfuerzo.** Si la inserción falla, el guardado ya autorizado no se convierte en un error: se reporta en el log. Es la misma convención que `logDataAccess` y `AuditService` en este módulo, y su límite es conocido — una fila perdida no rompe la operación.
- **No hay pantalla para consultar el historial.** El criterio pide que quede rastro, y queda; verlo exigiría una vista nueva que C14 no contemplaba.
- **La vigencia está resuelta para los cálculos.** Un periodo conserva los parámetros que tenía al cierre y cambiar uno hoy no mueve meses cerrados. Lo que sigue abierto es que las vistas no lean el snapshot congelado, que corresponde a C29–C31.

## Decisión de vigencia (C14.3) — implementada

**Un periodo se calcula con los parámetros vigentes al cierre de ese periodo.** Cada parámetro se resuelve con el último cambio anterior al cierre, tomado de `config_change_logs`, que ya registra cada cambio con su fecha: la vigencia no necesitó tabla nueva.

Lectura con fecha — P&L, KPI financiero, costo laboral y conteo de merma pasan `cierreDelPeriodo(periodo)`. Lectura sin fecha — sigue devolviendo el valor actual y sin consultas extra, que es lo que usan los caminos sin periodo (catálogos, configuración).

Comprobado contra la base real: sembrados dos cambios de IVA (10% el 1 de marzo, 8% hoy), la consulta devuelve **10** al cierre de marzo, **10** al cierre de junio y **8** hoy. La fila de configuración nunca se reescribió.

Lo que sigue abierto, y por qué: `getPnLSnapshots` continúa sin consumidores —el P&L congelado al cerrar es un archivo que ninguna vista lee—. La vigencia por fecha es hoy lo que impide la reescritura del pasado en los cálculos; conectar esas lecturas sigue siendo C29–C31. Los objetivos de semáforo y los umbrales monetarios no tienen vigencia a propósito: calibran el objetivo contra el que se compara, no un hecho del periodo.

Migración 0094 (índice `config_change_logs_param_idx`) aplicada. El helper `setTenantFinanceConfig` de las pruebas con base real registra ahora el cambio en el historial, porque un cambio escrito sólo en la fila sería invisible para la vigencia.

## Continuidad

C15 — definir el contrato de las siete dimensiones y el límite de caja chica — parte de este mismo documento, que ya tiene la estructura (unidad, rango, semántica de vacío, alcance, permiso, consumidor, aplicación y excepciones) y la regla de verificar cada valor contra el consumidor que lo lee, no contra el nombre del campo.