# Plan de implementación — Hardening de `app/dashboard/` (Comando de Red en Vivo)

**Origen:** `.impeccable/critique/2026-09-18T17-42-14Z__app-dashboard.md` (score 23/40, 4×P1, 5×P2)
**Más:** 4 hallazgos adicionales verificados en código por esta revisión, **no cubiertos por el critique**
**Estado:** Propuesto — pendiente de aprobación
**Última actualización:** 2026-09-18

---

## 1. Tesis del plan

El critique está bien jerarquizado y **todos** sus hallazgos técnicos se confirmaron contra el código. Pero tiene un punto ciego que reordena el trabajo:

> **Los 5 "Questions to Consider" y 4 de los P1 asumen que los números de la página son ciertos, y solo discuten cómo se presentan. Los números no son ciertos — pero tampoco son lo que el critique creyó.**

El critique leyó la página como **una crisis operativa tapada por un banner verde**. El spike (sección 2.6-2.8) muestra que son **dos fallas independientes** que casualmente producen la misma pantalla:

1. **Un falso verde real y verificable** — un incidente `FATAL` en status `ESCALATED` que el filtro del servicio descarta, con repro vivo hoy. → **F0.0, una línea.**
2. **Un desfase de fechas** que hace que casi todos los demás ceros no sean crisis sino ausencia de datos para el período consultado (temperaturas al 09-01, cortes al 09-16, workflows al 09-17). → **F0.1.**

Arreglar solo el banner habla un banner honesto sobre números que siguen siendo ininterpretables. Arreglar solo las fechas deja el FATAL invisible.

**Regla de ordenamiento:** ningún cambio de presentación se aprueba antes de que su fuente de datos sea defendible — y "defendible" incluye **declarar de qué fecha son los datos**.

**Lo que este plan ya se corrigió a sí mismo:** la versión inicial de F0 habría introducido un tercer anclaje de fecha inconsistente (2.8). El spike lo detectó antes de escribir código.

---

## 2. Hallazgos adicionales (verificados, fuera del critique)

### 2.1 — La dotación de personal es autorreferencial `[BLOQUEANTE]`
`lib/services/live-command-service.ts:286`

```ts
const expectedStaff = Math.max(activeStaff, 4); // plantilla QSR estimada estándar por turno
const staffStatus = activeStaff >= expectedStaff ? "NORMAL" : ...;
```

`expectedStaff` se deriva de `activeStaff`. Si hay 5 personas activas, el esperado pasa a ser 5 → **siempre `NORMAL`**. La lógica colapsa a un umbral duro: ≤2 `CRITICAL`, 3 `WARNING`, ≥4 `NORMAL`. El comentario admite que "4" es estimado; lo que no admite es que el `Math.max` hace que el semáforo no pueda fallar arriba.

**La rama `WARNING` es alcanzable solo con exactamente 3 personas.** El semáforo no mide dotación: mide "¿hay menos de 4?".

### 2.2 — Dos fórmulas distintas del mismo concepto en la misma función `[BLOQUEANTE]`
`lib/services/live-command-service.ts:351`

```ts
const staffAttendanceRate = ... (totalActiveStaff / (totalBranches * 4)) * 100
```

- Línea 286: `Math.max(activeStaff, 4)` (por sucursal)
- Línea 351: `4` fijo, sin `Math.max` (agregado)

Por eso el banner dice "0 de 4 activos" y el KPI dice "0% cubierto": **son cuentas que no pueden concordar por construcción.** Esto contradice el elogio del critique a la disciplina de la sección ("se omite en vez de inventar un número") — aquí sí se inventó, en el elemento más prominente de la pantalla.

### 2.3 — `lateCount` es una constante `0` que la UI ofrece como dato `[ALTO]`
`lib/services/live-command-service.ts:318` → `lateCount: 0`

`live-command-matrix.tsx:252-254` renderiza `({b.staff.lateCount} tarde)` — **código muerto y permanentemente cero**. El dato real existe: `shiftSessions.lateMinutes` (`schema.ts:560`) y `shiftSessions.complianceFlags.lateCheckIn` (`schema.ts:557`).

### 2.4 — `criticalAlertsCount` tiene techo de 4 y se presenta como total `[ALTO]`
`lib/services/live-command-service.ts:336-338` → `.slice(0, 4)`, y `:361` → `criticalAlertsCount: rushAlerts.length`

El KPI "Riesgos Operativos" nunca mostrará más de 4, con `slice` pensado para la lista de display. El CTA contiguo ("Ver mesa") promete una mesa más grande que la que el número sugiere.

### 2.5 — Datos disponibles para arreglar lo anterior (verificado, sin inventar)

| Necesidad | Fuente real existente | Ubicación |
|---|---|---|
| Dotación planificada | `plannedShifts.shiftDate` + `status = "PUBLISHED"` + `branchId` | `schema.ts:473-489` |
| Personal activo | `shiftSessions.status ∈ {ACTIVE, COMPLETED}` | ya en uso |
| Tardanzas | `shiftSessions.lateMinutes`, `complianceFlags.lateCheckIn` | `schema.ts:557,559` |
| No-shows | `shiftSessions.status = "NO_SHOW"` | `schema.ts:539` |

**No hay que agregar columnas** — pero ver 2.8: el dato existe y **está vacío para hoy**. Eso cambia el diseño de F0.

### 2.6 — EL MECANISMO EXACTO DEL FALSO VERDE `[CONFIRMADO CON DATOS]`

