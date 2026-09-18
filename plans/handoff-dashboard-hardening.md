# Handoff — Hardening de `app/dashboard/` (Comando de Red en Vivo)

**Fecha:** 2026-09-18
**Plan maestro:** `plans/2026-09-18-hardening-comando-red-dashboard.md` (643 líneas — leerlo completo antes de tocar código)
**Origen:** `.impeccable/critique/2026-09-18T17-42-14Z__app-dashboard.md` (score 23/40, 4×P1, 5×P2)
**Superficie:** `app/dashboard/` → `http://localhost:3000/dashboard` (demo: `carlos@pulso.mx`, empresa "Pulso HORECA Demo", 3 sucursales)

---

## 1. Estado actual

**Completado y verificado (F0.0 y F0.1a):**

| Item | Qué se hizo | Verificación |
|---|---|---|
| **F0.0** | `notInArray(status, ["RESOLVED"])` en vez de `or(eq,eq,eq)` para incidentes abiertos | ✅ end-to-end: `criticalAlertsCount` 0 → 1; se recuperó un `FATAL/ESCALATED` "Incendio menor en parrilla" que era invisible |
| **F0.1a** | Nuevo `lib/business-date.ts`; un solo calendario (zona MX) en el servicio | ✅ 13/13 tests; bug UTC de las 18:00 reproducido y fijado |

`tsc`: 0 errores. `eslint` en archivos tocados: limpio. **El banner ahora sale ROJO en la demo** — es correcto, antes mentía.

**Archivos modificados/creados:**

```
lib/services/live-command-service.ts      (mod, 384 líneas)
lib/business-date.ts                      (nuevo, 112 líneas)
lib/__tests__/business-date.test.ts       (nuevo — 13 tests)
plans/2026-09-18-hardening-comando-red-dashboard.md  (nuevo)
scripts/check-live-command-pulse.ts       (nuevo — diagnóstico end-to-end)
scripts/spike-f0-dotacion.ts              (nuevo — read-only)
scripts/spike-f0b-anclaje-fechas.ts       (nuevo — read-only)
scripts/spike-f0c-incidentes-seed.ts      (nuevo — read-only)
```

**Pendiente:** F0.1b, F0.2, F0.3, F0.4-F0.6, y todas las fases F1-F7.

> ⚠️ `app/dashboard/sales/page.tsx` aparece modificado en `git status` **pero no es de este trabajo** — viene de una sesión anterior. No lo mezcles en tus commits.

---

## 2. Lo primero que debes leer

1. `plans/2026-09-18-hardening-comando-red-dashboard.md` — el plan. Secciones 2.6-2.12 tienen la evidencia dura del spike.
2. `lib/business-date.ts` — 112 líneas, el helper de fechas. Entender esto evita el bug más caro del repo.
3. `scripts/check-live-command-pulse.ts` — corre esto primero para ver el estado real del servicio.

```bash
npx tsx scripts/check-live-command-pulse.ts
```

---

## 3. Mapa del archivo que vas a tocar

`lib/services/live-command-service.ts` — **un solo método grande** (`getLivePulse`, ~línea 86). Líneas por número, tras los cambios de F0.0/F0.1a:

| Línea | Qué hay | Estado |
|---|---|---|
| 25 | `TERMINAL_INCIDENT_STATUSES` | ✅ F0.0 |
| 87-89 | `todayStart` / `todayEnd` / `todayIsoDate` | ✅ F0.1a |
| 106-119 | early-return si no hay sucursales | ok |
| 203 | `notInArray(incidents.status, ...)` | ✅ F0.0 |
| **304** | `Math.max(activeStaff, 4)` | ❌ **F0.3 — autorreferencial** |
| **310** | `nomStatus` colapsa "sin dato" en `"WARNING"` | ❌ **F0.2** |
| **336** | `lateCount: 0` (constante) | ❌ F0.3 |
| 354 | `rushAlerts` desde `incidentRows` | parcial |
| **369** | `staffAttendanceRate` divide entre `(totalBranches * 4)` | ❌ F0.4 |
| **379** | `criticalAlertsCount: rushAlerts.length` (techo de 4 por `.slice(0,4)`) | ❌ F0.5 |

Tipos a extender: `BranchLiveStatus` (~línea 29) y `LivePulseSummary` (~línea 59).

