# TODO: Corrección de hallazgos de auditoría frontend

Spec: `tasks/evidencia/frontend-demo-2026-10-29/auditoria-produccion-2026-10-29.md`
Plan detallado: `tasks/plan-auditoria-frontend.md`
Tracker de sesión: tareas #4–#19

Reglas transversales: desenvolver `{success,data}` una sola vez · filtro ausente ≠ `null` · una sola sucursal efectiva por request · gating de rol también en servidor · fechas con `lib/business-date` · seed sin eventos futuros.

## Phase 1 — Desbloquear schedules (P1)

- [x] **Task 1 (S) — SCH-01 · `GET /api/workflows/schedules` responde 200** · tracker #4
  - [x] Omitir parámetros ausentes en vez de pasarlos como `null`
  - [x] Filtros válidos siguen funcionando; inválidos siguen dando 400
  - [x] `pnpm run lint` y `pnpm run build` limpios — eslint 0 errores (2440 warnings preexistentes), `tsc --noEmit` limpio, `next build` OK con `NODE_OPTIONS=--max-old-space-size=4096` (el heap por defecto de 2 GB agota memoria; no es un error de código)
  - [x] Manual: `/dashboard/schedules` lista y consola sin 400 — listado y KPIs renderizan y la petición responde 200
  - **Files:** `app/api/workflows/schedules/route.ts`, `lib/validations/workflow-scheduling.ts`
  - **Evidencia:** verificado en navegador sobre `/dashboard/schedules` (commit `279b3ca`).

- [x] **Task 2 (S) — SCH-02 · KPIs y lista desenvuelven `data.data`** · tracker #7
  - [x] Tarjetas muestran 19/19/0/0 con el seed — verificado en navegador
  - [x] Lista renderiza sin errores de tipo
  - [x] Error de API muestra estado de error, no lista vacía
  - **Files:** `components/schedules/schedule-stats.tsx`, `schedule-list.tsx`

- [x] **Task 3 (S–M) — SCH-03 · Sucursal efectiva única en schedules** · tracker #6
  - [x] Header, selector interno y `branchId` de peticiones coinciden — Condesa→Polanco actualiza encabezado, selector, KPIs (19→7) y `branchId` de la petición
  - [x] Cambiar sucursal actualiza lista y KPIs
  - [x] No se usa `data[0]` como fallback — la sucursal se resuelve en servidor (commit `21825a1`)
  - **Files:** `app/dashboard/schedules/page.tsx` (+ hook de sucursal si aplica)

### Checkpoint A
- [x] Schedules lista, filtra y muestra KPIs
- [x] Sucursal mostrada = seleccionada = consultada
- [x] Build limpio — `next build` OK (ver Task 1)
- [ ] Revisión humana

## Phase 2 — Riesgo fiscal y fixes listos (P1)

- [x] **Task 4 (S) — PAY-01 · Desplegar gating de timbrado** · tracker #5
  - [x] Sin fechas o sin `canStamp`, acción deshabilitada — "2. Ejecutar y Timbrar Nómina" arranca `disabled` ("Primero valida el periodo y resuelve los bloqueos") y "Ejecutar Dispersión 2026" también (bloqueos pendientes)
  - [x] Submit por teclado no ejecuta — con el periodo capturado, `requestSubmit()` (equivalente a Enter) no produjo ningún POST a `/api/payroll/run`; la guarda `!validationData?.canStamp` corta antes
  - [x] Modal solo dice "Timbrados" si `COMPLETED` — la corrida DRAFT abre "Recibos de Nómina · Borrador" con "Estado de la corrida: DRAFT"
  - [x] No se ejecuta timbrado real — solo inspección read-only; ninguna acción de timbrado/dispersión fue disparada
  - **Files:** `app/dashboard/labor/payroll/page.tsx` (ya modificado)

- [x] **Task 5 (S) — LIVE-01 · Desplegar hora local y Aperturas a Tiempo** · tracker #8
  - [x] Hora de apertura en zona de sucursal — Polanco muestra "Abrió a tiempo (06:00 hrs)", la hora de su programación de apertura en `America/Mexico_City` (16:21 h local al revisar; un formato UTC habría mostrado 12:00)
  - [x] KPI coincide con la matriz — "Aperturas a Tiempo 100 % · 1/1 tiendas" y la fila de la matriz dice "A tiempo"
  - [x] Sin dotación no muestra 0 % — "Personal en Piso" dice "Sin dotación" con "0 colaboradores activos", y la matriz "Sin dotación configurada"
  - **Files:** `lib/services/live-command-service.ts`, `lib/business-date.ts`, `components/dashboard/live/*`

- [x] **Task 6 (S) — PAY-02 · Desplegar fechas civiles de nómina** · tracker #14
  - [x] Periodo coincide con API y `America/Mexico_City` — `GET /api/payroll` devuelve `periodStart: 2026-10-22`, `periodEnd: 2026-10-28`; la tabla muestra "22 oct – 28 oct 2026" sin corrimiento de un día
  - [x] Modal y tabla usan las mismas fechas — "Recibos de Nómina · Borrador" abre con "Periodo: 22 oct 2026 al 28 oct 2026"
  - **Evidencia:** inspección read-only en `/dashboard/labor/payroll` (sin timbrar).
  - **Files:** `app/dashboard/labor/payroll/page.tsx`, `lib/business-date.ts`