El filtro de incidentes (`live-command-service.ts:171-175`) incluye solo tres status:

```ts
eq(incidents.status, "DETECTED"), eq(incidents.status, "IN_REMEDIATION"), eq(incidents.status, "CONFIRMED")
```

El enum real tiene **seis** (`schema.ts:30`):

```ts
['DETECTED', 'IN_REMEDIATION', 'AWAITING_EXTERNAL', 'CONFIRMED', 'RESOLVED', 'ESCALATED']
```

**Faltan `ESCALATED` y `AWAITING_EXTERNAL`.** Es decir: *cuanto más escalas un incidente, menos lo ve el dashboard.* `ESCALATED` es más urgente que `CONFIRMED` y queda fuera; `AWAITING_EXTERNAL` (bloqueado con terceros, abierto) también.

**Y hay un caso vivo en la base de datos:**

| severity | status | n | ¿lo ve el banner? |
|---|---|---|---|
| **FATAL** | **ESCALATED** | **1** | ❌ **NO — invisible** |
| HIGH | DETECTED | 1 | ✅ |
| WARNING | DETECTED | 1 | ✅ |
| WARNING | CONFIRMED | 1 | ✅ |

Resultado medido: `criticalAlertsCount = 0` → **`→ BANNER VERDE`**. Hay un incidente FATAL escalado que el banner no puede ver.

**Esto es el falso all-clear real, y es un fix de una línea.** El critique describió el síntoma correctamente (`criticalAlertsCount` como único gatillo) pero no llegó al mecanismo: no es solo que el contador sea estrecho, es que **el filtro de status tira el incidente más grave de la base**.

### 2.7 — La página entera está desfasada de sus datos `[CONFIRMADO CON DATOS]`

Spike ejecutado contra la base real (`scripts/spike-f0*.ts`, hoy = **2026-09-18**):

| Fuente | Rango real de datos | Registros para HOY |
|---|---|---|
| `planned_shifts.shift_date` | 2026-08-19 → **2026-09-17** | **0** |
| `shift_sessions.started_at` | 2026-08-19 → 2026-09-18 | 1 |
| `temperature_logs.timestamp` | 2026-08-22 → **2026-09-01** | **0** |
| `daily_sales_cuts.business_date` | 2026-08-17 → **2026-09-16** | **0** |
| `workflow_instances.created_at` | 2026-08-28 → **2026-09-17** | **0** |
| `incidents.created_at` | 2026-08-28 → **2026-08-31** | 0 (filtro por status) |

**Consecuencia: casi todo lo que el critique leyó como crisis operativa es deriva de fechas, no operación.**

| Lo que muestra la página | Lo que el critique interpretó | Lo que realmente es |
|---|---|---|
| "Aperturas a Tiempo **0%**" | 3 sucursales con retraso | 0 workflows hoy → `isOpen=false` → `PENDING` (**no** `DELAYED`) |
| "**0** colaboradores activos" | emergencia de personal | 1 sesión hoy; el resto son de 09-16/09-17 |
| "Sin registro" de frío NOM-251 | fallo de inocuidad hoy | **no hay lecturas desde 2026-09-01** |
| "$0 Venta Acumulada" | el turno apenas inicia | **no hay cortes desde 2026-09-16** |

El verde del banner **sí** es falso (2.6, mecanismo confirmado). Pero las sucursales no están marcadas por una crisis: están marcadas porque **el seed termina el 17 y hoy es 18**.

**Corolario de copy:** el critique afirmó que la matriz marca `DELAYED`. Con 0 workflows hoy el estado es `PENDING`. La narrativa de "retraso de apertura" era una lectura del badge, no del dato.

### 2.8 — Mi propio F0.1 estaba mal `[CORREGIDO]`

El spike salvó un bug. La propuesta original ("`expectedStaff` = `plannedShifts` con `shiftDate = today`") habría dado **0 hoy**, mientras las sesiones se filtran por `started_at >= today` y dan **1**. Es decir:

> **Habría introducido un TERCER anclaje de fecha inconsistente**, que es exactamente la clase de bug que F0 existe para arreglar.

El problema real no es el denominador. Es que **la página mezcla dos anclajes distintos del mismo concepto** — `planned_shifts.shift_date` (fecha de negocio planificada) y `shift_sessions.started_at` (marca de tiempo de inserción) — y encima asume que ambos coinciden con "hoy".

### 2.9 — Nota sobre el critique
Ruta corregida: `area-card.tsx` vive en `components/dashboard/`, no en `components/dashboard/live/`. Todo lo demás del critique que se pudo verificar es exacto.

### 2.10 — Colisión de conceptos: "sin dato" y "dato malo" pintan igual

`nomStatus = nonCompliant > 0 ? "CRITICAL" : bTemps.length > 0 ? "OK" : "WARNING"` (`:291`) → "Sin registro" es un `WARNING` ámbar, **idéntico al ámbar de "fuera de rango"**. Un director no puede distinguir "no mediste la temperatura" de "la mediste y estaba mal". Son hechos operativos distintos y exigen acciones distintas.

Verificado en el servicio real: las 3 sucursales reportan `nom251=WARNING` cuando en realidad **no hay ninguna lectura desde el 01-sep**.

### 2.11 — La fecha de negocio se calculaba en UTC `[BUG SEVERO — CORREGIDO]`

