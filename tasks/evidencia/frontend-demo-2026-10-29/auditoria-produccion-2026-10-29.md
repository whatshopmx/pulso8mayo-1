# Auditoría de producción — schedules, roles y estados

Fecha: 29 de octubre de 2026. Entorno: https://pulso-horeca.netlify.app.

**Método:** Chrome DevTools MCP sobre el sitio desplegado y CodeGraph/lectura dirigida del workspace para localizar causas. Sesiones con Carlos (SUPER_ADMIN), Juan (GERENTE) y Diana (READONLY), contraseña `123456` del seed. Solo lectura: no se ejecutaron nóminas, timbrados, dispersiones ni borrados; no se modificó código de la aplicación durante la auditoría.

**Contexto de despliegue:** el sitio productivo corresponde a `HEAD 3b27ac4` (2026-10-28, "cambios netlify"). El árbol de trabajo tiene ~27 archivos modificados sin commitear (dashboard, evidencia, nómina, `live-command-service.ts`, `business-date.ts`, `messages/es.json`, seeds). Producción está desactualizada respecto a correcciones ya escritas localmente; este informe separa lo reproducido en producción de lo que ya tiene fix sin desplegar.

Prioridades: **P1** bloqueo de pantalla completa o riesgo fiscal/operativo; **P2** lógica funcional y confiabilidad; **P3** presentación.

## Resumen de hallazgos

| ID | Prioridad | Hallazgo | Estado |
|---|---|---|---|
| SCH-01 | P1 | `/dashboard/schedules` no lista nada: la API responde 400 siempre | Abierto |
| SCH-02 | P1 | KPIs de schedules en blanco por contrato de respuesta | Abierto |
| SCH-03 | P1 | La página opera sobre una sucursal distinta a la del header | Abierto |
| PAY-01 | P1 | Nómina permite iniciar timbrado sin fechas y llama "timbrados" a pendientes | Fix local sin desplegar |
| LIVE-01 | P1 | Hora de apertura en UTC y "Aperturas a Tiempo" contradice la matriz | Fix local sin desplegar |
| LAB-01 | P2 | "1/0 empleados en turno" y 0 % de asistencia sin turnos programados | Abierto |
| LAB-02 | P2 | "+8 nuevos esta semana" cuenta todos los usuarios creados en 7 días | Abierto |
| EVID-01 | P2 | Evidencias ignora la sucursal global y los totales no cuadran | Fix local sin desplegar |
| SEED-01 | P2 | Actividades recientes con fechas futuras ("en alrededor de 10 horas") | Datos seed |
| NAV-01 | P2 | El selector global no refresca la vista servida hasta reload | Abierto |
| RBAC-01 | P2 | READONLY ve CTAs "Iniciar" que redirigen fuera | Abierto |
| I18N-01 | P2 | Módulo de empleados con textos hardcodeados en inglés | Abierto |
| PAY-02 | P2 | Fechas de periodo de nómina desplazadas un día (UTC) | Fix local sin desplegar |
| SCH-04 | P3 | El filtro de asignación no ofrece `MANUAL` | Abierto |
| SCH-05 | P3 | KPIs de schedules en inglés dentro de UI en español | Abierto |
| OBS-01 | P3 | Errores 400 repetidos en consola/red de schedules | Abierto |

## Estado de corrección (verificación local, 2026-10-29)

Cierre del plan `tasks/plan-auditoria-frontend.md`. Puerta global: `eslint` 0 errores, `tsc --noEmit` limpio y `next build` OK (con `NODE_OPTIONS=--max-old-space-size=4096`; el heap por defecto de 2 GB agota memoria). Tests unitarios de las áreas tocadas: 57/57. **No se desplegó a producción**; los estados de abajo son del árbol local.