**Consumidores UI:**
```
components/dashboard/live/live-command-section.tsx   (server, orquesta)
components/dashboard/live/live-pulse-banner.tsx      (:45 usa summary.businessDate; :54 el if del verde)
components/dashboard/live/live-command-matrix.tsx    (client; filtros :97/:107, búsqueda :88)
components/dashboard/area-card.tsx                   (:9-10 fatal y critical comparten className)
app/dashboard/loading.tsx                            (skeletons desalineados)
app/dashboard/page.tsx                               (:44, :53, :57)
```

---

## 4. Decisiones que bloquean (necesitan respuesta humana)

| # | Decisión | Bloquea | Recomendación registrada |
|---|---|---|---|
| **D-A** | **Política de timestamps** (ver gotcha §6.1) | **F0.1b, F0.4** | Normalizar en lectura o migrar a `timestamptz`. **Preguntar antes de tocar.** |
| **D-B** | Dónde va la etiqueta `dataAsOf` (banner / por tarjeta / ambos) | **F0.1b** | Por sección, junto al dato que describe |
| **D1** | F4: ¿briefing honesto (A) o monitor SSE (B)? | F4 | A ahora, B después. El SSE ya existe sin usar (`lib/hooks/use-analytics-sse.ts`) |
| **D2** | ¿Finanzas se borra o se llena? | F5.4 | Borrar hasta tener fuente Nivel A |
| **D3** | `fatal` vs `critical`: ¿ícono o token nuevo? | F2.1 | Ícono distinto — sin tocar tokens |
| **D4** | ¿Se colapsa la fila de 4 KPI en turno frío? | F7 | Sí — `DESIGN.md` §6 prohíbe el hero-metric por defecto |
| **D6** | ~~Día operativo por fuente~~ | — | ✅ **RESUELTO: opción C (por fuente)** |
| **D7** | ¿Re-sembrar la demo? | Demo readiness | **Después** de F0.1b. Antes enmascara el bug |

---

## 5. Items pendientes, en orden

### F0.1b — Anclas por fuente + `dataAsOf` (BLOQUEADO por D-A)

`lib/business-date.ts` ya exporta `DataAnchor { asOf, isCurrent }` y `dataAnchorFor(latestDate)` — listos para usar, sin consumidores todavía.

1. Resolver el ancla de cada fuente por separado como su fecha real más reciente con datos: `sessions`, `temperatures`, `sales`, `workflows`.
2. Usar esa ancla en el `where` en vez de "hoy".
3. Exponer `dataAsOf: DataAnchor` por bloque en `LivePulseSummary`.
4. **La UI DEBE declararlo** — mostrar datos de ayer sin etiqueta es peor que mostrar un cero. Depende de D-B.

**Confirmado por el spike:** `shift_sessions.planned_shift_id` está poblado en **104/104** filas → el join con `planned_shifts.shift_date` es viable.

### F0.2 — Separar "sin dato" de "dato malo"

`nomStatus` (línea 310) hoy hace: `nonCompliant > 0 ? "CRITICAL" : bTemps.length > 0 ? "OK" : "WARNING"`. El último caso produce un ámbar **idéntico al de "fuera de rango"**. Un director no puede distinguir "no mediste" de "mediste mal".

Agregar estado propio (`NOT_LOGGED` o similar) con token neutro, y aplicar el mismo criterio a `opening`, `staff` y `sales`. Verificado: las 3 sucursales reportan `nom251=WARNING` cuando en realidad no hay lecturas desde el 01-sep.

### F0.3 — Denominador real de dotación

1. `expectedStaff` = turnos planificados **publicados** (`planned_shifts.status = "PUBLISHED"`) de la sucursal en el día operativo resuelto.
2. **Eliminar `Math.max(activeStaff, 4)`** (línea 304) y su comentario.
3. `lateCount` desde `shiftSessions.lateMinutes > 0` — **requiere agregar `lateMinutes` al `select`** (líneas 132-138, hoy solo trae `id`, `branchId`, `status`, `startedAt`) y al tipo. Hay 1 tardanza real en la base.
4. Estado `"UNKNOWN"` cuando no hay turnos planificados → UI dice **"Sin dotación configurada"**, sin porcentaje.

### F0.4 — Un solo cálculo de asistencia

`staffAttendanceRate` (línea 369) usa `4` fijo mientras la línea 304 usa `Math.max(activeStaff, 4)` → **dos fórmulas del mismo concepto**. Debe usar la suma de `expectedStaff` de F0.3. Si el total es 0 → `null`, no `0`. Esto es lo que hace que el banner diga "0% cubierto" y la matriz "0 de 4 activos".