`new Date().toISOString().slice(0, 10)` devuelve la fecha **UTC**. En Mexico (UTC-6), a partir de las **18:00 hora local** el reloj UTC ya está en el día siguiente:

| Hora local MX | `toISOString().slice(0,10)` | Fecha local correcta |
|---|---|---|
| 09:00 | 2026-09-18 | 2026-09-18 |
| 17:00 | 2026-09-18 | 2026-09-18 |
| **18:00** | **2026-09-19** | 2026-09-18 |
| **23:00** | **2026-09-19** | 2026-09-18 |

**Consecuencia:** durante toda la cena — el rush más importante de un restaurante — el dashboard mostraba "Fecha Operativa" con la fecha de mañana y consultaba los cortes de venta de mañana → **"$0 Venta Acumulada" todas las noches**.

**Corregido** en F0.1a vía `lib/business-date.ts`. El mismo patrón existe en otros servicios (`cross-branch-service.ts:944-945`) — fuera del alcance de este plan, **anotado como deuda**.

### 2.12 — Desfase de 6 h entre cómo se guardan y cómo se comparan los timestamps `[DETECTADO — SIN RESOLVER]`

Las columnas son `timestamp` **sin zona** (`schema.ts:72, 89`), pero se comparan contra límites calculados en hora local.

Evidencia: `shift_sessions.started_at` máximo = `2026-09-18 05:00:00` (leído como `05:00Z`). La ventana local del 18-sep empieza en `06:00Z` → **la sesión queda fuera por una hora**. Por eso el servicio reporta `staffActiveNow = 0` aunque existe actividad.

**No resuelto a propósito:** cambiarlo altera la semántica de "hoy" en todo el producto y requiere decidir la política de timestamps (¿guardar con zona? ¿`mode: "string"` en drizzle? ¿normalizar al leer?). Es una decisión de arquitectura, no un fix de pantalla.

---

## 3. Mapamundi: critique → fases

| Origen | Hallazgo | Fase | Prio |
|---|---|---|---|
| Nuevo (spike) | **Filtro de status tira el incidente FATAL** | **F0.0** | ✅ **HECHO** |
| Nuevo (spike) | **Fecha de negocio calculada en UTC** | **F0.1a** | ✅ **HECHO** |
| Nuevo (spike) | **Anclaje por fuente + `dataAsOf`** | **F0.1b** | Bloqueante |
| Nuevo (spike) | **Desfase de 6 h en timestamps** | **F0.1b** | Arquitectura |
| Nuevo (spike) | "Sin dato" vs "dato malo" pintan igual | **F0.2** | Alta |
| Nuevo | Dotación autorreferencial | **F0.3** | Bloqueante |
| Nuevo | Dos fórmulas de dotación | **F0.3** | Bloqueante |
| Nuevo | `lateCount` constante | **F0.3** | Alta |
| Nuevo | `criticalAlertsCount` con techo | **F0.5** | Alta |
| Critique P1 | Banner verde contradice la matriz | **F1** | Alta |
| Critique P1 | Severidad solo por color | **F2** | Alta |
| Critique P1 | Colas truncadas / duplicadas | **F3** | Alta |
| Critique P1 | "En vivo" sin frescura | **F4** | Alta (decisión) |
| Critique P2 | Densidad de 36 frames | **F5** | Media |
| Critique P2 | `loading.tsx` desalineado | **F6** | Media |
| Critique P2 | `shadow-xs` / `transition-all` / `emerald` | **F6** | Media |
| Critique P2 | Jerga regulatoria sin ayuda | **F7** | Media |
| Critique P2 | Truncados / medida / padding | **F5-F6** | Media |
| Critique | `aria-pressed`, `label` de búsqueda, `min-w-0` móvil | **F2** | Alta |

---

## F0 — Integridad de datos en `LiveCommandService` `[BLOQUEANTE]`

**Objetivo:** que los números de la página sean defendibles. Sin esto, F1 miente distinto.

**Archivos:** `lib/services/live-command-service.ts`, `components/dashboard/live/live-command-matrix.tsx` (tipo)

**Reordenado tras el spike:** el denominador de dotación (era F0.1) baja a **F0.3**. Los dos hallazgos que el spike reveló van primero.

### F0.0 — Incluir `ESCALATED` y `AWAITING_EXTERNAL` en el filtro de incidentes ✅ **HECHO**

**El fix con mejor relación valor/esfuerzo de todo el plan.** Tenía repro vivo: un incidente `FATAL / ESCALATED` que el banner no veía (2.6).

**Implementado en `lib/services/live-command-service.ts`:**
- Constante `TERMINAL_INCIDENT_STATUSES = ["RESOLVED"]` definida **por exclusión**, con la dirección del fallo documentada en código: si aparece un status nuevo, se muestra de más antes que ocultar un FATAL.
- `or(eq(...), eq(...), eq(...))` → `notInArray(incidents.status, ["RESOLVED"])`.
- Imports `or` y `sql` (muerto) eliminados.

**Verificación end-to-end contra el servicio real** (`scripts/check-live-command-pulse.ts`):

```
antes:  criticalAlertsCount = 0   => banner VERDE
ahora:  criticalAlertsCount = 1   => banner ROJO  (correcto)
        rushAlerts: [critical] Condesa: Incendio menor en parrilla
```

El incidente recuperado es literalmente un incendio en parrilla con severity `FATAL`.

### F0.1 — Un solo calendario para toda la página `[BLOQUEANTE REAL]`