| ID | Estado | Verificación |
|---|---|---|
| SCH-01 | Corregido | `GET /api/workflows/schedules?branchId=…` → 200 sin filtros; filtros válidos e inválidos conservan su contrato |
| SCH-02 | Corregido | KPIs 7/7/0/0 (Polanco) y 1/1/0/0 (Roma) con el seed; lista renderiza |
| SCH-03 | Corregido | Header, selector y `branchId` de las peticiones coinciden; Roma envía `b1000001-…-0003` |
| PAY-01 | Corregido (local) | Sin fechas o sin `canStamp`, timbrado deshabilitado; submit por teclado no dispara POST; modal no afirma "Timbrados" |
| LIVE-01 | Corregido (local) | Roma: "Abrió tarde (14:00 hrs)", Aperturas a Tiempo 0 % · 0/1, coherente con la matriz; "Sin dotación" sin turnos |
| LAB-01 | Corregido | "Sin dotación configurada" en vez de 1/0 y 0 % |
| LAB-02 | Corregido | La métrica usa `hireDate`; el seed no infla altas de los últimos 7 días |
| EVID-01 | Corregido (local) | Sucursal global respetada, total filtrado = filas, filtro "verificadas" sin mezclar subconjuntos |
| SEED-01 | Corregido y datos reconstruidos | Guardia `dueDate > now` + resiembra autorizada: **0 instancias futuras**; espejo canónico 1,298/1,298 pasos (1,300 adjuntos), 0 faltantes |
| NAV-01 | Corregido | Cambio Condesa→Roma actualiza header, selector, KPIs y listado sin reload |
| RBAC-01 | Corregido | Diana: "Solo lectura" en bitácora, sin nav de workflows, `GET /dashboard/workflows` → **403**; Juan: CTAs "Iniciar" y stepper 200 |
| I18N-01 | Corregido | Módulo de empleados en español, claves en `messages/es.json` |
| PAY-02 | Corregido (local) | Periodo 22–28 oct 2026 coincide con API y modal |
| SCH-04 | Corregido | Filtro incluye "Manual"; `assignmentType=MANUAL` → 200 |
| SCH-05 | Corregido | KPIs "Programaciones Totales / Activas / Ejecuciones de Hoy / Próximas" |
| OBS-01 | Corregido | Sin respuestas 400 ni reintentos en schedules |

**Pendiente antes de producción:** despliegue y repetición del recorrido contra el sitio publicado. Detalle en `verificacion-local-2026-10-29.md` y `seed-reseed-2026-10-29.log`.

## P1 — Bloqueantes

### SCH-01 — `/dashboard/schedules` no lista nada (API 400 siempre)

**Reproducción:** abrir `/dashboard/schedules` con cualquier sucursal. La lista muestra `Error: Failed to fetch schedules` y la red registra:

```
GET /api/workflows/schedules?branchId=b1000001-0000-4000-8000-000000000001 → 400
{"error":"Invalid filters", ...}
```

**Causa:** `app/api/workflows/schedules/route.ts:26-34` convierte parámetros ausentes en `null` (`searchParams.get(...) as any`) y luego los valida con `scheduleFiltersSchema`, cuyos campos usan `.optional()`. Zod rechaza `null`, así que cualquier consulta sin `frequency` y `assignmentType` falla el 100 % de las veces.

**Impacto:** la pantalla de programación de workflows queda inutilizable para listar y filtrar.

**Corrección y aceptación:** omitir las claves ausentes (quedarse en `undefined`) o aceptar `.nullish()` en `lib/validations/workflow-scheduling.ts`. Aceptación: `GET` sin filtros devuelve 200 y la lista renderiza los schedules de la sucursal.

### SCH-02 — KPIs de schedules en blanco por contrato de respuesta

**Reproducción:** las cuatro tarjetas superiores muestran etiquetas pero ningún valor. El endpoint de stats responde 200 con `{success:true,data:{totalSchedules:19,activeSchedules:19,executionsToday:0,upcomingExecutions:0}}`.