### F0.5 — Conteo de alertas sin techo

```ts
const criticalAlerts = incidentRows.filter(i => i.severity === "CRITICAL" || i.severity === "FATAL");
const rushAlerts = criticalAlerts.slice(0, 4).map(...);   // solo display
criticalAlertsCount: criticalAlerts.length,               // conteo real
```
Ojo: `incidentRows` también está acotado por `.limit(15)` en la consulta (línea 207).

### F0.6 — Tipo

`BranchLiveStatus.staff.status`: agregar `"UNKNOWN"` (y `"NOT_LOGGED"` de F0.2). `live-command-matrix.tsx`: caso `UNKNOWN` → badge neutro, sin color de alarma.

### F2 — Severidad accesible (INDEPENDIENTE — se puede hacer en paralelo)

El fix más barato con más impacto, y **no depende de F0 ni de ninguna decisión**.

- `area-card.tsx:9-10` — `fatal` y `critical` mapean al **mismo string de clases, byte a byte**. Agregar ícono distinto + `<span className="sr-only">` con la palabra de severidad. El badge lleva severidad; el nombre de sucursal pasa a chip aparte (sirve también a F3).
- `live-command-matrix.tsx:97,107` — botones de filtro sin `aria-pressed`.
- `live-command-matrix.tsx:88` — `<Input>` solo con `placeholder`, sin label ni `aria-label`.
- `area-card.tsx:81` — `truncate` sin `title`/`aria-label`.

### F1 — Banner como máquina de estados (depende de F0)

`live-pulse-banner.tsx:54` gatea el verde solo en `criticalAlertsCount > 0`. `isOpenFull` (:27) e `isStaffHealthy` (:28) se calculan y **solo tiñen tiles**, nunca escalan el banner. Escalar sobre la unión: `openRatePercent`, `staffAttendanceRate`, `nom251`, `branchesWithIssues`. Decir el hecho específico ("3 de 3 sucursales con retraso de apertura") en vez del adjetivo ("Servicio Estable"). Reemplazar `bg-emerald-400/500` (:36-37) por `--success`.

### F3 — Excepciones legibles (requiere cambio de servicio)

`lib/services/group-exceptions-service.ts:118-127` — `INVENTORY_ALERT_TITLES` es un **mapa estático por tipo**, no una descripción por instancia. Por eso "Stock bajo en insumo clave" aparece 3 veces idéntico. Hay que **interpolar el sujeto real** (`item.name`), no solo poner `line-clamp-2`. Luego agrupar: "Stock bajo: tortilla ×3 sucursales".

### F4-F7

Ver plan maestro, secciones homónimas. F4 requiere D1; F5 depende de F1/F3.

---

## 6. Gotchas (cosas que un agente nuevo va a pisar)

### 6.1 — Los timestamps tienen un desfase de 6 h `[NO RESUELTO]`

Las columnas son `timestamp` **sin zona** (`schema.ts:72, 89`) pero se comparan contra límites calculados en hora local. Evidencia: `shift_sessions.started_at` máximo = `2026-09-18 05:00:00` (leído como `05:00Z`), y la ventana local del 18-sep empieza en `06:00Z` → **la sesión queda fuera por una hora**. Por eso el servicio reporta `0 colaboradores activos` habiendo actividad.

**No lo arregles sin decidir D-A.** Cambia la semántica de "hoy" en todo el producto.

### 6.2 — `.catch(() => [])` silencia errores de query

Todas las consultas de `getLivePulse` terminan en `.catch(() => [])`. Una consulta rota devuelve `[]` sin ruido y la UI muestra un cero que **parece un dato**. Si algo no cuadra, sospecha aquí antes de sospechar del cálculo.

### 6.3 — El seed está anclado a fechas absolutas

Hoy el servidor dice `2026-09-18`, pero: `temperature_logs` termina el **01-sep**, `incidents` el **31-ago**, `daily_sales_cuts` el **16-sep**, `workflow_instances` y `planned_shifts` el **17-sep**. Casi todos los ceros de la página son esto, no operación.

**No re-siembres antes de F0.1b** (D7): un seed fresco esconde el bug de anclaje y vuelve a hacer creer que los ceros eran reales.

### 6.4 — El critique tiene un error factual

Afirma que la matriz marca aperturas `DELAYED`. Con 0 workflows hoy el estado real es `PENDING`. Verificado en el servicio. No heredes esa narrativa.