**Esto es lo que mi F0.1 original no entendía** (ver 2.8). La página mezclaba dos calendarios para el mismo concepto: `startOfDay(new Date())` (local) y `new Date().toISOString().slice(0,10)` (**UTC**).

#### F0.1a — Unificar el calendario ✅ **HECHO**

**Bug confirmado empíricamente** (ver 2.11): a partir de las **18:00 hora local** el reloj UTC ya está en el día siguiente, así que `todayIsoDate` apuntaba a **mañana** durante toda la cena:

- `businessDate: todayIsoDate` → "Fecha Operativa" mostraba la fecha de mañana
- `eq(dailySalesCuts.businessDate, todayIsoDate)` → **"$0 Venta Acumulada" todas las noches**

**Implementado:**
- Nuevo módulo `lib/business-date.ts`: `BUSINESS_TIMEZONE = "America/Mexico_City"`, `businessDateIso()`, `businessDayStart()`, `businessDayEnd()`, derivados con `Intl`. Cero dependencias nuevas (`date-fns-tz` no está instalado).
- `live-command-service.ts` usa un solo calendario en toda la función.
- Cotas superiores (`lte(..., todayEnd)`) agregadas a las tres consultas por timestamp: la ventana del día ahora está acotada por ambos lados.
- `lib/__tests__/business-date.test.ts` — **13/13 tests pasan**, incluido el caso de regresión de las 18:00.

> El bug era invisible en una demo de mañana. Los tests lo fijan determinísticamente.

#### F0.1b — Resolución por fuente + `dataAsOf` (PENDIENTE — decisión C confirmada)

Ya existen `DataAnchor { asOf, isCurrent }` y `dataAnchorFor()` en `lib/business-date.ts`, listos para usar.

1. Resolver el ancla de cada fuente por separado (`sessions`, `temperatures`, `sales`, `workflows`) como su fecha real más reciente con datos.
2. Usar esa ancla en el `where` en vez de "hoy".
3. Exponer `dataAsOf` por bloque en `LivePulseSummary`.
4. **La UI debe declararlo** — mostrar datos de ayer sin etiqueta es peor que mostrar un cero. Requiere decidir dónde va la etiqueta (banner, por tarjeta, o ambos).

**Confirmado por el spike:** `shift_sessions.planned_shift_id` está poblado en **104/104** filas — el join con `planned_shifts.shift_date` es viable, no hay que inventar denominador.

**Bloqueante de F0.1b (ver 2.12):** las columnas `timestamp` se guardan sin zona pero se comparan contra límites locales → desfase sistemático de 6 h en la ventana del día. Poblar las anclas por fuente sin resolver esto las calcularía mal.

### F0.2 — Separar "sin dato" de "dato malo"

Colisión de conceptos (2.10). Estados distintos, tokens distintos:

| Estado | Significado | Token |
|---|---|---|
| `NOT_LOGGED` | no hay registro del período | `--muted` / neutro + "Sin registro" |
| `WARNING` / `CRITICAL` | hay registro y está mal | `--warning` / `--destructive` |

Aplicar en `nom251` (`:291` hoy colapsa ambos en `WARNING`) y en `opening` / `staff` / `sales`.

### F0.3 — Denominador real de dotación
Con el ancla de F0.1 resuelta:
1. `expectedStaff` = turnos planificados publicados de la sucursal **en el día operativo resuelto**.
2. **Eliminar** `Math.max(activeStaff, 4)` y el comentario "plantilla QSR estimada".
3. Estado `"UNKNOWN"` solo para cuando no hay turnos planificados → **"Sin dotación configurada"**, sin porcentaje.

```ts
const expectedStaff = plannedCountByBranch.get(b.id) ?? 0;
const staffStatus =
  expectedStaff === 0 ? "UNKNOWN"
  : activeStaff >= expectedStaff ? "NORMAL"
  : activeStaff >= expectedStaff - 1 ? "WARNING"
  : "CRITICAL";
```

4. `lateCount` desde `shiftSessions.lateMinutes > 0` — requiere agregar `lateMinutes` al `select` (hoy no se trae) y al tipo. Hay 1 tardanza real en la base.

### F0.4 — Un solo cálculo de asistencia
`staffAttendanceRate` (línea 351) debe usar los mismos agregados que F0.3:

```ts
const totalExpected = /* suma de expectedStaff */;
const staffAttendanceRate = totalExpected > 0
  ? Math.min(100, Math.round((totalActiveStaff / totalExpected) * 100))
  : null;   // null ⇒ "Sin dotación configurada", NO "0% cubierto"
```

Esta es la línea que hoy hace que el banner diga "0% cubierto" y la matriz "0 de 4 activos" con dos fórmulas distintas (2.2).

### F0.5 — Contador de alertas sin techo
Separar el conteo del `slice` (`:336-338` vs `:361`):

```ts
const criticalAlerts = incidentRows.filter((i) => i.severity === "CRITICAL" || i.severity === "FATAL");
const rushAlerts = criticalAlerts.slice(0, 4).map(...);   // solo display
// ...
criticalAlertsCount: criticalAlerts.length,               // conteo real
```

### F0.6 — Tipo
- `BranchLiveStatus.staff.status`: agregar `"UNKNOWN"` y `"NOT_LOGGED"` donde aplique (`live-command-service.ts:25`).
- `live-command-matrix.tsx`: caso `UNKNOWN` → badge neutro `"Sin dotación"`, `text-muted-foreground`, sin color de alarma.