**Causa:** `components/schedules/schedule-stats.tsx:31-32` y `components/schedules/schedule-list.tsx:77-78` hacen `setStats(data)` / `setSchedules(data)` sobre el sobre completo, no sobre `data.data`.

**Corrección y aceptación:** desenvolver el envelope o usar el helper de `lib/api/response.ts`. Aceptación: 19/19/0/0 visibles en las tarjetas.

### SCH-03 — La página opera sobre una sucursal distinta a la del header

**Reproducción:** el header global indica **Roma**, pero el selector interno muestra **Condesa** y las peticiones se envían con el `branchId` de Condesa.

**Causa:** `app/dashboard/schedules/page.tsx:38-63` carga `/api/branches` y fija `data[0].id`, ignorando el selector global.

**Impacto:** riesgo de programar o editar workflows en la sucursal equivocada sin aviso.

**Corrección y aceptación:** inicializar desde la misma resolución de sucursal que el resto del dashboard. Aceptación: header, selector interno y peticiones coinciden al entrar y al cambiar de sucursal.

### PAY-01 — Nómina permite iniciar timbrado sin periodo y confunde estados

**Reproducción:** en `/dashboard/labor/payroll`, el botón **"2. Ejecutar y Timbrar Nómina"** está habilitado con fechas vacías. El modal **"Recibos de Nómina Timbrados"** lista empleados con estado **PENDIENTE**.

**Impacto:** flujo fiscal disparable sin datos válidos y copy que afirma un estado que no existe. Ver también F11 del informe base.

**Estado:** el árbol local ya contiene el gating (`app/dashboard/labor/payroll/page.tsx:208-222,480`) y el título dinámico del modal (`:583-589`), sin desplegar.

**Corrección y aceptación:** desplegar y verificar periodo en cliente y servidor antes de habilitar la acción. Aceptación: sin fechas, la acción está deshabilitada y el modal no afirma timbrado.

### LIVE-01 — KPIs de sucursal desfasados

**Reproducción:** la hora de apertura mostraba **20:00** para actividad de 14:00 en México y **100 %** en "Aperturas a Tiempo" mientras la matriz marcaba aperturas tardías.

**Causa:** `lib/services/live-command-service.ts` usaba `getHours()` del proceso (UTC) y el KPI se calculaba con `openCount` en vez de `onTimeCount`.

**Estado:** ya corregido en el árbol local (`businessTimeParts`, `onTimeRatePercent`), no desplegado. Aceptación tras despliegue: hora local de sucursal y tasa coherente con las filas.

## P2 — Impacto operativo

### LAB-01 — "1/0 empleados en turno" y 0 % de asistencia

`app/dashboard/labor/page.tsx:99,267` calcula 0 % cuando no hay turnos programados y renderiza `Hoy: 1/0`. Debe distinguir "sin dotación configurada" (el servicio ya usa `null` para ese caso) de ausencia real.

### LAB-02 — "+8 nuevos esta semana" engañoso

`app/dashboard/labor/page.tsx:188,226` cuenta todos los usuarios creados en los últimos 7 días, incluidos seed y roles no operativos. En demo infla la métrica y sugiere contrataciones inexistentes.

### EVID-01 — Evidencias ignora la sucursal global

`app/dashboard/evidence/page.tsx` mantiene filtros locales en lugar de la sucursal efectiva, y `app/api/workflows/evidence/route.ts` no devuelve el total filtrado. Fix presente localmente (`useBranch`, filtros y total), sin desplegar. Relacionado con F03 y F05.

### SEED-01 — Actividades recientes con fechas futuras

Instancias sembradas con fechas futuras (`scripts/seed-05-workflows.ts`) aparecen en "actividad reciente" con textos como "en alrededor de 10 horas". Es dato de demostración, no bug de UI, pero rompe la credibilidad del dashboard.

### NAV-01 — El selector global no refresca la vista servida