### 6.5 — `Math.max(activeStaff, 4)` colapsa la lógica

Por ser autorreferencial, el semáforo se reduce a: ≤2 → `CRITICAL`, **exactamente 3 → `WARNING`**, ≥4 → `NORMAL`. La rama `WARNING` es alcanzable solo con 3 personas. No mide dotación: mide "¿hay menos de 4?".

### 6.6 — El detector no modela clases Tailwind

`detect.mjs` reportó **0 findings** en `app/dashboard`. No ve `shadow-xs`, ni `truncate`, ni `transition-all`. La ausencia de findings **no** significa que esté limpio — el critique lo detectó por overlays de browser, no por el scan estático.

### 6.7 — El bug de fecha era invisible en demos de mañana

`new Date().toISOString().slice(0,10)` devuelve la fecha UTC. De 18:00 en adelante en zona MX apunta a **mañana** → "$0 Venta Acumulada" todas las noches. Si pruebas a mediodía, no lo verás. Los tests de `lib/__tests__/business-date.test.ts` lo fijan determinísticamente — córrelos antes de tocar fechas.

---

## 7. Convenciones

- **Fechas de negocio:** usar **siempre** `lib/business-date.ts`. **Nunca** `new Date().toISOString().slice(0,10)` para derivar una fecha de negocio (mismo patrón pendiente en `cross-branch-service.ts:944-945`).
- **Multi-tenant:** filtrar por `companyId`; el servicio recibe `companyId` desde la página vía `auth.api.getSession`.
- **Servicios:** clases estáticas (`LiveCommandService.getLivePulse`), patrón ya establecido.
- **Server vs Client:** `live-command-section.tsx` es server; `live-command-matrix.tsx` es client. Los `dataAsOf` viajan por props.
- **Tokens, no colores crudos:** `--success`, `--warning-text`, `--success-text`, `--info` (ver `app/globals.css`). `bg-emerald-*` es deuda.
- **Flat-By-Default:** `DESIGN.md` §4/§6 prohíben sombras en cards. `shadow-xs` es deuda.
- **Idioma UI:** español. Comentarios de código: español, explicando el *por qué*.
- **`prefers-reduced-motion`** ya está resuelto globalmente (`globals.css:207`) — no lo reimplementes.

---

## 8. Comandos

```bash
# Diagnóstico del servicio real (correr primero)
npx tsx scripts/check-live-command-pulse.ts

# Tests de fecha de negocio — correr antes de tocar cualquier fecha
pnpm test:unit lib/__tests__/business-date.test.ts

# Verificación estándar
pnpm run lint
npx tsc --noEmit -p tsconfig.json
pnpm run build

# Detector de anti-patrones (ojo: no ve clases Tailwind — ver 6.6)
node .agents/skills/impeccable/scripts/detect.mjs --json app/dashboard components/dashboard components/shared

# NO USAR db:push — puede dropear tablas. Verificar contra qué DB apunta antes.
```

---

## 9. Próximo inicio sugerido

**Si tienes respuesta a D-A y D-B:** F0.1b → F0.2 → F0.3 → F0.4 → F0.5, y F2 en paralelo.

**Si NO las tienes:** **empieza por F2.** Es independiente de todo, no requiere decisiones, y arregla el ítem donde el código directamente no tiene defensa: `fatal` y `critical` comparten `className` byte a byte, así que la severidad más grave del sistema es visual y semánticamente idéntica a la segunda. Son ~5 líneas por archivo.

**Después de F2:** F0.3 (denominador) es el siguiente más contenido y desbloquea F0.4.

**No hagas primero:** F1 (banner) ni F5 (frames) — F1 depende de F0 y F5 depende de F1/F3. Hacerlos antes significa rehacerlos.

---

## 10. Definition of Done global

Ver `plans/2026-09-18-hardening-comando-red-dashboard.md` §7. Los ya cumplidos:

- [x] Incidente `FATAL` + `ESCALATED` produce `criticalAlertsCount > 0`
- [x] `rg "eq\(incidents.status"` no enumera status abiertos a mano
- [x] `rg "toISOString\(\)\.slice\(0, 10\)" lib/services/live-command-service.ts` → 0
- [x] 13/13 tests de fecha de negocio