### Verificación F0
- [ ] Incidente `FATAL / ESCALATED` y `FATAL / AWAITING_EXTERNAL` → `criticalAlertsCount > 0` (repro vivo en 2.6).
- [ ] `rg "eq\(incidents.status"` no enumera status abiertos a mano.
- [ ] Cada bloque del resumen expone `dataAsOf`.
- [ ] "Personal en Piso %" del banner == promedio ponderado de la matriz.
- [ ] Un período sin `planned_shifts` muestra "Sin dotación configurada" y **ninguna** cifra porcentual.
- [ ] "Sin registro" (frío) **no** usa el mismo ámbar que "fuera de rango".
- [ ] `rg "Math\.max\(activeStaff, 4\)"` → 0 resultados.
- [ ] `rg "lateCount: 0"` → 0 resultados.

**Riesgo:** medio. Toca lógica de negocio, no presentación. **F0.0 puede voltear el banner a rojo hoy mismo**, y eso es correcto (2.6). F0.1 puede cambiar qué período muestra la página entera. Coordinar con cualquier demo pendiente.

---

## F1 — Honestidad del banner de pulso `[P1]`

**Depende de F0.** Sin F0, el banner escalaría sobre un `staffAttendanceRate` falso.

**Archivo:** `components/dashboard/live/live-pulse-banner.tsx`

### F1.1 — Máquina de estados, no un `if` de un solo contador
Hoy (`live-pulse-banner.tsx:54`) el verde depende solo de `criticalAlertsCount > 0`. `isOpenFull` (`:27`) y `isStaffHealthy` (`:28`) **se calculan y solo tiñen tiles** — nunca escalan el banner.

Escalar sobre la unión de señales que el resumen ya tiene:

```ts
const branchesWithIssues = summary.branches.filter((b) =>
  b.opening.status !== "ON_TIME" ||
  (b.staff.status !== "NORMAL" && b.staff.status !== "UNKNOWN") ||
  b.nom251.status !== "OK" ||
  b.activeAlerts.length > 0
).length;

const severity =
  summary.criticalAlertsCount > 0 ? "critical"
  : branchesWithIssues > 0 ? "attention"
  : "stable";
```

### F1.2 — Decir el hecho, no el adjetivo
"Servicio Estable sin Alertas Críticas" es un adjetivo. `PRODUCT.md` ("Confident, sharp, operational… no fluff") prohíbe exactamente eso.

- Verde solo si: **todas** las sucursales abrieron a tiempo **y** dotación ≥90% **y** frío NOM-251 registrado.
- Si no: **"3 de 3 sucursales con retraso de apertura"** — el conteo de las que *no* están normales, con el motivo dominante.
- Aplicar los tokens `--success` / `--warning` / `--destructive`; reemplazar `bg-emerald-400/500` (`:36-37`) por `--success`.
- El string objetivo es `:66` ("Servicio Estable sin Alertas Críticas").
- El punto `animate-ping` verde **no debe** latir cuando el estado no es estable.

### Verificación F1
- [ ] Ninguna combinación con `openRatePercent < 100` o dotación crítica produce verde.
- [ ] El copy del banner, leído solo, permite saber cuántas sucursales están mal.
- [ ] `rg "emerald" components/dashboard/live/` → 0 resultados.

---

## F2 — Severidad accesible y controles anunciados `[P1]`

**Independiente de F0/F1. Es el fix más barato con más impacto.**

**Archivos:** `components/dashboard/area-card.tsx`, `components/dashboard/live/live-command-matrix.tsx`

### F2.1 — Severidad no puede ser solo color
`area-card.tsx:9-10` — `fatal` y `critical` mapean al **mismo string de clases**, byte a byte. Sin ícono, sin texto, sin `aria-label`, sin `sr-only`.

- Agregar glifo: `AlertOctagon` (fatal/critical) / `AlertTriangle` (high) / `Info` (warning/info).
- Añadir `<span className="sr-only">` con la palabra de severidad dentro del badge.
- `fatal` y `critical` deben ser distinguibles → distinta intensidad o distinto ícono, no el mismo className.
- El badge lleva **severidad**; el nombre de sucursal pasa a chip separado (esto también sirve a F3).

### F2.2 — Estado de filtros anunciado
`live-command-matrix.tsx:97` y `:107` — los botones `Todas` / `Con Alertas` son `<button>` planos sin `aria-pressed`. Agregar `aria-pressed={filterMode === "ALL"}` / `{filterMode === "ISSUES_ONLY"}`.

### F2.3 — Búsqueda con nombre accesible
`live-command-matrix.tsx:88-95` — `Input` solo con `placeholder`. Agregar `<label className="sr-only">` o `aria-label="Buscar sucursal"`.

### F2.4 — Contraste de tokens
Verificar que `--warning-text` / `--success-text` sobre sus fondos `/15` cumplen 4.5:1 en **modo claro y oscuro** (`globals.css:95-115`, `:165-180`). Los tokens ya existen y están documentados para este caso — usarlos, no inventar colores.

### Verificación F2
- [ ] NVDA/VoiceOver anuncia severidad en cada fila de excepción.
- [ ] `fatal` y `critical` se distinguen sin color.
- [ ] Los filtros anuncian su estado tras activarse.
- [ ] `axe` sin violaciones `color-contrast` en `/dashboard`.

---

## F3 — Excepciones legibles y agrupadas `[P1]`