### Checkpoint B
- [x] Timbrado bloqueado sin validación
- [x] Fechas de periodo correctas
- [x] KPIs live coherentes con la matriz
- [x] Build limpio — `next build` OK; publicar requiere aprobación explícita (no se desplegó)

## Phase 3 — Alcance por sucursal y rol (P2)

- [x] **Task 7 (S) — EVID-01 · Desplegar sucursal y totales en evidencias** · tracker #9
  - [x] Galería respeta sucursal global — con el encabezado en Polanco, la petición es `GET /api/workflows/evidence?branchId=b1000001-…-0002`; el summary devuelve `uniqueBranches: 1` y todas las tarjetas dicen "Polanco"
  - [x] Total coincide con filas — TOTAL REGISTROS 286 = pie "de 286 evidencias"; paginación 1/12 de 24 por página
  - [x] Filtro "verificadas" no mezcla subconjuntos — preset `verified=true`: 93 registros, 24 con badge de IA en la página, "Por Revisar" 0 y aprobación 93/93 (100 %)
  - **Fix:** `next/image` lanzaba en render para hosts no declarados (URLs legacy `pulso.ejemplo` y URLs firmadas de R2, que varían por host) y tumbaba la vista completa antes de que `onError` pudiera responder; las miniaturas y el visor ahora usan `<img>` con respaldo `onError` → "Imagen no disponible".
  - **Nota de datos:** las filas del demo conservan URLs legacy `pulso.ejemplo`, así que las miniaturas muestran el placeholder (`ERR_NAME_NOT_RESOLVED` esperado). Migrarlas a `/demo-evidence/` requiere resiembra autorizada.
  - **Files:** `app/dashboard/evidence/page.tsx`, `app/api/workflows/evidence/route.ts`, `lib/storage/scoped-evidence.ts`
  - **Evidencia:** eslint limpio; consola sin el error de `next/image` (solo hydration de Radix preexistente); tsc pendiente del gate global.

- [x] **Task 8 (M) — NAV-01 · Refrescar vistas al cambiar sucursal** · tracker #11
  - [x] Header, KPIs y listados se actualizan sin reload — Condesa→Polanco en `/dashboard/schedules` actualizó encabezado, selector interno, KPIs (19→7) y listado
  - [x] Sin datos de la sucursal anterior como definitivos — el listado se vuelve a pedir con el nuevo `branchId` y no conserva filas previas
  - [x] URL/cookie consistente con la vista — el alcance vive en el contexto de sucursal; evidencias y programaciones lo respetan (Task 7)
  - **Files:** `components/shared/branch-scope-control.tsx`, layout del dashboard, hooks

- [x] **Task 9 (M) — RBAC-01 · READONLY sin acciones de ejecución** · tracker #10
  - [x] READONLY no ve "Iniciar" (la bitácora muestra "Solo lectura")
  - [x] Ruta de ejecución responde 403, no redirect (`proxy.ts` + `forbiddenResponse`)
  - [x] SUPER_ADMIN/GERENTE conservan su flujo (Carlos abre el stepper; commit `2f1638f`)
  - **Files:** `app/dashboard/page.tsx`, componentes de workflow, ruta de ejecución/middleware

### Checkpoint C
- [x] Evidencia y schedules siguen la sucursal global
- [x] Cambio de sucursal sin reload
- [x] READONLY sin CTAs ni acceso directo
- [ ] Revisión humana

## Phase 4 — Estados honestos (P2)

- [x] **Task 10 (XS) — LAB-01 · "Sin dotación" en vez de 1/0 y 0 %** · tracker #12
  - [x] Sin turnos: "Sin dotación configurada" (tarjeta y KPI "—") — `/dashboard/labor` muestra "Asistencia del Día · Sin dotación configurada" y KPI "Completion — Sin turnos hoy"
  - [x] Con turnos: porcentaje y conteo intactos
  - [x] Sin división por cero (`hasScheduledToday`)
  - **Files:** `app/dashboard/labor/page.tsx`

- [x] **Task 11 (S) — LAB-02 · Métrica "+N nuevos" defendible** · tracker #13
  - [x] Cuenta `employeeProfiles.hireDate` (altas reales), no `users.createdAt`
  - [x] El seed no infla la métrica (hireDate sembrado en 2023–2024) — la tarjeta muestra "Empleados Activos 2 · Sin altas en 7 días"
  - **Files:** `app/dashboard/labor/page.tsx` (commit `f4e8b2a`)

### Checkpoint D
- [x] Asistencia sin turnos es honesta
- [x] Métrica de nuevos con alcance claro
- [x] Build limpio — `next build` OK (ver Task 1)

## Phase 5 — i18n y datos demo (P2)