Cambiar de sucursal no re-renderiza los componentes de servidor hasta un reload completo; el usuario ve datos de la sucursal anterior junto al nombre nuevo.

### RBAC-01 — READONLY ve CTAs "Iniciar" que lo expulsan

En el dashboard de Diana (READONLY) los workflows muestran "Iniciar"; al pulsar, la ruta redirige fuera en lugar de ocultar o deshabilitar la acción según rol.

### I18N-01 — Módulo de empleados en inglés

Textos hardcodeados en inglés dentro de UI en español:

- `components/employees/employee-directory.tsx:191-193` ("Employee Directory", "Manage your team members…").
- `components/employees/employee-filters.tsx:84-104` ("All Departments", "All Statuses").
- `components/employees/document-grid.tsx:137`.
- `components/employees/employee-advanced-search.tsx:164-190`.

### PAY-02 — Fechas de periodo desplazadas un día

Por manejo de fecha civil en UTC, el rango mostrado se corre ±1 día. Ver F02. Fix local existente en `app/dashboard/labor/payroll/page.tsx` y `lib/business-date.ts`, sin desplegar.

## P3 — Menores

- **SCH-04:** el filtro de asignación no ofrece `MANUAL`, aunque el modelo y el formulario sí lo soportan (`app/dashboard/schedules/page.tsx`).
- **SCH-05:** KPIs de schedules en inglés ("Total Schedules", "Active Schedules", "Executions Today", "Upcoming") en página en español.
- **OBS-01:** errores 400 repetidos en consola/red de schedules que ensucian el diagnóstico.

## Correcciones escritas pero no desplegadas

| Área | Archivos modificados |
|---|---|
| KPIs live / hora local | `lib/services/live-command-service.ts`, `lib/business-date.ts`, `components/dashboard/live/*` |
| Evidencia | `app/dashboard/evidence/page.tsx`, `app/api/workflows/evidence/route.ts`, `lib/storage/scoped-evidence.ts` |
| Nómina | `app/dashboard/labor/payroll/page.tsx` |
| Dashboard / historial | `app/dashboard/page.tsx`, `app/dashboard/workflows/history/page.tsx`, `components/dashboard/recent-activity.tsx` |
| i18n | `messages/es.json` |
| Datos demo | `scripts/seed-04..18`, `seed-cleanup.ts` |

Desplegar ese árbol resolvería PAY-01, LIVE-01, EVID-01 y PAY-02, pero no SCH-01/02/03, LAB-01/02, I18N-01 ni SEED-01, que siguen abiertos en el código actual.

## Comprobaciones y límites

- 38 rutas muestreadas respondieron 200 con SUPER_ADMIN; sin errores 500 observados.
- Se verificaron login/logout, navegación por rol, inventario, labor, cumplimiento, evidencia, workflows e historial.
- No se validaron flujos destructivos (timbrado, dispersión, bajas) por diseño; PAY-01 se reporta por inspección de UI y estado del modal.
- Falsos positivos descartados: placeholders de fecha (visibles en captura) y el preset de evidencias (la petición sí se disparó; el log de red estaba truncado).
- No se auditó cada ruta, exportaciones, lector de pantalla ni el ciclo fiscal completo.

## Orden de corrección propuesto

1. SCH-01/SCH-02: arreglar contrato de filtros y envelope de schedules.
2. SCH-03: unificar resolución de sucursal en la página de schedules.
3. Desplegar el árbol local pendiente (PAY-01, LIVE-01, EVID-01, PAY-02) y verificar gating y fechas.
4. LAB-01/02 y RBAC-01: estados vacíos honestos y gating por rol.
5. I18N-01, SCH-04/05: traducciones y paridad de filtros.
6. SEED-01: eliminar instancias futuras del seed.
7. Repetir los escenarios con SUPER_ADMIN, GERENTE y READONLY contra el despliegue actualizado.