**Depende parcialmente de un cambio de servicio** (el critique lo trató solo como layout).

### F3.1 — El título no puede llevar instancia (cambio de servicio)
`lib/services/group-exceptions-service.ts:118-127`:

```ts
const INVENTORY_ALERT_TITLES: Record<string, string> = {
  LOW_STOCK: "Stock bajo en insumo clave",
  ...
```

**Mapa estático por tipo, no descripción por instancia.** Tres sucursales con stock bajo emiten el mismo string, siempre. No hay `item.name` interpolado en ningún lado.

- Interpolar el sujeto real (`item.name`, folio, equipo) en el título.
- Aplicar el mismo criterio a los demás mapas de títulos.

### F3.2 — Agrupar por condición, no por fila
"¿Tres excepciones o una con tres ubicaciones?" → **son tres filas que representan una condición en tres lugares.** El `branchName` sí existe por fila (`area-card.tsx:79`), así que la distinción técnica está; la legible no.

- Agrupar por título normalizado: **"Stock bajo: tortilla ×3 sucursales"** con las sucursales como chips.
- Subir `PREVIEW_COUNT` **solo después** de que las etiquetas sean legibles.

### F3.3 — Dejar de truncar información
`area-card.tsx:81` — `truncate` sin `title`/`aria-label`. El detector midió 8 spans con 20–150px de desborde.
- `line-clamp-2` en vez de `truncate` (dos líneas, no elipsis).
- `min-w-0` en los hijos flex — la causa raíz de los 9 overflows es un hijo de ancho fijo en `flex justify-between` sin `min-w-0` (mismo defecto que rompe el móvil, ver F5.3).

### Verificación F3
- [ ] Ninguna fila repite un título idéntico sin agrupar.
- [ ] Cero overflows en el detector.
- [ ] Cada título legible sin abrir el link.

---

## F4 — Contrato de frescura `[P1] — requiere decisión de producto]`

**Hallazgo nuevo que cambia el costo:** la plomería de tiempo real **ya existe y está sin usar.**
- `app/api/analytics/realtime/route.ts:73` sirve `text/event-stream`
- `lib/hooks/use-analytics-sse.ts:22` tiene el cliente (`new EventSource`)
- **Cero consumidores** del hook en `app/` + `components/` (grep verificado)

Y la página no tiene `router.refresh`, ni polling, ni timestamp de antigüedad, en ninguna parte.

### F4.1 — Decidir primero (bloqueante de diseño)
**La pregunta no es "¿live o briefing?", es "hecho o adjetivo".** Pero la decisión de alcance sí hay que tomarla:

| Opción | Costo | Cuándo elegirla |
|---|---|---|
| **A. Briefing honesto** | Bajo: quitar "en vivo" de 4 labels + timestamp | Si el dato no cambia intradía de forma accionable |
| **B. Monitor real** | Medio: usar el SSE existente + fallback a refresh | Si un director actúa sobre esto durante el rush |

**Recomendación:** A ahora, B después — pero **elegir una y que título, copy y arquitectura coincidan.** Hoy los tres se contradicen.

### F4.2 — Si se elige A (mínimo)
- Timestamp `última actualización` desde la fila más reciente tocada por el servicio (no `Fecha Operativa`, que es fecha de negocio y **parece** frescura sin serlo).
- Botón "Actualizar" + `router.refresh()` en `visibilitychange`.
- Demover la palabra "en vivo" donde el dato sea de request (`page.tsx:38-39`, banner `:51`, `:76`, `recent-activity`).

### F4.3 — Si se elige B
- Consumir `use-analytics-sse.ts`; degradar a polling 60s si el stream falla.
- Reutilizar la máquina de estados de F1 para el estado "sin conexión" (nunca mostrar verde stale).

### Verificación F4
- [ ] Un usuario puede saber la antigüedad del dato sin adivinar.
- [ ] Ningún label dice "en vivo" sobre un snapshot.

---

## F5 — Reducir densidad de frames `[P2]`

**Respaldo del brief, que el critique no citó:** `PRODUCT.md` anti-referencias → **"No heavy borders"**. Los 36 frames no son solo un problema de jerarquía: **son la anti-referencia de la marca, implementada.**

**Archivos:** `live-command-matrix.tsx`, `live-pulse-banner.tsx`, `area-card.tsx`

### F5.1 — Dos capas por sucursal (máximo)
Anatomía actual de una fila: card con borde → strip `bg-muted/20` → 4 tiles `rounded-lg border` → badges con borde. **Cuatro frames para un dato.**
- Máximo: fila + grupo de semáforos. Sin bordes en los chips.
- Un solo tono para el track; la fila con problema lleva **tinte de fondo**, no borde.
- Eliminar el `border border-destructive/20 rounded-md` en fila crítica (`:159`) → tinte solo.

### F5.2 — Jerarquía real en la fila
Hoy "Operación normal" y "Requiere supervisión" tienen **peso visual idéntico** hasta leer el color. El estado debe dominar el ancho/posición, no ser un badge más.

### F5.3 — Móvil (390×844)
- `h2` del banner se envuelve en 4 líneas por falta de `min-w-0`/`truncate` en el flex con el badge de fecha.
- 6 de 8 tiles de sucursal se solapan en grid 2-col (`Pendiente` sobre `Pendiente de apertura`, `¡Fuera de norma!` recortado, `Venta Hoy` en 2 líneas).
- Causa: hijos de ancho fijo en `flex justify-between` sin `min-w-0`. **Misma raíz que F3.3.**
- Mover "Ficha 360°"/"Ver N alertas" a zona de pulgar o hacer la fila sticky.