Pendientes: `dataAsOf` por bloque, "sin registro" ≠ "fuera de rango", `Math.max(activeStaff, 4)` → 0, `lateCount: 0` → 0, banner/KPI coinciden, severidad sin color, `nested-cards` <8, `text-overflow` = 0, `axe` limpio, `shadow-xs` → 0, cero solapamientos a 390×844.

---

## 11. Recordatorio de alcance

`PRODUCT.md` fija esto como el panel de un dueño de 3-15 sucursales que decide en 30 segundos. La regla que ordena todo el trabajo:

> **"Sin dato" y "dato malo" no pueden pintarse igual, y un adjetivo ("Servicio Estable") nunca es un dato.**

Cada item de este plan existe para servir esa regla. Si un cambio la debilita, no lo hagas aunque marque una casilla.

---

## 12. Progreso — sesión 2 (implementación)

**Hecho y verificado** (`tsc` 0 errores, `eslint` limpio en tocados, `pnpm run build` ✓, 13/13 tests de fecha):

| Item | Qué cambió | Verificación |
|---|---|---|
| **F2.1** | `area-card.tsx`: `fatal` y `critical` ya no comparten className. Glifo por severidad + `<span sr-only>`; el badge lleva severidad y la sucursal pasa a chip con `title`. | `fatal` = relleno sólido, `critical` = tinte; NVDA lee "Severidad Fatal/Crítico" |
| **F2.2/F2.3** | `aria-pressed` en los filtros y `aria-label` en la búsqueda de la matriz. | inspección |
| **F0.2** | `nom251.status` gana `NOT_LOGGED`; "sin registro" usa badge neutro, no el ámbar de "fuera de rango". | `check-live-command-pulse`: `nom251=NOT_LOGGED` en las 3 |
| **F0.3** | `expectedStaff` = `planned_shifts` PUBLISHED del día; se eliminó el `Math.max` autorreferencial; `lateCount` real desde `lateMinutes`; estado `UNKNOWN` cuando no hay dotación. | script: `personal=UNKNOWN (0/0)` |
| **F0.4** | `staffAttendanceRate` usa `totalExpectedStaff` (mismo denominador que cada sucursal); `null` cuando no hay dotación. Tipo `number \| null`. | script: `null (sin dotación planificada)` |
| **F0.5** | El conteo es `criticalAlerts.length`; el `slice(0,4)` quedó solo para display. Se quitó el `limit(15)` de la consulta. | banner sigue ROJO con 1 FATAL |
| **F0.6** | Tipos `UNKNOWN`/`NOT_LOGGED`; matriz con badges neutros y "Sin dotación configurada". | `tsc` |
| **F1** | Banner = máquina de estados (`critical`/`attention`/`stable`) sobre aperturas + dotación + frío + alertas. Copy del hecho ("3 de 3 sucursales sin apertura a tiempo"). `emerald` → `--success/--warning/--destructive`. `animate-ping` solo en estable. | `rg emerald components/dashboard/live/` → 0 |
| **F3.1** | `group-exceptions-service.ts`: join a `inventory_items`, título interpola `item.name`. | `tsc` |
| **F3.3** | `truncate` → `line-clamp-2` + `min-w-0` en el título de excepción. | inspección |
| **F6.2/F6.3** | `shadow-xs` → 0 en `app/dashboard` + `components/dashboard`; `transition-all` → `transition-colors` en los 3 componentes live. | `rg shadow-xs` → 0 |

**Pendiente y bloqueado por decisiones humanas:**

- **F0.1b** (`dataAsOf` por fuente) — bloqueado por **D-A** (política de timestamps, gotcha §6.1) y **D-B** (dónde va la etiqueta).
- **F0.3 nota:** el ancla de dotación se resolvió con el día de negocio actual (`todayIsoDate`), porque `shift_date` es texto y no sufre el desfase de zona. Las columnas `timestamp` (sesiones, temperaturas, workflows) **siguen** con el desfase de 6 h → `staffActiveNow` y `lateCount` pueden subcontar hasta que se resuelva D-A.
- **F3.2** (agrupar por condición), **F4** (decidir A/B), **F5**, **F6.1** (skeletons), **F7**.
- **Verificación de navegador** (`axe`, contraste claro/oscuro, 390×844) no ejecutada: no había dev server levantado.

**DoD verificados con rg:** `Math.max(activeStaff, 4)` → 0; `lateCount: 0` → 0; `eq(incidents.status` → 0; `toISOString().slice(0,10)` en el servicio → 0; `emerald` en live → 0; `shadow-xs` en dashboard → 0.
