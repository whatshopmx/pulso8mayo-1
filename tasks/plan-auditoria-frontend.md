# Implementation Plan: Corrección de hallazgos de auditoría frontend

**Fuente (spec):** `tasks/evidencia/frontend-demo-2026-10-29/auditoria-produccion-2026-10-29.md`
**Informe base:** `tasks/evidencia/frontend-demo-2026-10-29/README.md` (F01–F13)
**Baseline de producción:** `HEAD 3b27ac4` (2026-10-28). El árbol local tiene correcciones sin commitear.
**Tracker:** task list de sesión (#4–#19) + `tasks/todo-auditoria-frontend.md`

## Overview

Dieciséis hallazgos reproducidos en producción: 5 P1, 8 P2 y 3 P3. Cuatro ya tienen corrección escrita en el árbol local (PAY-01, LIVE-01, EVID-01, PAY-02) y solo requieren commit, despliegue y verificación. El resto requiere código nuevo. El plan se ordena por severidad y por dependencia real: primero la pantalla de schedules, que está completamente rota; después los riesgos fiscales y los fixes listos; luego alcance por sucursal y rol, estados engañosos, i18n y datos demo.

Ninguna tarea incluye ejecutar timbrado, dispersión ni borrados reales. Las verificaciones son de lectura y, cuando aplica, en entorno local o preview.

## Architecture Decisions

- **El sobre `{success, data}` es el contrato canónico.** Los clientes deben desenvolver una sola vez (`data.data`); no se crean formatos paralelos. Preferir el helper de `lib/api/response.ts`.
- **Filtro ausente ≠ filtro nulo.** Los parámetros que no vienen se omiten de la query, no se castean a `null`. Zod `.optional()` describe ausencia; `.nullish()` solo si `null` tuviera significado de negocio, que aquí no lo tiene.
- **Una sola sucursal efectiva.** La resolución vive en servidor a partir de la cookie/selector (`components/shared/branch-scope-control.tsx`). Ninguna página debe elegir `data[0]` de `/api/branches`.
- **Gating por rol en servidor, ocultamiento en UI.** Ocultar un CTA no es autorización; la ruta de ejecución también debe rechazar. Un redirect silencioso no es un estado de UI aceptable.
- **Fechas civiles con `lib/business-date`.** Nada de `getHours()` ni formateo UTC para horas o periodos de negocio; la zona de referencia es `America/Mexico_City`.
- **Los fixes pendientes se despliegan como lote verificable.** PAY-01, PAY-02, LIVE-01 y EVID-01 comparten la necesidad de commit + build + verificación; se agrupan para no re-desplegar cuatro veces. El despliegue a producción es una acción compartida y requiere confirmación explícita.
- **El seed no genera eventos futuros.** La actividad reciente debe ser histórica; la demo pierde credibilidad con "en alrededor de 10 horas".
- **Una tarea deja el sistema funcionando.** No se mezclan refactors de schedules con cambios de nómina.

## Dependency Graph

```
SCH-01 (API 400)
  ├── SCH-02 (envelope)  [misma pantalla, verificación conjunta]
  ├── SCH-03 (sucursal)  [misma pantalla]
  └── OBS-01 (ruido 400) [se cierra al verificar SCH-01]

PAY-02 (fechas) ──┐
PAY-01 (gating) ──┼── despliegue del lote pendiente
LIVE-01 (KPIs)  ──┤
EVID-01 (evidencia)┘

NAV-01 (refresh global) ── coordinación con SCH-03 (misma resolución de sucursal)
RBAC-01 (rol)           ── independiente
LAB-01 / LAB-02         ── independientes (misma página)
I18N-01 / SEED-01       ── independientes
SCH-04 / SCH-05         ── posteriores a SCH-01/02
```

## Task List

### Phase 1 — Desbloquear schedules (P1)

#### Task 1: SCH-01 · Corregir 400 permanente en `GET /api/workflows/schedules`
**Tracker:** #4
**Description:** La ruta arma `filters` con `null` para parámetros ausentes y `scheduleFiltersSchema` (`.optional()`) los rechaza, así que toda consulta sin `frequency`/`assignmentType` responde 400 y `/dashboard/schedules` nunca lista.
**Acceptance criteria:**
- [ ] Un `GET` sin filtros devuelve 200 y la lista de la sucursal.
- [ ] Los filtros válidos (`isActive`, `frequency`, `assignmentType`) siguen funcionando.
- [ ] Un valor inválido sigue devolviendo 400 con detalle de validación.
**Verification:**
- [ ] `pnpm run lint` y `pnpm run build` limpios.
- [ ] Manual: abrir `/dashboard/schedules`, confirmar lista y consola sin 400.
**Dependencies:** Ninguna.
**Files likely touched:** `app/api/workflows/schedules/route.ts`, `lib/validations/workflow-scheduling.ts`.
**Estimated scope:** S (1–2 archivos).

#### Task 2: SCH-02 · Desenvolver envelope en stats y lista de schedules
**Tracker:** #7
**Description:** `schedule-stats.tsx` y `schedule-list.tsx` asignan el sobre completo en vez de `data.data`, por lo que las tarjetas quedan vacías aun con respuesta 200.
**Acceptance criteria:**
- [ ] Las cuatro tarjetas muestran 19/19/0/0 con los datos del seed.
- [ ] La lista renderiza los schedules sin errores de tipo.
- [ ] Un error de API muestra estado de error, no una lista vacía silenciosa.
**Verification:**
- [ ] `pnpm run lint` y `pnpm run build` limpios.
- [ ] Manual: comparar UI contra `GET /api/workflows/schedules/stats`.
**Dependencies:** Ninguna; verificar junto con Task 1.
**Files likely touched:** `components/schedules/schedule-stats.tsx`, `components/schedules/schedule-list.tsx`.
**Estimated scope:** S (2 archivos).

#### Task 3: SCH-03 · Unificar sucursal efectiva en `/dashboard/schedules`
**Tracker:** #6
**Description:** La página fija `data[0].id` de `/api/branches` e ignora el selector global; el header puede decir Roma mientras las peticiones van a Condesa.
**Acceptance criteria:**
- [ ] Al entrar, header, selector interno y `branchId` de las peticiones coinciden.
- [ ] Al cambiar de sucursal, la lista y los KPIs corresponden a la nueva sucursal.
- [ ] No se usa `data[0]` como fallback de sucursal.
**Verification:**
- [ ] `pnpm run lint` y `pnpm run build` limpios.
- [ ] Manual con dos sucursales y roles distintos.
**Dependencies:** Ninguna. Coordinar con Task 8 (NAV-01) si se extrae un hook compartido.
**Files likely touched:** `app/dashboard/schedules/page.tsx`, posiblemente el hook/contexto de sucursal.
**Estimated scope:** S–M (1–3 archivos).

#### Checkpoint A — Schedules
- [ ] `/dashboard/schedules` lista, filtra y muestra KPIs.
- [ ] La sucursal mostrada, la seleccionada y la consultada coinciden.
- [ ] `pnpm run build` limpio.
- [ ] Revisión humana antes de tocar nómina.

### Phase 2 — Riesgo fiscal y correcciones listas (P1)

#### Task 4: PAY-01 · Desplegar y verificar gating de timbrado
**Tracker:** #5
**Description:** El árbol local ya deshabilita la ejecución sin validación y hace dinámico el título del modal; producción aún muestra el comportamiento viejo.
**Acceptance criteria:**
- [ ] Sin fechas o sin `canStamp`, "Ejecutar y Timbrar Nómina" está deshabilitado.
- [ ] El submit por teclado tampoco ejecuta.
- [ ] El modal solo dice "Timbrados" cuando la corrida está `COMPLETED`.
- [ ] No se ejecuta timbrado real durante la verificación.
**Verification:**
- [ ] `pnpm run lint` y `pnpm run build` limpios.
- [ ] Manual en preview: botón deshabilitado, título correcto por estado.
**Dependencies:** Task 6 (PAY-02) para verificar fechas en la misma pasada.
**Files likely touched:** `app/dashboard/labor/payroll/page.tsx` (ya modificado).
**Estimated scope:** S (verificación y despliegue).

#### Task 5: LIVE-01 · Desplegar corrección de hora local y Aperturas a Tiempo
**Tracker:** #8
**Description:** `businessTimeParts` y `onTimeRatePercent` ya están escritos localmente; producción sigue mostrando 20:00 y 100 % incorrectos.
**Acceptance criteria:**
- [ ] La hora de apertura corresponde a la hora local de la sucursal.
- [ ] "Aperturas a Tiempo" coincide con las filas de la matriz.
- [ ] Sin dotación, la UI no muestra 0 % engañoso.
**Verification:**
- [ ] `pnpm run lint` y `pnpm run build` limpios.
- [ ] Comparar KPIs contra la matriz en preview con sucursal de México.
**Dependencies:** Ninguna.
**Files likely touched:** `lib/services/live-command-service.ts`, `lib/business-date.ts`, `components/dashboard/live/*`.
**Estimated scope:** S (despliegue + verificación).

#### Task 6: PAY-02 · Desplegar corrección de fechas civiles en nómina
**Tracker:** #14
**Description:** El fix de `parseCivilDate`/`business-date` existe localmente; producción muestra el periodo ±1 día.
**Acceptance criteria:**
- [ ] El periodo mostrado coincide con la API y con `America/Mexico_City`.
- [ ] El modal de recibos usa las mismas fechas que la tabla.
**Verification:**
- [ ] `pnpm run lint` y `pnpm run build` limpios.
- [ ] Manual en preview con un periodo que cruce cambio de mes.
**Dependencies:** Ninguna; desplegar junto con Task 4.
**Files likely touched:** `app/dashboard/labor/payroll/page.tsx`, `lib/business-date.ts` (ya modificados).
**Estimated scope:** S (despliegue + verificación).

#### Checkpoint B — Nómina y KPIs
- [ ] Timbrado bloqueado sin validación.
- [ ] Fechas de periodo correctas.
- [ ] KPIs live coherentes con la matriz.
- [ ] Build limpio y revisión humana antes de desplegar a producción.

### Phase 3 — Alcance por sucursal y rol (P2)

#### Task 7: EVID-01 · Desplegar filtro de sucursal y totales en evidencias
**Tracker:** #9
**Description:** El fix local usa la sucursal efectiva y devuelve el total filtrado; producción mantiene filtros locales y totales que no cuadran.
**Acceptance criteria:**
- [ ] La galería respeta la sucursal global.
- [ ] El total mostrado coincide con las filas.
- [ ] Los filtros de verificación no mezclan subconjuntos.
**Verification:**
- [ ] `pnpm run lint` y `pnpm run build` limpios.
- [ ] Manual con dos sucursales y filtro "verificadas".
**Dependencies:** Ninguna.
**Files likely touched:** `app/dashboard/evidence/page.tsx`, `app/api/workflows/evidence/route.ts`, `lib/storage/scoped-evidence.ts`.
**Estimated scope:** S (despliegue + verificación).

#### Task 8: NAV-01 · Refrescar vistas servidas al cambiar de sucursal
**Tracker:** #11
**Description:** El selector global no re-renderiza componentes de servidor hasta un reload; header y datos discrepan.
**Acceptance criteria:**
- [ ] Al cambiar sucursal, header, KPIs y listados se actualizan sin reload completo.
- [ ] No hay parpadeo que muestre datos de la sucursal anterior como definitivos.
- [ ] La URL/cookie queda consistente con la sucursal mostrada.
**Verification:**
- [ ] `pnpm run lint` y `pnpm run build` limpios.
- [ ] Manual: cambiar Condesa → Roma en dashboard, evidencia y schedules.
**Dependencies:** Coordinar con Task 3.
**Files likely touched:** `components/shared/branch-scope-control.tsx`, layout del dashboard, hooks de sucursal.
**Estimated scope:** M (2–4 archivos).

#### Task 9: RBAC-01 · Ocultar acciones "Iniciar" a READONLY
**Tracker:** #10
**Description:** Diana (READONLY) ve CTAs de ejecución que la redirigen fuera; falta gating de UI y de servidor.
**Acceptance criteria:**
- [ ] READONLY no ve "Iniciar" ni acciones de ejecución.
- [ ] Un intento directo a la ruta de ejecución se rechaza con 403, no con redirect.
- [ ] SUPER_ADMIN/GERENTE conservan el flujo actual.
**Verification:**
- [ ] `pnpm run lint` y `pnpm run build` limpios.
- [ ] Manual con Diana y Carlos.
**Dependencies:** Ninguna.
**Files likely touched:** `app/dashboard/page.tsx`, componentes de workflow, ruta de ejecución/middleware.
**Estimated scope:** M (2–4 archivos).

#### Checkpoint C — Sucursal y rol
- [ ] Evidencia y schedules siguen la sucursal global.
- [ ] Cambiar sucursal actualiza la vista sin reload.
- [ ] READONLY no ve ni puede invocar ejecuciones.
- [ ] Revisión humana.

### Phase 4 — Estados honestos (P2)

#### Task 10: LAB-01 · Distinguir "sin dotación" de 0 % de asistencia
**Tracker:** #12
**Description:** `labor/page.tsx` muestra "Hoy: 1/0" y 0 % cuando no hay turnos programados.
**Acceptance criteria:**
- [ ] Sin turnos, la tarjeta dice "Sin dotación configurada" y no 0 %.
- [ ] Con turnos, el porcentaje y el conteo se mantienen.
- [ ] No se muestra una división por cero.
**Verification:**
- [ ] `pnpm run lint` y `pnpm run build` limpios.
- [ ] Manual con una sucursal sin turnos y otra con turnos.
**Dependencies:** Ninguna.
**Files likely touched:** `app/dashboard/labor/page.tsx`.
**Estimated scope:** XS (1 archivo).

#### Task 11: LAB-02 · Corregir métrica "+N nuevos esta semana"
**Tracker:** #13
**Description:** Cuenta todos los usuarios creados en 7 días, incluidos seed y roles no operativos.
**Acceptance criteria:**
- [ ] El número refleja altas relevantes o la etiqueta describe la población contada.
- [ ] Cambiar el seed no infla la métrica de forma engañosa.
**Verification:**
- [ ] `pnpm run lint` y `pnpm run build` limpios.
- [ ] Manual y contraste con la consulta SQL.
**Dependencies:** Ninguna.
**Files likely touched:** `app/dashboard/labor/page.tsx` (query y subtitle).
**Estimated scope:** S (1 archivo).

#### Checkpoint D — Labor
- [ ] Asistencia sin turnos es honesta.
- [ ] La métrica de nuevos tiene un alcance defendible.
- [ ] Build limpio.

### Phase 5 — i18n y datos demo (P2)

#### Task 12: I18N-01 · Traducir textos hardcodeados del módulo de empleados
**Tracker:** #15
**Description:** Directorio, filtros y búsqueda avanzada mantienen strings en inglés.
**Acceptance criteria:**
- [ ] No quedan textos en inglés visibles en la UI en español.
- [ ] Los textos viven en `messages/es.json`, no hardcodeados.
- [ ] No se rompen claves existentes de `next-intl`.
**Verification:**
- [ ] `pnpm run lint` y `pnpm run build` limpios.
- [ ] Manual en `/dashboard/employees` (lista, filtros, búsqueda, documentos).
**Dependencies:** Ninguna.
**Files likely touched:** `components/employees/employee-directory.tsx`, `employee-filters.tsx`, `employee-advanced-search.tsx`, `document-grid.tsx`, `messages/es.json`.
**Estimated scope:** S (4–5 archivos).

#### Task 13: SEED-01 · Eliminar instancias futuras del seed
**Tracker:** #16
**Description:** El seed genera instancias del día actual con horas posteriores a `now`, y la actividad reciente muestra "en alrededor de 10 horas".
**Acceptance criteria:**
- [ ] La actividad reciente solo muestra eventos pasados.
- [ ] El seed sigue creando ~300 instancias históricas.
- [ ] Re-ejecutar el seed no produce fechas futuras.
**Verification:**
- [ ] `npx tsx scripts/seed-05-workflows.ts` en base local.
- [ ] Consulta de `dueDate > now()` devuelve 0.
**Dependencies:** Ninguna.
**Files likely touched:** `scripts/seed-05-workflows.ts`.
**Estimated scope:** XS–S (1 archivo).

#### Checkpoint E — Presentación y demo
- [ ] Empleados sin strings en inglés.
- [ ] Actividad reciente sin eventos futuros.
- [ ] Build limpio.

### Phase 6 — Menores (P3)

#### Task 14: SCH-05 · Traducir KPIs de schedules
**Tracker:** #17
**Acceptance criteria:**
- [ ] Etiquetas y subtítulos en español.
- [ ] Sin claves de traducción visibles.
**Verification:** `pnpm run build` + revisión visual.
**Dependencies:** Tasks 1–2.
**Files likely touched:** `components/schedules/schedule-stats.tsx`.
**Estimated scope:** XS (1 archivo).

#### Task 15: SCH-04 · Agregar opción MANUAL al filtro de asignación
**Tracker:** #18
**Acceptance criteria:**
- [ ] El filtro incluye MANUAL.
- [ ] Devuelve los schedules correctos.
**Verification:** `pnpm run build` + manual con datos del seed.
**Dependencies:** Tasks 1–3.
**Files likely touched:** `app/dashboard/schedules/page.tsx`.
**Estimated scope:** XS (1 archivo).

#### Task 16: OBS-01 · Verificar consola y red limpias en schedules
**Tracker:** #19 (bloqueada por #4)
**Acceptance criteria:**
- [ ] Sin 400 de schedules en consola/red.
- [ ] Sin reintentos fallidos.
**Verification:** Chrome DevTools MCP sobre preview.
**Dependencies:** Task 1.
**Files likely touched:** ninguno.
**Estimated scope:** XS (verificación).

#### Checkpoint Final
- [ ] Los 16 criterios de aceptación cumplidos.
- [ ] Recorrido con SUPER_ADMIN, GERENTE y READONLY contra el despliegue actualizado.
- [ ] Informe de evidencia actualizado en `tasks/evidencia/frontend-demo-2026-10-29/`.

## Priority Index

| Orden | Hallazgo | Sev. | Task | Tracker |
|---:|---|---|---:|---:|
| 1 | SCH-01 | P1 | 1 | #4 |
| 2 | PAY-01 | P1 | 4 | #5 |
| 3 | SCH-03 | P1 | 3 | #6 |
| 4 | SCH-02 | P1 | 2 | #7 |
| 5 | LIVE-01 | P1 | 5 | #8 |
| 6 | EVID-01 | P2 | 7 | #9 |
| 7 | RBAC-01 | P2 | 9 | #10 |
| 8 | NAV-01 | P2 | 8 | #11 |
| 9 | LAB-01 | P2 | 10 | #12 |
| 10 | LAB-02 | P2 | 11 | #13 |
| 11 | PAY-02 | P2 | 6 | #14 |
| 12 | I18N-01 | P2 | 12 | #15 |
| 13 | SEED-01 | P2 | 13 | #16 |
| 14 | SCH-05 | P3 | 14 | #17 |
| 15 | SCH-04 | P3 | 15 | #18 |
| 16 | OBS-01 | P3 | 16 | #19 |

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Desplegar el árbol local arrastra cambios ajenos a la auditoría | Alto | Commit por área; revisar `git diff` antes de desplegar; no usar `git add -A`. |
| El deploy a producción es una acción compartida | Alto | Preview primero; confirmación explícita del usuario antes de publicar. |
| El fix de PAY-01 se confunde con una ejecución real | Alto | Verificar solo con botón deshabilitado; nunca enviar el formulario. |
| Cambiar la resolución de sucursal rompe otras páginas | Medio | Extraer la resolución una vez y probar dashboard, evidencia, schedules y labor. |
| El gating de rol solo se aplica en UI | Medio | Rechazo 403 en la ruta de ejecución además del ocultamiento. |
| El seed re-ejecutado pisa datos de demo existentes | Medio | Probar en base local; no correr seeds contra producción sin confirmación. |
| Los checks de UI no cubren todos los roles | Medio | Usar Carlos, Juan y Diana en cada checkpoint. |

## Open Questions

- ¿La pantalla de schedules debe ser editable para GERENTE/SUPERVISOR o solo ADMIN/SUPER_ADMIN? El gating actual no lo define.
- ¿El lote de fixes pendientes se publica como un solo deploy o por área (nómina, live, evidencia)?
- ¿La métrica "+N nuevos" debe excluir roles no operativos o solo mostrar el total de altas de la empresa?
- ¿Se mantiene `MANUAL` como tipo de asignación visible o se retira del modelo por falta de uso?

## Definition of Done

- `pnpm run lint` y `pnpm run build` limpios.
- Cada criterio de aceptación verificado en preview.
- Recorrido final con los tres roles y dos sucursales.
- Informe de auditoría actualizado con el estado de cada hallazgo.
- Sin cambios destructivos ni ejecuciones fiscales durante la verificación.