### F5.4 — El card vacío de Finanzas (era pregunta retórica, es binario)
`group-area-overview.tsx:55-56` ya documenta la decisión ("se omite en vez de inventar un número"). **No rellenar con algo inventado** — eso contradice la disciplina que el propio critique elogia.
- **Borrarlo** o **ponerle el último cierre de tesorería real.** Sin tercera vía.

### Verificación F5
- [ ] Detector: `nested-cards` de 24 → objetivo <8.
- [ ] Cero solapamientos a 390px.
- [ ] El ojo aterriza en la sucursal rota en <1s (prueba A/B de screenshot).

---

## F6 — Pulido de fidelidad y carga `[P2]`

**Archivos:** `app/dashboard/loading.tsx`, `app/dashboard/page.tsx`, `live-pulse-banner.tsx`, `live-command-matrix.tsx`

### F6.1 — Skeletons que espejan la página real
| Hoy | Realidad |
|---|---|
| `loading.tsx`: 2× `ChartSkeleton` | La página **no tiene charts** |
| `page.tsx:44`: `<MetricCardSkeleton count={6} />` | `MetricGrid` default `lg:grid-cols-4`; real = 3 |
| `page.tsx:53,57`: `columns={5}` | `recent-workflows-table` renderiza **6** columnas (verificado) |

Reescribir `loading.tsx` con la composición real: banner → 6 area cards → tabla 6-col. Pasar `columns={6}` y grid de 3.

### F6.2 — Flat-By-Default
`DESIGN.md` §4/§6: *"No box-shadows on cards, dropdowns, or containers."*
- Quitar `shadow-xs` de `live-pulse-banner.tsx:31` y `live-command-matrix.tsx:67`.
- Si la intención era elevar el hero: **token de borde más fuerte**, no sombra.

### F6.3 — Motion y tokens
- `transition-all` → `transition-colors` (`live-pulse-banner.tsx:31`): `all` anima propiedades que afectan layout.
- `bg-emerald-400/500` → `--success` (en F1.2).
- `animate-pulse` en íconos no debe indicar alarma si el estado es estable.

### F6.4 — Medida y padding
- `line-length`: descripción de página ~98 chars/línea → cap ~80 o partir.
- `cramped-padding`: fila de empty-state de la tabla pegada a su borde superior.
- Un solo formatter de moneda/número (hoy `Intl.NumberFormat` inline en 2 componentes + `formatMetric`).

### Verificación F6
- [ ] Carga en frío: cero saltos de layout (skeleton == contenido).
- [ ] `rg "shadow-xs" app/dashboard components/dashboard` → 0.
- [ ] Detector: `layout-transition` de 5 → solo las del sidebar de shadcn (fuera de alcance).

---

## F7 — Claridad y jerga `[P2]`

**Archivo:** `live-pulse-banner.tsx`, `area-card.tsx`, `page.tsx`

- `M17 / NOM-251` (`:148`): código interno de taxonomía renderizado como atribución de un número que no explica. **Renombrar a lo que significa o quitarlo.** No dejar hard-coded en el banner (rota en silencio si cambia la taxonomía).
- Tiles KPI son `div`s bespoke → **no heredan los tooltips de `MetricCard`** (verificado `title: ""`). Darles el mismo tratamiento o migrarlos a `MetricCard`.
- Sin explicar: `POS`, `Ficha 360°`, `Consejo del Grupo`, `rush`, reglas de color verde/ámbar/gris.
- La fila de 4 KPI es el **hero-metric template que `DESIGN.md` §6 prohíbe como layout por defecto**, y tres tiles son tautologías de un mismo hecho en turno frío ("Aperturas 0/3", "$0", "Riesgos 0"). **Colapsar a una frase** cuando el turno apenas inicia.
- Añadir enlace a `docs/user-guide.md`.

**Verificación F7:** ningún término sin definición en la superficie; sin hero-metric por defecto.

---

## 4. Orden de ejecución y por qué — REORDENADO TRAS EL SPIKE

```
F0.0 (filtro incidentes, 1 línea) ─► el banner deja de mentir HOY
F0.1 (anclaje de fecha) ──► F0.2 (sin dato ≠ dato malo) ──► F0.3 (dotación)
F2 (a11y)                            ← paralelizable siempre
F1 (banner) ──► F3 (excepciones) ──► F5 (frames)
F4 (frescura)                        ← ahora es raíz, no accesorio
F6 (pulido) + F7 (claridad)
```

1. **F0.0 primero, porque es una línea y hay un FATAL escalado invisible ahora mismo.** No espera decisión de nadie y su efecto es inmediato y verificable.
2. **F0.1 después, porque es el bloqueante real.** Hasta que la página tenga un anclaje de fecha único y declarado, todo número es ininterpretable — y mi intento anterior de arreglar el denominador habría empeorado esto (2.8).
3. **F2 en paralelo desde el minuto uno** — no comparte archivos con F0 y no depende de ninguna decisión.
4. **F0.3 (dotación) al final de F0**, porque depende del ancla resuelta.
5. **F1 después de F0** — es su consumidor.
6. **F4 sube de prioridad:** ya no es "un P1 sobre copy". Es la mitad de la causa de que los números no se puedan leer. Pero la decisión A/B sigue siendo tuya.