- [x] **Task 12 (S) — I18N-01 · Módulo de empleados en español** · tracker #15
  - [x] Sin strings en inglés visibles (directorio, tabla, tarjetas, filtros, búsqueda avanzada, documentos)
  - [x] Textos en `messages/es.json` (`labor.employees.directory|table|card|filters|advancedSearch|documents`)
  - [x] Claves existentes intactas (JSON validado con `JSON.parse`)
  - **Files:** `components/employees/*`, `messages/es.json`
  - **Evidencia:** `tsc --noEmit` limpio; eslint sin errores (solo warnings previos); página `/dashboard/employees` verificada en navegador con SUPER_ADMIN (lista y cuadrícula en español, sin errores de consola).

- [x] **Task 13 (XS–S) — SEED-01 · Sin instancias futuras** · tracker #16
  - [x] Actividad reciente solo con eventos pasados (guard `dueDate > now` omite la ejecución de hoy cuya hora no llega)
  - [x] Sigue creando el histórico completo (no cambia la ventana de 30 días ni las programaciones)
  - [x] `dueDate > now()` devuelve 0 — **resiembra autorizada ejecutada** el 2026-10-29: 20 fases + contraseñas en 240.8 s, 617 instancias y **0 futuras**. Espejo canónico reconstruido: 1,298/1,298 pasos con evidencia (1,300 adjuntos), 0 faltantes
  - **Files:** `scripts/seed-05-workflows.ts`
  - **Evidencia:** log completo en `tasks/evidencia/frontend-demo-2026-10-29/seed-reseed-2026-10-29.log`; medición posterior y smoke tests en `verificacion-local-2026-10-29.md`.

### Checkpoint E
- [x] Empleados sin inglés
- [x] Actividad reciente histórica — la bitácora solo muestra eventos pasados; `dueDate > now() = 0` tras la resiembra autorizada
- [x] Build limpio — `next build` OK (ver Task 1)

## Phase 6 — Menores (P3)

- [x] **Task 14 (XS) — SCH-05 · KPIs de schedules en español** · tracker #17
  - [x] Etiquetas y subtítulos traducidos — "Programaciones Totales / Activas / Ejecuciones de Hoy / Próximas" con sus subtítulos
  - [x] Sin claves visibles
  - **Evidencia:** `/dashboard/schedules` verificada en navegador (commit `c5eef54`).

- [x] **Task 15 (XS) — SCH-04 · Filtro MANUAL** · tracker #18
  - [x] Opción MANUAL disponible — opción "Manual" en el selector de tipo de asignación
  - [x] Filtra correctamente — `GET /api/workflows/schedules?…&assignmentType=MANUAL [200]` y estado vacío en español
  - **Evidencia:** verificado en navegador (commit `c5eef54`).

- [x] **Task 16 (XS) — OBS-01 · Consola y red limpias** · tracker #19 (bloqueada por #4)
  - [x] Sin 400 de schedules — `/dashboard/schedules` sin respuestas 400
  - [x] Sin reintentos fallidos
  - **Nota:** la consola conserva avisos preexistentes de hydration de Radix en el encabezado global, ajenos a este hallazgo.

### Checkpoint Final
- [x] 16 criterios de aceptación cumplidos — SEED-01 cerrado con la resiembra (`dueDate > now() = 0`)
- [x] Recorrido con SUPER_ADMIN, GERENTE y READONLY — local: Carlos (schedules 7/7/0/0 + cambio a Roma 1/1/0/0), Juan (CTAs "Iniciar" y stepper 200), Diana ("Solo lectura", navegación sin workflows y 403 HTML)
- [x] Evidencia actualizada en `tasks/evidencia/frontend-demo-2026-10-29/` — `verificacion-local-2026-10-29.md`
- [x] Informe con estado final por hallazgo — sección "Estado de corrección" en `auditoria-produccion-2026-10-29.md`

## Orden de ejecución por prioridad

1. SCH-01 (#4)
2. PAY-01 (#5)
3. SCH-03 (#6)
4. SCH-02 (#7)
5. LIVE-01 (#8)
6. EVID-01 (#9)
7. RBAC-01 (#10)
8. NAV-01 (#11)
9. LAB-01 (#12)
10. LAB-02 (#13)
11. PAY-02 (#14)
12. I18N-01 (#15)
13. SEED-01 (#16)
14. SCH-05 (#17)
15. SCH-04 (#18)
16. OBS-01 (#19)

## Verificación global

- [x] `pnpm run lint` — 0 errores, 2440 warnings preexistentes
- [x] `pnpm run build` — OK con `NODE_OPTIONS=--max-old-space-size=4096`
- [x] `tsc --noEmit` — limpio
- [x] Tests unitarios de las áreas tocadas — 57/57 (execution-access, business-date, evidence, session-scope, seed-safety)
- [x] Resiembra autorizada del demo — 0 instancias futuras; espejo de evidencias 1,298/1,298; smoke HTTP 200 en schedules, labor, employees y evidence
- [x] Manual en local con Carlos, Juan y Diana, dos sucursales (Roma/Polanco)
- [x] Sin timbrado, dispersión ni borrados durante la verificación
- [ ] Confirmación explícita antes de publicar a producción — sin desplegar