**Lo que el spike evitó:** un bug auto-infligido. Ver 2.8.

---

## 5. Lo que este plan NO va a hacer

- **Rellenar el card de Finanzas con una métrica inventada.** La ausencia documentada es una virtud del código (`group-area-overview.tsx:55-56`).
- **Escribir el denominador de dotación sin el spike F0.4.** Sin confirmar `plannedShiftId`, cualquier denominador vuelve a ser un 4 disfrazado.
- **Quitar "en vivo" antes de decidir F4.** El copy es el síntoma; la decisión es el problema.
- **Tocar los `layout-transition` del sidebar de shadcn.** Son de librería, fuera del alcance de esta superficie.
- **Subir `PREVIEW_COUNT` antes de arreglar las etiquetas** (F3.3) — solo empeora el truncado.

---

## 6. Decisiones que necesito de ti

| # | Decisión | Bloquea | Mi recomendación |
|---|---|---|---|
| D1 | ¿F4 Opción A (briefing) o B (monitor SSE)? | F4 completo | **A ahora**, B como fase 2 |
| D2 | ¿Finanzas se borra o se llena con cierre real? | F5.4 | Borrar hasta tener fuente Nivel A |
| D3 | ¿`fatal` y `critical` se distinguen por ícono o por token nuevo? | F2.1 | Ícono distinto — sin tocar tokens |
| D4 | ¿La fila de 4 KPI se colapsa en turno frío? | F7 | Sí, es lo que pide `DESIGN.md` §6 |
| ~~D5~~ | ~~¿Se autoriza el spike F0.4?~~ | — | ✅ **EJECUTADO** — ver 2.6-2.8 |
| **D6** | **¿"Día operativo" = hoy calendario (A), último día con datos (B), o por fuente (C)?** | **F0.1 completo** | **C** — las fuentes ya divergen 18 días entre sí |
| **D7** | **¿Se re-siembra la demo, o se acepta que muestre datos al 09-17 con su fecha?** | Demo readiness | Re-seed **después** de F0; antes enmascara el bug |

### Artefactos del spike (read-only, reutilizables como diagnóstico)

```
scripts/check-live-command-pulse.ts    # servicio REAL end-to-end: semáforos, banner, alertas
scripts/spike-f0-dotacion.ts           # planned_shifts, planned_shift_id, tardanzas
scripts/spike-f0b-anclaje-fechas.ts    # deriva de fechas por fuente (el hallazgo grande)
scripts/spike-f0c-incidentes-seed.ts   # mecanismo del falso verde (FATAL/ESCALATED)
```

No modifican datos. `check-live-command-pulse.ts` es el más útil: verifica F0.0/F0.2/F0.3 de un vistazo contra el servicio real.

---

## 7. Definition of Done

- [x] **Un incidente `FATAL` + `ESCALATED` produce `criticalAlertsCount > 0`** (repro vivo) — ✅ verificado end-to-end
- [x] `rg "eq\(incidents.status"` no enumera status abiertos a mano — ✅
- [x] Un solo calendario: `rg "toISOString\(\)\.slice\(0, 10\)" lib/services/live-command-service.ts` → 0 — ✅
- [x] Tests de fecha de negocio (18:00 local) — ✅ 13/13
- [ ] Cada bloque de datos expone su `dataAsOf` y la UI lo muestra
- [x] "Sin registro" y "fuera de rango" **no** comparten token (`nom251: NOT_LOGGED` neutro)
- [x] `rg "Math\.max\(activeStaff, 4\)"` → 0
- [x] `rg "lateCount: 0"` → 0 (desde `shiftSessions.lateMinutes`)
- [x] Banner y KPI de dotación **coinciden numéricamente** siempre (mismo `totalExpectedStaff`; `null` ⇒ "Sin dotación")
- [x] Ninguna combinación de estado malo produce verde (banner = máquina de estados)
- [x] Severidad distinguible sin color (glifo + `sr-only` en `area-card.tsx`)
- [ ] Detector: `nested-cards` <8, `text-overflow` = 0
- [ ] `axe` sin violaciones de contraste en `/dashboard` (claro + oscuro)
- [ ] Skeletons sin salto de layout en carga fría
- [x] `rg "shadow-xs" app/dashboard components/dashboard` → 0
- [x] `pnpm run lint` y `pnpm run build` limpios
- [ ] Cero solapamientos a 390×844

**Comandos de verificación:**
```bash
pnpm run lint
pnpm run build
pnpm test:e2e
node .agents/skills/impeccable/scripts/detect.mjs --json app/dashboard components/dashboard components/shared
```

---

## 8. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| F0 cambia semáforos a rojo en demo | El demo se ve peor | **Es correcto** — el demo estaba mintiendo. Avisar antes de la demo. |
| `plannedShifts` vacío en datos sembrados | Denominador siempre 0 | Estado `UNKNOWN` es válido y honesto; no volver a un default |
| F0.4 revela que `plannedShiftId` no se puebla | Denominador no fiable | Cae a `UNKNOWN` + registrar como deuda en `PROJECT_CONTEXT.md` |
| F5 rompe la matriz que "es el producto" | Regresión en el mejor componente | Snapshot A/B antes/después, no reescribir de cero |
| F4 Opción B: SSE sin auth por tenant | Fuga cross-tenant (multi-tenant es ley del repo) | Verificar `tenantId` en el stream **antes** de consumirlo |